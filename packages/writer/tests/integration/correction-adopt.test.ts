import assert from 'node:assert/strict';
import { it } from 'node:test';

import { applyCorrectionDraft } from '../../src/chapter/corrector.ts';
import {
  getEvalHistory,
  saveCorrectionDraft,
} from '../../src/chapter/store.ts';
import type { DB } from '../../src/db.ts';
import {
  chapterId,
  chapterRevisionId,
  outlineId,
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
import {
  ChapterPublicationService,
  type PublishCandidateInput,
} from '../../src/services/chapter-publication-service.ts';
import {
  fixtureChapterId,
  fixtureChapterRevisionId,
  fixtureOutlineId,
  fixtureProjectId,
  fixtureTime,
} from '../helpers/fixtures.ts';
import { createTestDb } from '../helpers/test-db.ts';

const jobId = 'job-correct-1';
const publicationTime = new Date('2026-07-16T09:00:30.000Z');

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

/** Side tables still used by correction drafts / lessons on top of the versioned kernel. */
function seedLegacyCorrectionTables(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS correction_draft (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      strategy TEXT NOT NULL,
      original_content TEXT NOT NULL,
      revised_content TEXT NOT NULL,
      original_score REAL,
      revised_score REAL,
      issues_json TEXT,
      changes_json TEXT,
      revised_result_json TEXT,
      status TEXT NOT NULL,
      engine TEXT,
      job_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS eval_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      total_score REAL,
      grade TEXT,
      dimensions TEXT,
      suggestions TEXT,
      repetition TEXT,
      model TEXT,
      evaluator_model TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS lesson_learned (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      pattern TEXT NOT NULL,
      dimension TEXT,
      avg_score REAL NOT NULL,
      common_issues TEXT,
      effective_fixes TEXT,
      occurrence_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
}

function seedJob(db: DB): void {
  db.prepare(`
    INSERT INTO job (
      id, project_id, type, scope_json, input_json, engine, model, word_count,
      quality_profile, budget_json, prompt_version, status, created_at, updated_at
    ) VALUES (?, ?, 'correction', '{}', '{}', 'test', 'test-model', 1000,
      'default', '{}', 'v1', 'running', ?, ?)
  `).run(jobId, fixtureProjectId, fixtureTime, fixtureTime);
}

function seedCandidateAt(
  db: DB,
  input: {
    position: number;
    outlineId: OutlineId;
    chapterId: ChapterId;
    revisionId: ChapterRevisionId;
  },
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
      title: `第 ${input.position} 章`,
      content: { summary: `第 ${input.position} 章`, beats: [] },
      createdAt: fixtureTime,
    },
  });
  new ChapterRepository(db).saveCandidate({
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
      content: `第 ${input.position} 章正文`,
      wordCount: 6,
      status: 'draft',
      generationRunId: `run-${input.position}`,
      createdAt: fixtureTime,
    },
  });
}

function publicationInput(input: {
  lease: ProjectWriteLease;
  candidateRevisionId: ChapterRevisionId;
  previousStateRevisionId: StoryStateRevisionId | null;
  outlinePosition: number;
}): PublishCandidateInput {
  const summary = `第 ${input.outlinePosition} 章`;
  return {
    lease: input.lease,
    candidateRevisionId: input.candidateRevisionId,
    previousStateRevisionId: input.previousStateRevisionId,
    state: emptyState(summary),
    delta: emptyDelta(summary),
    model: 'test-model',
    promptVersion: 'state-v1',
    checkpoint: { jobId, outlinePosition: input.outlinePosition },
  };
}

function publishThreeChapters(db: DB): {
  chapters: ChapterRepository;
  states: StoryStateRepository;
  lease: ProjectWriteLease;
  chapterThreeId: ChapterId;
  originalChapterThreeRevisionId: ChapterRevisionId;
  chapterTwoId: ChapterId;
  firstStateId: StoryStateRevisionId;
} {
  new ProjectRepository(db).create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });
  seedJob(db);
  seedLegacyCorrectionTables(db);
  const lease = new ProjectWriteLeaseRepository(db).acquire({
    projectId: fixtureProjectId,
    jobId,
    ownerId: 'worker-1',
    ttlMs: 60_000,
    now: new Date(fixtureTime),
  });
  const publication = new ChapterPublicationService(db, () => publicationTime);
  const chapters = new ChapterRepository(db);
  const states = new StoryStateRepository(db);

  seedCandidateAt(db, {
    position: 1,
    outlineId: fixtureOutlineId,
    chapterId: fixtureChapterId,
    revisionId: fixtureChapterRevisionId,
  });
  const first = publication.publishCandidate(publicationInput({
    lease,
    candidateRevisionId: fixtureChapterRevisionId,
    previousStateRevisionId: null,
    outlinePosition: 1,
  }));

  const chapterTwoId = chapterId('chapter-2');
  const secondRevisionId = chapterRevisionId('chapter-revision-2');
  seedCandidateAt(db, {
    position: 2,
    outlineId: outlineId('outline-2'),
    chapterId: chapterTwoId,
    revisionId: secondRevisionId,
  });
  const second = publication.publishCandidate(publicationInput({
    lease,
    candidateRevisionId: secondRevisionId,
    previousStateRevisionId: first.storyStateRevisionId,
    outlinePosition: 2,
  }));

  const chapterThreeId = chapterId('chapter-3');
  const originalChapterThreeRevisionId = chapterRevisionId('chapter-revision-3');
  seedCandidateAt(db, {
    position: 3,
    outlineId: outlineId('outline-3'),
    chapterId: chapterThreeId,
    revisionId: originalChapterThreeRevisionId,
  });
  publication.publishCandidate(publicationInput({
    lease,
    candidateRevisionId: originalChapterThreeRevisionId,
    previousStateRevisionId: second.storyStateRevisionId,
    outlinePosition: 3,
  }));

  return {
    chapters,
    states,
    lease,
    chapterThreeId,
    originalChapterThreeRevisionId,
    chapterTwoId,
    firstStateId: first.storyStateRevisionId,
  };
}

it('applyCorrectionDraft publishes a correction revision, keeps downstream text, and rebuilds state', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const {
    chapters,
    states,
    lease,
    chapterThreeId,
    originalChapterThreeRevisionId,
    firstStateId,
  } = publishThreeChapters(testDb.db);

  const originalChapterTwoRevisionId = chapters.getActiveRevision(chapterId('chapter-2'))?.id;
  assert.ok(originalChapterTwoRevisionId);

  const draftId = saveCorrectionDraft(testDb.db, {
    projectId: fixtureProjectId,
    chapterNumber: 2,
    strategy: 'rewrite',
    originalContent: '第 2 章正文',
    revisedContent: '第二章修正后正文',
    originalScore: 60,
    revisedScore: 78,
    issues: [{ dimension: 'writingQuality', score: 60 }],
    changes: [],
    revisedResult: {
      grade: 'B',
      dimensions: { writingQuality: { score: 78, analysis: '改进' } },
      suggestions: [{ content: '保持节奏' }],
      repetition: { within: 0, cross: 0, hotspots: [] },
    },
    engine: 'test-model',
  });

  const result = await applyCorrectionDraft({
    db: testDb.db,
    draftId,
    lease,
    state: emptyState('第二章修正状态'),
    delta: emptyDelta('第二章修正状态'),
    model: 'test-model',
    promptVersion: 'state-v1',
    now: () => publicationTime,
    extractState: async (input) => {
      const summary = `corrected-rebuild-${input.outlinePosition}`;
      return {
        state: emptyState(summary),
        delta: emptyDelta(summary),
        usage: { inputTokens: 0, outputTokens: 0, costRmb: 0, model: 'test-model', durationMs: 0 },
        model: 'test-model',
        promptVersion: 'state-v1',
      };
    },
  });

  assert.equal(result.chapterNumber, 2);
  assert.deepEqual(result.publish.staleImpact.affectedOutlinePositions, [2, 3]);
  assert.ok(result.rebuild);
  assert.deepEqual(result.rebuild.rebuiltOutlinePositions, [2, 3]);

  const activeTwo = chapters.getActiveRevision(chapterId('chapter-2'));
  assert.ok(activeTwo);
  assert.notEqual(activeTwo.id, originalChapterTwoRevisionId);
  assert.equal(activeTwo.source, 'correction');
  assert.equal(activeTwo.content, '第二章修正后正文');
  assert.equal(activeTwo.status, 'published');

  assert.equal(
    chapters.getActiveRevision(chapterThreeId)?.id,
    originalChapterThreeRevisionId,
  );
  assert.equal(
    chapters.getRevision(originalChapterThreeRevisionId)?.revision.content,
    '第 3 章正文',
  );

  const current1 = states.getCurrentAtPosition(fixtureProjectId, 1);
  const current2 = states.getCurrentAtPosition(fixtureProjectId, 2);
  const current3 = states.getCurrentAtPosition(fixtureProjectId, 3);
  assert.ok(current1);
  assert.ok(current2);
  assert.ok(current3);
  assert.equal(current1.id, firstStateId);
  assert.equal(current2.previousStateRevisionId, firstStateId);
  assert.equal(current3.previousStateRevisionId, current2.id);
  assert.equal(current2.chapterRevisionId, activeTwo.id);

  const history = getEvalHistory(testDb.db, fixtureProjectId, 2);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.verdict, 'pass');
  assert.equal(history[0]?.totalScore, 78);
  assert.equal(history[0]?.grade, 'B');
});
