import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';

import type { DB } from '../../src/db.ts';
import {
  chapterId,
  chapterRevisionId,
  outlineId,
  projectId,
  storyStateRevisionId,
  type ChapterId,
  type ChapterRevisionId,
  type OutlineId,
  type ProjectId,
  type StoryStateRevisionId,
} from '../../src/domain/ids.ts';
import type { StoryState, StoryStateDelta } from '../../src/domain/story-state.ts';
import { getJobRow, createJobRow } from '../../src/job-store.ts';
import { ChapterRepository } from '../../src/repositories/chapter-repository.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import {
  ProjectWriteLeaseRepository,
} from '../../src/repositories/lease-repository.ts';
import { StoryStateRepository } from '../../src/repositories/story-state-repository.ts';
import { WriterApplication } from '../../src/services/writer-application.ts';
import {
  fixtureChapterId,
  fixtureChapterRevisionId,
  fixtureOutlineId,
  fixtureProjectId,
  fixtureStateRevisionId,
  fixtureTime,
} from '../helpers/fixtures.ts';
import { createTestDb } from '../helpers/test-db.ts';

const ownerId = 'worker-facade-1';
const fixedNow = new Date('2026-07-16T12:00:00.000Z');

function emptyState(summary: string): StoryState {
  return {
    characters: [],
    facts: [],
    foreshadows: [],
    timeline: [],
    summary,
  };
}

function emptyDelta(summary: string): StoryStateDelta {
  return {
    characterChanges: [],
    factChanges: [],
    foreshadowChanges: [],
    timelineEvents: [],
    summary,
  };
}

function contentEngine(text: string): AIAgentAdapter {
  return {
    name: 'mock-engine',
    async run(_prompt: string, _options: RunOptions): Promise<CallResult> {
      return {
        text,
        usage: { inputTokens: 10, outputTokens: 20, costRmb: 0.001, model: 'mock-model', durationMs: 1 },
        notes: [],
      };
    },
    async isAvailable() { return true; },
  };
}

function seedApprovedOutline(
  db: DB,
  input: { position: number; outlineId: OutlineId; title: string },
): void {
  new PlanningRepository(db).saveApprovedOutline({
    outline: {
      id: input.outlineId,
      projectId: fixtureProjectId,
      position: input.position,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: `outline-revision-${input.position}`,
      revisionNumber: 1,
      title: input.title,
      content: { summary: `${input.title}摘要`, beats: ['推进'] },
      createdAt: fixtureTime,
    },
  });
}

function publishSeedChapter(
  db: DB,
  input: {
    position: number;
    outlineId: OutlineId;
    chapterId: ChapterId;
    revisionId: ChapterRevisionId;
    stateId: StoryStateRevisionId;
    previousStateRevisionId: StoryStateRevisionId | null;
    content: string;
    summary: string;
  },
): void {
  seedApprovedOutline(db, {
    position: input.position,
    outlineId: input.outlineId,
    title: `第 ${input.position} 章`,
  });
  const chapters = new ChapterRepository(db);
  const states = new StoryStateRepository(db);
  chapters.saveCandidate({
    chapter: {
      id: input.chapterId,
      projectId: fixtureProjectId,
      outlineId: input.outlineId,
      createdAt: fixtureTime,
    },
    revision: {
      id: input.revisionId,
      revisionNumber: 1,
      source: 'generated',
      parentRevisionId: null,
      title: `第 ${input.position} 章`,
      content: input.content,
      wordCount: input.content.length,
      status: 'draft',
      generationRunId: `run-${input.position}`,
      createdAt: fixtureTime,
    },
  });
  chapters.publishRevision(input.revisionId);
  db.prepare(`
    UPDATE chapter_outline SET status = 'written', updated_at = ? WHERE id = ?
  `).run(fixtureTime, input.outlineId);
  states.save({
    id: input.stateId,
    projectId: fixtureProjectId,
    chapterId: input.chapterId,
    chapterRevisionId: input.revisionId,
    previousStateRevisionId: input.previousStateRevisionId,
    sequence: input.position,
    status: 'current',
    state: emptyState(input.summary),
    delta: emptyDelta(input.summary),
    summary: input.summary,
    model: 'seed-model',
    promptVersion: 'state-v1',
    createdAt: fixtureTime,
  });
}

function seedProjectWithApprovedRange(db: DB, positions: number[]): WriterApplication {
  new ProjectRepository(db).create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });
  const planning = new PlanningRepository(db);
  const bible = planning.saveBibleRevision({
    id: 'bible-revision-1',
    projectId: fixtureProjectId,
    revisionNumber: 1,
    status: 'approved',
    bible: { premise: '林晚追查一张失踪的车票。' },
    compiledText: '稳定设定。',
    createdAt: fixtureTime,
  });
  new ProjectRepository(db).setActiveBibleRevision(fixtureProjectId, bible.id, fixtureTime);

  for (const position of positions) {
    seedApprovedOutline(db, {
      position,
      outlineId: outlineId(`outline-${position}`),
      title: `第 ${position} 章`,
    });
  }

  return new WriterApplication(db, {
    now: () => fixedNow,
    defaultOwnerId: ownerId,
    leaseTtlMs: 60_000,
  });
}

function countLeases(db: DB, id: ProjectId): number {
  const row: unknown = db.prepare(
    'SELECT COUNT(*) AS n FROM project_write_lease WHERE project_id = ?',
  ).get(id);
  assert.ok(typeof row === 'object' && row !== null && 'n' in row);
  return Number((row as { n: number }).n);
}

it('generateChapterRange acquires one lease, generates approved positions, persists range/config, and releases', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1, 2, 3]);
  const generated: number[] = [];

  const result = await app.generateChapterRange({
    projectId: fixtureProjectId,
    from: 1,
    to: 3,
    engine: contentEngine('章节正文'),
    wordCount: 800,
    engineName: 'mock-engine',
    model: 'mock-model',
    qualityProfile: 'default',
    promptVersion: 'chapter-v1',
    budget: { maxCostRmb: 1 },
    generateContent: async (context) => {
      generated.push(context.outlinePosition);
      return {
        title: context.outline.revision.title,
        content: `正文第${context.outlinePosition}章`,
        usage: { inputTokens: 1, outputTokens: 2, costRmb: 0, model: 'mock-model', durationMs: 1 },
        model: 'mock-model',
      };
    },
    extractState: async ({ chapterRevisionId: _id, context }) => {
      void _id;
      return {
        state: emptyState(`状态${context.outlinePosition}`),
        delta: emptyDelta(`状态${context.outlinePosition}`),
        usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'extract', durationMs: 1 },
        model: 'extract',
        promptVersion: 'state-v1',
      };
    },
  });

  assert.deepEqual(generated, [1, 2, 3]);
  assert.equal(result.outcomes.length, 3);
  assert.equal(countLeases(testDb.db, fixtureProjectId), 0);

  const job = getJobRow(testDb.db, result.jobId);
  assert.ok(job);
  assert.equal(job.status, 'completed');
  assert.equal(job.scope.from, 1);
  assert.equal(job.scope.to, 3);
  assert.equal(job.engine, 'mock-engine');
  assert.equal(job.model, 'mock-model');
  assert.equal(job.wordCount, 800);
  assert.equal(job.qualityProfile, 'default');
  assert.equal(job.promptVersion, 'chapter-v1');
  assert.deepEqual(job.budget, { maxCostRmb: 1 });
  assert.equal(job.lastOutlinePosition, 3);

  const chapters = new ChapterRepository(testDb.db);
  assert.ok(chapters.getByOutlinePosition(fixtureProjectId, 1)?.activeRevisionId);
  assert.ok(chapters.getByOutlinePosition(fixtureProjectId, 2)?.activeRevisionId);
  assert.ok(chapters.getByOutlinePosition(fixtureProjectId, 3)?.activeRevisionId);
});

it('generateChapterRange releases the lease when generation fails', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1, 2]);

  await assert.rejects(
    () => app.generateChapterRange({
      projectId: fixtureProjectId,
      from: 1,
      to: 2,
      engine: contentEngine('unused'),
      wordCount: 500,
      engineName: 'mock-engine',
      model: 'mock-model',
      generateContent: async (context) => {
        if (context.outlinePosition === 2) {
          throw new Error('provider boom');
        }
        return {
          title: context.outline.revision.title,
          content: '第一章正文',
          usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'mock', durationMs: 1 },
          model: 'mock',
        };
      },
      extractState: async ({ context }) => ({
        state: emptyState(`状态${context.outlinePosition}`),
        delta: emptyDelta(`状态${context.outlinePosition}`),
        usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'extract', durationMs: 1 },
        model: 'extract',
        promptVersion: 'state-v1',
      }),
    }),
    /provider boom/,
  );

  assert.equal(countLeases(testDb.db, fixtureProjectId), 0);
  const jobs = testDb.db.prepare(
    `SELECT status, error_type FROM job WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).get(fixtureProjectId) as { status: string; error_type: string | null };
  assert.equal(jobs.status, 'failed');
  assert.ok(jobs.error_type);
});

it('generateChapterRange refuses a range with outline gaps', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1, 3]);

  await assert.rejects(
    () => app.generateChapterRange({
      projectId: fixtureProjectId,
      from: 1,
      to: 3,
      engine: contentEngine('unused'),
      wordCount: 500,
      engineName: 'mock',
      model: 'mock',
    }),
    /gap|缺口|missing|连续/i,
  );

  assert.equal(countLeases(testDb.db, fixtureProjectId), 0);
  const jobCount = testDb.db.prepare(
    'SELECT COUNT(*) AS n FROM job WHERE project_id = ?',
  ).get(fixtureProjectId) as { n: number };
  assert.equal(jobCount.n, 0);
});

it('publishChapterEdit creates a draft then publishes through the same publication path', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());

  new ProjectRepository(testDb.db).create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });
  publishSeedChapter(testDb.db, {
    position: 1,
    outlineId: fixtureOutlineId,
    chapterId: fixtureChapterId,
    revisionId: fixtureChapterRevisionId,
    stateId: fixtureStateRevisionId,
    previousStateRevisionId: null,
    content: '第一章原文',
    summary: '第一章',
  });

  const app = new WriterApplication(testDb.db, {
    now: () => fixedNow,
    defaultOwnerId: ownerId,
    leaseTtlMs: 60_000,
  });

  const published = await app.publishChapterEdit({
    projectId: fixtureProjectId,
    outlinePosition: 1,
    title: '北站·修订',
    content: '林晚改写了第一章。',
    state: emptyState('修订后第一章'),
    delta: emptyDelta('修订后第一章'),
    model: 'edit-model',
    promptVersion: 'state-v1',
    source: 'manual',
  });

  assert.equal(countLeases(testDb.db, fixtureProjectId), 0);
  const chapters = new ChapterRepository(testDb.db);
  const active = chapters.getActiveRevision(fixtureChapterId);
  assert.ok(active);
  assert.equal(active.id, published.chapterRevisionId);
  assert.equal(active.status, 'published');
  assert.equal(active.source, 'manual');
  assert.equal(active.content, '林晚改写了第一章。');
  assert.equal(active.parentRevisionId, fixtureChapterRevisionId);

  const states = new StoryStateRepository(testDb.db);
  const current = states.getCurrentAtPosition(fixtureProjectId, 1);
  assert.ok(current);
  assert.equal(current.id, published.storyStateRevisionId);
  assert.deepEqual(published.staleImpact.affectedOutlinePositions, [1]);
});

it('rebuildStoryState and getStaleImpact expose rebuild helpers', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());

  new ProjectRepository(testDb.db).create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });
  publishSeedChapter(testDb.db, {
    position: 1,
    outlineId: fixtureOutlineId,
    chapterId: fixtureChapterId,
    revisionId: fixtureChapterRevisionId,
    stateId: fixtureStateRevisionId,
    previousStateRevisionId: null,
    content: '第一章',
    summary: '第一章',
  });
  publishSeedChapter(testDb.db, {
    position: 2,
    outlineId: outlineId('outline-2'),
    chapterId: chapterId('chapter-2'),
    revisionId: chapterRevisionId('chapter-revision-2'),
    stateId: storyStateRevisionId('state-revision-2'),
    previousStateRevisionId: fixtureStateRevisionId,
    content: '第二章',
    summary: '第二章',
  });

  const states = new StoryStateRepository(testDb.db);
  states.invalidateCurrentFromPosition(fixtureProjectId, 2);

  const app = new WriterApplication(testDb.db, {
    now: () => fixedNow,
    defaultOwnerId: ownerId,
    leaseTtlMs: 60_000,
  });

  assert.deepEqual(app.getStaleImpact(fixtureProjectId, 2), {
    affectedOutlinePositions: [2],
  });

  const rebuilt = await app.rebuildStoryState({
    projectId: fixtureProjectId,
    fromOutlinePosition: 2,
    extractState: async ({ outlinePosition }) => ({
      state: emptyState(`重建${outlinePosition}`),
      delta: emptyDelta(`重建${outlinePosition}`),
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'rebuild', durationMs: 1 },
      model: 'rebuild',
      promptVersion: 'state-v1',
    }),
  });

  assert.deepEqual(rebuilt.rebuiltOutlinePositions, [2]);
  assert.equal(rebuilt.failedAtOutlinePosition, null);
  assert.equal(countLeases(testDb.db, fixtureProjectId), 0);
  assert.ok(states.getCurrentAtPosition(fixtureProjectId, 2));

  // After rebuild, historical stale rows remain but impact must only list
  // positions that still lack a current state.
  assert.deepEqual(app.getStaleImpact(fixtureProjectId, 2), {
    affectedOutlinePositions: [],
  });
  assert.ok(states.listStale(fixtureProjectId).some((row) => row.sequence === 2));
});

it('job resume reads the stored to value and configuration snapshot', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1, 2, 3]);

  const first = await app.generateChapterRange({
    projectId: fixtureProjectId,
    from: 1,
    to: 3,
    engine: contentEngine('章节正文'),
    wordCount: 900,
    engineName: 'resume-engine',
    model: 'resume-model',
    qualityProfile: 'careful',
    promptVersion: 'chapter-v2',
    budget: { maxCostRmb: 2 },
    control: {
      shouldPause: () => true,
    },
    generateContent: async (context) => ({
      title: context.outline.revision.title,
      content: `正文${context.outlinePosition}`,
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'resume-model', durationMs: 1 },
      model: 'resume-model',
    }),
    extractState: async ({ context }) => ({
      state: emptyState(`状态${context.outlinePosition}`),
      delta: emptyDelta(`状态${context.outlinePosition}`),
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'extract', durationMs: 1 },
      model: 'extract',
      promptVersion: 'state-v1',
    }),
  }).catch((error: unknown) => error);

  assert.ok(first && typeof first === 'object' && 'name' in first);
  assert.equal((first as { name: string }).name, 'JobPausedError');

  const pausedJob = testDb.db.prepare(
    `SELECT id, status, scope_json, engine, model, word_count, quality_profile, prompt_version, budget_json
     FROM job WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).get(fixtureProjectId) as {
    id: string;
    status: string;
    scope_json: string;
    engine: string;
    model: string;
    word_count: number;
    quality_profile: string;
    prompt_version: string;
    budget_json: string;
  };
  assert.equal(pausedJob.status, 'paused');
  assert.deepEqual(JSON.parse(pausedJob.scope_json), { from: 1, to: 3 });
  assert.equal(pausedJob.engine, 'resume-engine');
  assert.equal(pausedJob.model, 'resume-model');
  assert.equal(pausedJob.word_count, 900);

  const resume = app.readJobResumeConfig(pausedJob.id);
  assert.deepEqual(resume.scope, { from: 1, to: 3 });
  assert.equal(resume.engine, 'resume-engine');
  assert.equal(resume.model, 'resume-model');
  assert.equal(resume.wordCount, 900);
  assert.equal(resume.qualityProfile, 'careful');
  assert.equal(resume.promptVersion, 'chapter-v2');
  assert.deepEqual(resume.budget, { maxCostRmb: 2 });
});

it('pause then resume completes the same job; later resume is not poisoned by old pause', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1, 2, 3]);
  const { getActiveJob } = await import('../../src/job-store.ts');

  const hooks = {
    generateContent: async (context: {
      outlinePosition: number;
      outline: { revision: { title: string } };
    }) => ({
      title: context.outline.revision.title,
      content: `正文${context.outlinePosition}`,
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'mock', durationMs: 1 },
      model: 'mock',
    }),
    extractState: async ({ context }: { context: { outlinePosition: number } }) => ({
      state: emptyState(`状态${context.outlinePosition}`),
      delta: emptyDelta(`状态${context.outlinePosition}`),
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'extract', durationMs: 1 },
      model: 'extract',
      promptVersion: 'state-v1',
    }),
  };

  // Pause before chapter 2: allow chapter 1, then pause.
  let completed = 0;
  await assert.rejects(
    () => app.generateChapterRange({
      projectId: fixtureProjectId,
      from: 1,
      to: 3,
      engine: contentEngine('章节正文'),
      wordCount: 800,
      engineName: 'resume-engine',
      model: 'resume-model',
      qualityProfile: 'careful',
      promptVersion: 'chapter-v2',
      budget: { maxCostRmb: 2 },
      control: {
        shouldPause: () => completed >= 1,
        onChapterComplete: () => {
          completed += 1;
        },
      },
      ...hooks,
    }),
    (error: unknown) => error instanceof Error && error.name === 'JobPausedError',
  );

  const paused = getActiveJob(testDb.db, fixtureProjectId);
  assert.ok(paused);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.lastOutlinePosition, 1);
  const pausedId = paused.id;

  // Resume in-place with the same job id and original scope/config.
  const resumed = await app.generateChapterRange({
    projectId: fixtureProjectId,
    from: 1,
    to: 3,
    resumeJobId: pausedId,
    engine: contentEngine('章节正文'),
    wordCount: paused.wordCount,
    engineName: paused.engine,
    model: paused.model,
    qualityProfile: paused.qualityProfile,
    promptVersion: paused.promptVersion,
    budget: paused.budget,
    ...hooks,
  });

  assert.equal(resumed.jobId, pausedId);
  assert.equal(getJobRow(testDb.db, pausedId)?.status, 'completed');
  assert.equal(getActiveJob(testDb.db, fixtureProjectId), null);

  // A second "resume" must not invent to < from from a poisoned paused job.
  const activeAfter = getActiveJob(testDb.db, fixtureProjectId);
  assert.equal(activeAfter, null);
  const chapters = new ChapterRepository(testDb.db);
  assert.ok(chapters.getByOutlinePosition(fixtureProjectId, 1)?.activeRevisionId);
  assert.ok(chapters.getByOutlinePosition(fixtureProjectId, 2)?.activeRevisionId);
  assert.ok(chapters.getByOutlinePosition(fixtureProjectId, 3)?.activeRevisionId);

  // Starting another range while no active job is fine; creating a new job
  // must not leave a parallel paused row.
  const runningCount = testDb.db.prepare(
    `SELECT COUNT(*) AS n FROM job WHERE project_id = ? AND status IN ('running', 'paused')`,
  ).get(fixtureProjectId) as { n: number };
  assert.equal(runningCount.n, 0);
});

it('starting a new range cancels a leftover paused job instead of poisoning getActiveJob', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1, 2, 3]);
  const { getActiveJob } = await import('../../src/job-store.ts');

  await assert.rejects(
    () => app.generateChapterRange({
      projectId: fixtureProjectId,
      from: 1,
      to: 3,
      engine: contentEngine('章节正文'),
      wordCount: 800,
      control: { shouldPause: () => true },
      generateContent: async (context) => ({
        title: context.outline.revision.title,
        content: 'x',
        usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'm', durationMs: 1 },
        model: 'm',
      }),
      extractState: async ({ context }) => ({
        state: emptyState(`s${context.outlinePosition}`),
        delta: emptyDelta(`s${context.outlinePosition}`),
        usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'e', durationMs: 1 },
        model: 'e',
        promptVersion: 'state-v1',
      }),
    }),
    (error: unknown) => error instanceof Error && error.name === 'JobPausedError',
  );

  const pausedId = getActiveJob(testDb.db, fixtureProjectId)?.id;
  assert.ok(pausedId);

  const next = await app.generateChapterRange({
    projectId: fixtureProjectId,
    from: 1,
    to: 2,
    engine: contentEngine('章节正文'),
    wordCount: 500,
    generateContent: async (context) => ({
      title: context.outline.revision.title,
      content: `正文${context.outlinePosition}`,
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'm', durationMs: 1 },
      model: 'm',
    }),
    extractState: async ({ context }) => ({
      state: emptyState(`s${context.outlinePosition}`),
      delta: emptyDelta(`s${context.outlinePosition}`),
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'e', durationMs: 1 },
      model: 'e',
      promptVersion: 'state-v1',
    }),
  });

  assert.notEqual(next.jobId, pausedId);
  assert.equal(getJobRow(testDb.db, pausedId)?.status, 'cancelled');
  assert.equal(getJobRow(testDb.db, next.jobId)?.status, 'completed');
  const active = testDb.db.prepare(
    `SELECT COUNT(*) AS n FROM job WHERE project_id = ? AND status IN ('running', 'paused')`,
  ).get(fixtureProjectId) as { n: number };
  assert.equal(active.n, 0);
});

it('resume binds to stored snapshot and ignores caller wordCount/to overrides', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1, 2, 3]);
  const { getActiveJob } = await import('../../src/job-store.ts');

  const hooks = {
    generateContent: async (context: {
      outlinePosition: number;
      outline: { revision: { title: string } };
    }) => ({
      title: context.outline.revision.title,
      content: `正文${context.outlinePosition}`,
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'mock', durationMs: 1 },
      model: 'mock',
    }),
    extractState: async ({ context }: { context: { outlinePosition: number } }) => ({
      state: emptyState(`状态${context.outlinePosition}`),
      delta: emptyDelta(`状态${context.outlinePosition}`),
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'extract', durationMs: 1 },
      model: 'extract',
      promptVersion: 'state-v1',
    }),
  };

  let completed = 0;
  await assert.rejects(
    () => app.generateChapterRange({
      projectId: fixtureProjectId,
      from: 1,
      to: 3,
      engine: contentEngine('章节正文'),
      wordCount: 900,
      engineName: 'snap-engine',
      model: 'snap-model',
      qualityProfile: 'careful',
      promptVersion: 'chapter-v2',
      budget: { maxCostRmb: 3 },
      control: {
        shouldPause: () => completed >= 1,
        onChapterComplete: () => {
          completed += 1;
        },
      },
      ...hooks,
    }),
    (error: unknown) => error instanceof Error && error.name === 'JobPausedError',
  );

  const paused = getActiveJob(testDb.db, fixtureProjectId);
  assert.ok(paused);
  const pausedId = paused.id;
  assert.equal(paused.wordCount, 900);
  assert.deepEqual(paused.scope, { from: 1, to: 3 });

  const seenPositions: number[] = [];
  const resumed = await app.generateChapterRange({
    projectId: fixtureProjectId,
    from: 1,
    to: 2,
    resumeJobId: pausedId,
    engine: contentEngine('章节正文'),
    wordCount: 100,
    engineName: 'override-engine',
    model: 'override-model',
    qualityProfile: 'fast',
    promptVersion: 'chapter-v9',
    budget: { maxCostRmb: 99 },
    generateContent: async (context) => {
      seenPositions.push(context.outlinePosition);
      return {
        title: context.outline.revision.title,
        content: `续写${context.outlinePosition}`,
        usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'mock', durationMs: 1 },
        model: 'mock',
      };
    },
    extractState: hooks.extractState,
  });

  assert.equal(resumed.jobId, pausedId);
  assert.deepEqual(seenPositions, [2, 3]);
  const job = getJobRow(testDb.db, pausedId);
  assert.ok(job);
  assert.equal(job.status, 'completed');
  assert.equal(job.wordCount, 900);
  assert.deepEqual(job.scope, { from: 1, to: 3 });
  assert.equal(job.engine, 'snap-engine');
  assert.equal(job.model, 'snap-model');
  assert.equal(job.qualityProfile, 'careful');
  assert.equal(job.promptVersion, 'chapter-v2');
  assert.deepEqual(job.budget, { maxCostRmb: 3 });
});

it('generateBible fails when a chapter write lease is held', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1]);
  const { createJobRow } = await import('../../src/job-store.ts');
  const { ProjectWriteLeaseRepository } = await import('../../src/repositories/lease-repository.ts');

  const chapterJobId = createJobRow(testDb.db, {
    projectId: fixtureProjectId,
    type: 'chapter',
    scope: { from: 1, to: 1 },
    engine: 'chapter-engine',
    model: 'chapter-model',
    wordCount: 800,
  });
  new ProjectWriteLeaseRepository(testDb.db).acquire({
    projectId: fixtureProjectId,
    jobId: chapterJobId,
    ownerId: 'chapter-owner',
    ttlMs: 60_000,
    now: fixedNow,
  });

  await assert.rejects(
    () => app.generateBible({
      engine: contentEngine('{}'),
      projectId: fixtureProjectId,
      topic: 'topic',
      genre: '悬疑',
      audience: '成人',
    }),
    (error: unknown) => error instanceof Error && /lease/i.test(error.message),
  );
});

it('generateBlueprint fails when a chapter write lease is held', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, []);
  const { createJobRow } = await import('../../src/job-store.ts');
  const { ProjectWriteLeaseRepository } = await import('../../src/repositories/lease-repository.ts');

  const chapterJobId = createJobRow(testDb.db, {
    projectId: fixtureProjectId,
    type: 'chapter',
    scope: { from: 1, to: 1 },
    engine: 'chapter-engine',
    model: 'chapter-model',
    wordCount: 800,
  });
  new ProjectWriteLeaseRepository(testDb.db).acquire({
    projectId: fixtureProjectId,
    jobId: chapterJobId,
    ownerId: 'chapter-owner',
    ttlMs: 60_000,
    now: fixedNow,
  });

  await assert.rejects(
    () => app.generateBlueprint({
      engine: contentEngine('{}'),
      projectId: fixtureProjectId,
      plot: {
        act1: { setup: 'a', conflicts: ['c'], climax: 'x' },
        act2: { setup: 'a', conflicts: ['c'], climax: 'x' },
        act3: { setup: 'a', conflicts: ['c'], climax: 'x' },
        foreshadows: [],
      },
      characters: [],
      totalChapters: 3,
    }),
    (error: unknown) => error instanceof Error && /lease/i.test(error.message),
  );
});

it('generateBible renews lease so it survives clock advancing past initial TTL', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());

  new ProjectRepository(testDb.db).create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });

  const ttlMs = 1_000;
  let nowMs = fixedNow.getTime();
  const renewNows: number[] = [];
  const proto = ProjectWriteLeaseRepository.prototype;
  const originalRenew = proto.renew;
  proto.renew = function renewWithSpy(this: ProjectWriteLeaseRepository, input) {
    renewNows.push(input.now.getTime());
    return originalRenew.call(this, input);
  };
  t.after(() => {
    proto.renew = originalRenew;
  });

  const app = new WriterApplication(testDb.db, {
    now: () => new Date(nowMs),
    defaultOwnerId: ownerId,
    leaseTtlMs: ttlMs,
  });

  const responses = [
    JSON.stringify({ premise: '当少年探险者李川遭遇星际虫族入侵，必须找到失落的星舰核心，否则人类殖民地将在三日内沦陷；与此同时，一个隐藏的叛徒正在瓦解最后的防线。' }),
    JSON.stringify({
      characters: [
        {
          name: '李川', role: '主角', background: '殖民地孤儿，靠拾荒长大，天生能感知虫族的存在',
          secret: '他是半虫族混血，身份一旦暴露将被处决',
          drives: { surface: '活下去', deep: '找到身世真相', soul: '学会信任他人' },
          arc: { start: '孤僻拾荒者', trigger: '殖民地被袭', shift: '发现自己的混血身份', end: '人类与虫族的桥梁' },
          relationships: [{ target: '苏婉', type: '盟友', note: '信任与猜疑并存' }],
        },
        {
          name: '苏婉', role: '导师', background: '殖民地防卫军资深军官，身经百战的指挥官',
          secret: '她知道李川的真实身份并暗中保护',
          drives: { surface: '完成使命', deep: '赎罪', soul: '放下过去' },
          arc: { start: '冷酷军官', trigger: '遇见李川', shift: '被其坚韧打动', end: '牺牲自己掩护撤退' },
          relationships: [{ target: '李川', type: '盟友', note: '暗中保护' }],
        },
        {
          name: '叛徒', role: '反派', background: '殖民地议会核心成员，掌握殖民地最高决策权',
          secret: '他早已与虫族达成秘密交易出卖殖民地',
          drives: { surface: '权力', deep: '恐惧死亡', soul: '渴望被认可' },
          arc: { start: '受尊敬的议员', trigger: '虫族威胁', shift: '选择背叛', end: '被李川揭穿' },
          relationships: [{ target: '李川', type: '对手', note: '价值观根本对立' }],
        },
      ],
    }),
    JSON.stringify({
      characters: [
        { name: '李川', items: ['拾荒背包'], abilities: ['虫族感知'], status: '健康，孤僻', relationships: ['苏婉：新认识'], events: [] },
        { name: '苏婉', items: ['军用手枪'], abilities: ['战术指挥'], status: '疲惫', relationships: ['李川：观察中'], events: [] },
        { name: '叛徒', items: ['议会徽章'], abilities: ['政治操控'], status: '焦虑', relationships: [], events: [] },
      ],
    }),
    JSON.stringify({
      physical: {
        elements: ['殖民地穹顶（随时可能破裂）', '地下虫巢', '通讯干扰场'],
        tensions: ['穹顶材料老化', '氧气储备告急', '虫族夜行性'],
      },
      social: {
        elements: ['议会寡头制', '拾荒者底层阶层', '黑市军火贸易'],
        tensions: ['议会与军队权力之争', '阶层固化', '资源分配不均'],
      },
      metaphorical: {
        elements: ['穹顶=虚假安全感', '虫族=被压抑的恐惧', '星空=自由渴望'],
        tensions: ['穹顶裂缝暗示体制崩溃', '虫族地下活动隐喻潜伏危机', '星空遥不可及象征希望渺茫'],
      },
    }),
    JSON.stringify({
      act1: {
        setup: '殖民地遭虫族突袭，李川在废墟中救出苏婉',
        conflicts: ['穹顶第一道裂缝', '议会拒绝升级防卫', '李川的虫族感知觉醒'],
        climax: '李川决定加入苏婉的突围小队，前往核心区',
      },
      act2: {
        setup: '小队在虫族封锁区艰难推进，发现叛徒线索',
        conflicts: ['苏婉重伤', '叛徒设下陷阱', '李川的混血身份暴露'],
        climax: '李川被小队抛弃，独自面对虫潮',
      },
      act3: {
        setup: '李川接纳混血身份，反向利用虫族感知',
        conflicts: ['揭穿叛徒', '重启星舰核心', '苏婉的牺牲'],
        climax: '李川成为人类与虫族沟通的桥梁，殖民地获得转机',
      },
      foreshadows: [
        { description: '李川手臂上的神秘虫纹印记会发光', setupAct: 1, resolveAct: 2 },
        { description: '苏婉临终前那句未说完的遗言', setupAct: 2, resolveAct: 3 },
        { description: '叛徒书房抽屉里的那封密信', setupAct: 1, resolveAct: 3 },
      ],
    }),
  ];
  let callIdx = 0;
  const { bible } = await app.generateBible({
    engine: {
      name: 'mock-bible',
      async run(_prompt: string, _options: RunOptions): Promise<CallResult> {
        // Advance past the prior TTL between steps; next onProgress renew must extend the lease.
        nowMs += ttlMs + 500;
        const text = responses[callIdx++] ?? '{}';
        return {
          text,
          usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'mock', durationMs: 1 },
          notes: [],
        };
      },
      async isAvailable() { return true; },
    },
    projectId: fixtureProjectId,
    topic: '虫族入侵',
    genre: '科幻',
    audience: '青年男性',
    ttlMs,
  });

  assert.ok(bible.coreSeed.premise.length > 0);
  assert.ok(renewNows.length >= 5, `expected renew on each bible step, got ${renewNows.length}`);
  assert.ok(
    renewNows.some((ts) => ts > fixedNow.getTime() + ttlMs),
    'renew must run after the clock advances past the initial TTL',
  );
  assert.equal(countLeases(testDb.db, fixtureProjectId), 0);
});

it('importBible acquires and releases a project write lease', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  new ProjectRepository(testDb.db).create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });

  const chapterJobId = createJobRow(testDb.db, {
    projectId: fixtureProjectId,
    type: 'chapter',
    scope: { from: 1, to: 1 },
    engine: 'chapter-engine',
    model: 'chapter-model',
    wordCount: 800,
  });
  new ProjectWriteLeaseRepository(testDb.db).acquire({
    projectId: fixtureProjectId,
    jobId: chapterJobId,
    ownerId: 'chapter-owner',
    ttlMs: 60_000,
    now: fixedNow,
  });

  const app = new WriterApplication(testDb.db, {
    now: () => fixedNow,
    defaultOwnerId: ownerId,
    leaseTtlMs: 60_000,
  });

  assert.throws(
    () => app.importBible({
      projectId: fixtureProjectId,
      topic: 't',
      genre: 'g',
      audience: 'a',
      input: {
        coreSeed: { premise: '足够长的前提句子' },
        characterDynamics: [
          {
            name: 'A', role: '主角', background: '背景背景背景背景', secret: '秘密秘密',
            drives: { surface: 's', deep: 'd', soul: 'o' },
            arc: { start: 's', trigger: 't', shift: 'h', end: 'e' },
            relationships: [{ target: 'B', type: '盟友', note: 'n' }],
          },
          {
            name: 'B', role: '配角', background: '背景背景背景背景', secret: '秘密秘密',
            drives: { surface: 's', deep: 'd', soul: 'o' },
            arc: { start: 's', trigger: 't', shift: 'h', end: 'e' },
            relationships: [{ target: 'A', type: '盟友', note: 'n' }],
          },
          {
            name: 'C', role: '反派', background: '背景背景背景背景', secret: '秘密秘密',
            drives: { surface: 's', deep: 'd', soul: 'o' },
            arc: { start: 's', trigger: 't', shift: 'h', end: 'e' },
            relationships: [{ target: 'A', type: '对手', note: 'n' }],
          },
        ],
        worldBuilding: {
          physical: { elements: ['a', 'b', 'c'], tensions: ['t1', 't2', 't3'] },
          social: { elements: ['a', 'b', 'c'], tensions: ['t1', 't2', 't3'] },
          metaphorical: { elements: ['a', 'b', 'c'], tensions: ['t1', 't2', 't3'] },
        },
        plotArchitecture: {
          act1: { setup: 's', conflicts: ['c'], climax: 'x' },
          act2: { setup: 's', conflicts: ['c'], climax: 'x' },
          act3: { setup: 's', conflicts: ['c'], climax: 'x' },
          foreshadows: [{ description: '伏笔描述足够长', setupAct: 1, resolveAct: 3 }],
        },
      },
    }),
    (error: unknown) => error instanceof Error && /lease/i.test(error.message),
  );
});
