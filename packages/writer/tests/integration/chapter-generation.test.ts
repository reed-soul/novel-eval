import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';

import type { DB } from '../../src/db.ts';
import { StaleDependencyError } from '../../src/domain/errors.ts';
import {
  chapterId,
  chapterRevisionId,
  outlineId,
  storyStateRevisionId,
  type ChapterId,
  type ChapterRevisionId,
  type OutlineId,
  type StoryStateRevisionId,
} from '../../src/domain/ids.ts';
import type { StoryState, StoryStateDelta } from '../../src/domain/story-state.ts';
import { ChapterRepository } from '../../src/repositories/chapter-repository.ts';
import {
  ProjectWriteLeaseRepository,
  type ProjectWriteLease,
} from '../../src/repositories/lease-repository.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import { StoryStateRepository } from '../../src/repositories/story-state-repository.ts';
import { ChapterGenerationService } from '../../src/services/chapter-generation-service.ts';
import {
  fixtureChapterId,
  fixtureChapterRevisionId,
  fixtureOutlineId,
  fixtureProjectId,
  fixtureStateRevisionId,
  fixtureTime,
} from '../helpers/fixtures.ts';
import { createTestDb } from '../helpers/test-db.ts';

const jobId = 'job-gen-1';
const generationTime = new Date('2026-07-16T09:00:30.000Z');

function seedJob(db: DB): void {
  db.prepare(`
    INSERT INTO job (
      id, project_id, type, scope_json, input_json, engine, model, word_count,
      quality_profile, budget_json, prompt_version, status, created_at, updated_at
    ) VALUES (?, ?, 'chapter', '{}', '{}', 'test', 'test-model', 1000,
      'default', '{}', 'chapter-v1', 'running', ?, ?)
  `).run(jobId, fixtureProjectId, fixtureTime, fixtureTime);
}

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

function publishChapter(
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
  const planning = new PlanningRepository(db);
  const chapters = new ChapterRepository(db);
  const states = new StoryStateRepository(db);
  planning.saveApprovedOutline({
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
      title: `第 ${input.position} 章`,
      content: { summary: input.summary, beats: [] },
      createdAt: fixtureTime,
    },
  });
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
    model: 'test-model',
    promptVersion: 'state-v1',
    createdAt: fixtureTime,
  });
}

function seedProject(db: DB): {
  lease: ProjectWriteLease;
  chapters: ChapterRepository;
  states: StoryStateRepository;
  generation: ChapterGenerationService;
} {
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
    bible: { premise: '林晚追查一张失踪的车票。', themes: ['记忆'] },
    compiledText: '稳定设定。世界规则：车票可改写记忆。',
    createdAt: fixtureTime,
  });
  new ProjectRepository(db).setActiveBibleRevision(fixtureProjectId, bible.id, fixtureTime);

  publishChapter(db, {
    position: 1,
    outlineId: fixtureOutlineId,
    chapterId: fixtureChapterId,
    revisionId: fixtureChapterRevisionId,
    stateId: fixtureStateRevisionId,
    previousStateRevisionId: null,
    content: '第一章正文',
    summary: '第一章',
  });
  publishChapter(db, {
    position: 2,
    outlineId: outlineId('outline-2'),
    chapterId: chapterId('chapter-2'),
    revisionId: chapterRevisionId('chapter-revision-2'),
    stateId: storyStateRevisionId('state-revision-2'),
    previousStateRevisionId: fixtureStateRevisionId,
    content: '第二章正文',
    summary: '第二章',
  });

  planning.saveApprovedOutline({
    outline: {
      id: outlineId('outline-3'),
      projectId: fixtureProjectId,
      position: 3,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: 'outline-revision-3',
      revisionNumber: 1,
      title: '第三章',
      content: { summary: '第三章推进', beats: ['追问'] },
      createdAt: fixtureTime,
    },
  });

  seedJob(db);
  const lease = new ProjectWriteLeaseRepository(db).acquire({
    projectId: fixtureProjectId,
    jobId,
    ownerId: 'worker-1',
    ttlMs: 60_000,
    now: new Date(fixtureTime),
  });

  return {
    lease,
    chapters: new ChapterRepository(db),
    states: new StoryStateRepository(db),
    generation: new ChapterGenerationService(db, () => generationTime),
  };
}

function contentEngine(text: string): AIAgentAdapter {
  return {
    name: 'mock',
    async run(_prompt: string, _options: RunOptions): Promise<CallResult> {
      return {
        text,
        usage: { inputTokens: 10, outputTokens: 20, costRmb: 0.001, model: 'mock', durationMs: 1 },
        notes: [],
      };
    },
    async isAvailable() { return true; },
  };
}

it('rejects chapter N when chapter N-1 has no current state', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { lease, chapters, states, generation } = seedProject(testDb.db);
  const chapterThreeId = chapterId('chapter-3');

  states.invalidateCurrentFromPosition(fixtureProjectId, 2);

  await assert.rejects(
    () => generation.generateNext({
      projectId: fixtureProjectId,
      outlinePosition: 3,
      lease,
      engine: contentEngine('不应生成'),
      wordCount: 100,
    }),
    StaleDependencyError,
  );
  assert.equal(chapters.listRevisions(chapterThreeId).length, 0);
  assert.equal(states.getCurrentAtPosition(fixtureProjectId, 3), null);
});

it('publishes chapter when provider and extraction succeed', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { lease, chapters, states, generation } = seedProject(testDb.db);

  const outcome = await generation.generateNext({
    projectId: fixtureProjectId,
    outlinePosition: 3,
    lease,
    engine: contentEngine('第三章正文内容，林晚继续追查。'),
    wordCount: 100,
    extractState: async () => ({
      state: emptyState('第三章'),
      delta: emptyDelta('第三章'),
      usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'extract-mock', durationMs: 1 },
      model: 'extract-mock',
      promptVersion: 'state-v1',
    }),
  });

  assert.equal(outcome.kind, 'published');
  if (outcome.kind !== 'published') return;
  const published = chapters.getRevision(outcome.chapterRevisionId);
  assert.ok(published);
  assert.equal(published.revision.status, 'published');
  assert.equal(published.chapter.activeRevisionId, outcome.chapterRevisionId);
  assert.ok(states.getCurrentAtPosition(fixtureProjectId, 3));
});

it('saves rejected candidate when extraction fails after content exists', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { lease, chapters, states, generation } = seedProject(testDb.db);
  const activeBefore = chapters.getByOutlinePosition(fixtureProjectId, 2)?.activeRevisionId
    ?? null;
  const stateBefore = states.getCurrentAtPosition(fixtureProjectId, 2);

  await assert.rejects(
    () => generation.generateNext({
      projectId: fixtureProjectId,
      outlinePosition: 3,
      lease,
      engine: contentEngine('已生成但定稿失败的正文'),
      wordCount: 100,
      extractState: async () => {
        throw new Error('state extraction failed');
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /extraction|state/i);
      return true;
    },
  );

  const chapterThree = chapters.getByOutlinePosition(fixtureProjectId, 3);
  assert.ok(chapterThree);
  const revisions = chapters.listRevisions(chapterThree.id);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0]?.status, 'rejected');
  assert.ok(revisions[0]?.content.includes('已生成但定稿失败'));
  assert.equal(chapterThree.activeRevisionId, null);
  assert.deepEqual(
    states.getCurrentAtPosition(fixtureProjectId, 2)?.id,
    stateBefore?.id,
  );
  assert.equal(states.getCurrentAtPosition(fixtureProjectId, 3), null);
  assert.equal(
    chapters.getByOutlinePosition(fixtureProjectId, 2)?.activeRevisionId,
    activeBefore,
  );
});

it('saves rejected candidate when provider fails after partial content', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { lease, chapters, states, generation } = seedProject(testDb.db);

  await assert.rejects(
    () => generation.generateNext({
      projectId: fixtureProjectId,
      outlinePosition: 3,
      lease,
      engine: contentEngine('unused'),
      wordCount: 100,
      generateContent: async () => {
        throw Object.assign(new Error('provider 500'), {
          partialContent: '半成品正文仍应保留为拒绝候选',
        });
      },
    }),
    (error: unknown) => error instanceof Error && error.message.includes('provider'),
  );

  const chapterThree = chapters.getByOutlinePosition(fixtureProjectId, 3);
  assert.ok(chapterThree);
  const revisions = chapters.listRevisions(chapterThree.id);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0]?.status, 'rejected');
  assert.ok(revisions[0]?.content.includes('半成品正文'));
  assert.equal(chapterThree.activeRevisionId, null);
  assert.equal(states.getCurrentAtPosition(fixtureProjectId, 3), null);
});
