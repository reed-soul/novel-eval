import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { ExtractStoryStateResult } from '../../src/chapter/finalizer.ts';
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
import { StateRebuildService } from '../../src/services/state-rebuild-service.ts';
import {
  fixtureChapterId,
  fixtureChapterRevisionId,
  fixtureOutlineId,
  fixtureProjectId,
  fixtureTime,
} from '../helpers/fixtures.ts';
import { createTestDb } from '../helpers/test-db.ts';

const jobId = 'job-rebuild-1';
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

function seedJob(db: DB): void {
  db.prepare(`
    INSERT INTO job (
      id, project_id, type, scope_json, input_json, engine, model, word_count,
      quality_profile, budget_json, prompt_version, status, created_at, updated_at
    ) VALUES (?, ?, 'chapter', '{}', '{}', 'test', 'test-model', 1000,
      'default', '{}', 'v1', 'running', ?, ?)
  `).run(jobId, fixtureProjectId, fixtureTime, fixtureTime);
}

function seedProject(db: DB): {
  chapters: ChapterRepository;
  states: StoryStateRepository;
  lease: ProjectWriteLease;
  publication: ChapterPublicationService;
  rebuild: StateRebuildService;
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
  const lease = new ProjectWriteLeaseRepository(db).acquire({
    projectId: fixtureProjectId,
    jobId,
    ownerId: 'worker-1',
    ttlMs: 60_000,
    now: new Date(fixtureTime),
  });
  return {
    chapters: new ChapterRepository(db),
    states: new StoryStateRepository(db),
    lease,
    publication: new ChapterPublicationService(db, () => publicationTime),
    rebuild: new StateRebuildService(db, () => publicationTime),
  };
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
  summary?: string;
}): PublishCandidateInput {
  const summary = input.summary ?? `第 ${input.outlinePosition} 章`;
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
  publication: ChapterPublicationService;
  rebuild: StateRebuildService;
  chapterThreeId: ChapterId;
  originalChapterThreeRevisionId: ChapterRevisionId;
  chapterTwoId: ChapterId;
  secondRevisionId: ChapterRevisionId;
  firstStateId: StoryStateRevisionId;
  secondStateId: StoryStateRevisionId;
  thirdStateId: StoryStateRevisionId;
} {
  const ctx = seedProject(db);
  seedCandidateAt(db, {
    position: 1,
    outlineId: fixtureOutlineId,
    chapterId: fixtureChapterId,
    revisionId: fixtureChapterRevisionId,
  });
  const first = ctx.publication.publishCandidate(publicationInput({
    lease: ctx.lease,
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
  const second = ctx.publication.publishCandidate(publicationInput({
    lease: ctx.lease,
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
  const third = ctx.publication.publishCandidate(publicationInput({
    lease: ctx.lease,
    candidateRevisionId: originalChapterThreeRevisionId,
    previousStateRevisionId: second.storyStateRevisionId,
    outlinePosition: 3,
  }));

  return {
    ...ctx,
    chapterThreeId,
    originalChapterThreeRevisionId,
    chapterTwoId,
    secondRevisionId,
    firstStateId: first.storyStateRevisionId,
    secondStateId: second.storyStateRevisionId,
    thirdStateId: third.storyStateRevisionId,
  };
}

it('historical publication invalidates N and later without deleting downstream chapters', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const {
    chapters,
    states,
    lease,
    publication,
    chapterThreeId,
    originalChapterThreeRevisionId,
    chapterTwoId,
    secondRevisionId,
    firstStateId,
  } = publishThreeChapters(testDb.db);

  const replacementRevisionId = chapterRevisionId('chapter-revision-2b');
  testDb.db.prepare(`
    INSERT INTO chapter_revision (
      id, chapter_id, revision_number, source, parent_revision_id, title, content,
      word_count, status, generation_run_id, created_at
    ) VALUES (?, ?, 2, 'correction', ?, '第二章修订', '第二章修订正文', 7, 'draft', NULL, ?)
  `).run(replacementRevisionId, chapterTwoId, secondRevisionId, fixtureTime);

  const result = publication.publishHistoricalRevision(publicationInput({
    lease,
    candidateRevisionId: replacementRevisionId,
    previousStateRevisionId: firstStateId,
    outlinePosition: 2,
    summary: '第二章修订状态',
  }));

  assert.deepEqual(result.staleImpact.affectedOutlinePositions, [2, 3]);
  assert.equal(
    chapters.getActiveRevision(chapterThreeId)?.id,
    originalChapterThreeRevisionId,
  );
  assert.equal(states.getCurrentAtPosition(fixtureProjectId, 3), null);
  assert.equal(states.listStale(fixtureProjectId).length, 2);
});

it('rebuildFrom extracts in outline order and appends a new current chain', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const {
    chapters,
    states,
    lease,
    publication,
    rebuild,
    chapterTwoId,
    secondRevisionId,
    firstStateId,
    secondStateId,
    thirdStateId,
  } = publishThreeChapters(testDb.db);

  const replacementRevisionId = chapterRevisionId('chapter-revision-2b');
  testDb.db.prepare(`
    INSERT INTO chapter_revision (
      id, chapter_id, revision_number, source, parent_revision_id, title, content,
      word_count, status, generation_run_id, created_at
    ) VALUES (?, ?, 2, 'correction', ?, '第二章修订', '第二章修订正文', 7, 'draft', NULL, ?)
  `).run(replacementRevisionId, chapterTwoId, secondRevisionId, fixtureTime);

  publication.publishHistoricalRevision(publicationInput({
    lease,
    candidateRevisionId: replacementRevisionId,
    previousStateRevisionId: firstStateId,
    outlinePosition: 2,
    summary: '第二章修订状态',
  }));

  const extractionOrder: number[] = [];
  const extractState = async (input: {
    outlinePosition: number;
    previousState: StoryState | null;
    chapterRevisionId: ChapterRevisionId;
    title: string;
    content: string;
  }): Promise<ExtractStoryStateResult> => {
    extractionOrder.push(input.outlinePosition);
    const summary = `rebuild-${input.outlinePosition}:${input.content}`;
    return {
      state: emptyState(summary),
      delta: emptyDelta(summary),
      usage: { inputTokens: 0, outputTokens: 0, costRmb: 0, model: 'test-model', durationMs: 0 },
      model: 'test-model',
      promptVersion: 'state-v1',
    };
  };

  const rebuildResult = await rebuild.rebuildFrom({
    projectId: fixtureProjectId,
    fromOutlinePosition: 2,
    lease,
    extractState,
  });

  assert.deepEqual(extractionOrder, [2, 3]);
  assert.deepEqual(rebuildResult.rebuiltOutlinePositions, [2, 3]);
  assert.equal(rebuildResult.failedAtOutlinePosition, null);

  const current1 = states.getCurrentAtPosition(fixtureProjectId, 1);
  const current2 = states.getCurrentAtPosition(fixtureProjectId, 2);
  const current3 = states.getCurrentAtPosition(fixtureProjectId, 3);
  assert.ok(current1);
  assert.ok(current2);
  assert.ok(current3);
  assert.equal(current1.id, firstStateId);
  assert.equal(current2.previousStateRevisionId, firstStateId);
  assert.equal(current3.previousStateRevisionId, current2.id);
  assert.equal(current2.chapterRevisionId, replacementRevisionId);
  assert.equal(
    current3.chapterRevisionId,
    chapters.getActiveRevision(chapterId('chapter-3'))?.id,
  );

  assert.equal(states.get(secondStateId)?.status, 'stale');
  assert.equal(states.get(thirdStateId)?.status, 'stale');
  assert.equal(states.get(secondStateId)?.summary, '第 2 章');
  assert.equal(states.get(thirdStateId)?.summary, '第 3 章');
});

it('rebuildFrom stops at the first extraction failure and leaves later positions stale', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const {
    states,
    lease,
    publication,
    rebuild,
    chapterTwoId,
    secondRevisionId,
    firstStateId,
    thirdStateId,
  } = publishThreeChapters(testDb.db);

  const replacementRevisionId = chapterRevisionId('chapter-revision-2b');
  testDb.db.prepare(`
    INSERT INTO chapter_revision (
      id, chapter_id, revision_number, source, parent_revision_id, title, content,
      word_count, status, generation_run_id, created_at
    ) VALUES (?, ?, 2, 'correction', ?, '第二章修订', '第二章修订正文', 7, 'draft', NULL, ?)
  `).run(replacementRevisionId, chapterTwoId, secondRevisionId, fixtureTime);

  publication.publishHistoricalRevision(publicationInput({
    lease,
    candidateRevisionId: replacementRevisionId,
    previousStateRevisionId: firstStateId,
    outlinePosition: 2,
    summary: '第二章修订状态',
  }));

  const rebuildResult = await rebuild.rebuildFrom({
    projectId: fixtureProjectId,
    fromOutlinePosition: 2,
    lease,
    extractState: async (input) => {
      if (input.outlinePosition === 3) {
        throw new Error('forced extraction failure at 3');
      }
      const summary = `rebuild-${input.outlinePosition}`;
      return {
        state: emptyState(summary),
        delta: emptyDelta(summary),
        usage: { inputTokens: 0, outputTokens: 0, costRmb: 0, model: 'test-model', durationMs: 0 },
        model: 'test-model',
        promptVersion: 'state-v1',
      };
    },
  });

  assert.deepEqual(rebuildResult.rebuiltOutlinePositions, [2]);
  assert.equal(rebuildResult.failedAtOutlinePosition, 3);
  assert.ok(states.getCurrentAtPosition(fixtureProjectId, 2));
  assert.equal(states.getCurrentAtPosition(fixtureProjectId, 3), null);
  assert.equal(states.get(thirdStateId)?.status, 'stale');
});
