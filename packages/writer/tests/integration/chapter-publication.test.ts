import assert from 'node:assert/strict';
import { it } from 'node:test';

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
import {
  fixtureChapterId,
  fixtureChapterRevisionId,
  fixtureOutlineId,
  fixtureProjectId,
  fixtureStoryState,
  fixtureStoryStateDelta,
  fixtureTime,
} from '../helpers/fixtures.ts';
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
import { createTestDb } from '../helpers/test-db.ts';

const jobId = 'job-1';
const publicationTime = new Date('2026-07-16T09:00:30.000Z');

function seedJob(db: DB): void {
  db.prepare(`
    INSERT INTO job (
      id, project_id, type, scope_json, input_json, engine, model, word_count,
      quality_profile, budget_json, prompt_version, status, created_at, updated_at
    ) VALUES (?, ?, 'chapter', '{}', '{}', 'test', 'test-model', 1000,
      'default', '{}', 'v1', 'running', ?, ?)
  `).run(jobId, fixtureProjectId, fixtureTime, fixtureTime);
}

function seedPublication(db: DB): {
  chapters: ChapterRepository;
  states: StoryStateRepository;
  lease: ProjectWriteLease;
  publication: ChapterPublicationService;
} {
  new ProjectRepository(db).create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });
  new PlanningRepository(db).saveApprovedOutline({
    outline: {
      id: fixtureOutlineId,
      projectId: fixtureProjectId,
      position: 1,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: 'outline-revision-1',
      revisionNumber: 1,
      title: '北站',
      content: { summary: '林晚抵达北站。', beats: ['抵达', '发现'] },
      createdAt: fixtureTime,
    },
  });
  const chapters = new ChapterRepository(db);
  chapters.saveCandidate({
    chapter: {
      id: fixtureChapterId,
      projectId: fixtureProjectId,
      outlineId: fixtureOutlineId,
      createdAt: fixtureTime,
    },
    revision: {
      id: fixtureChapterRevisionId,
      revisionNumber: 1,
      source: 'generated',
      parentRevisionId: null,
      title: '北站',
      content: '林晚抵达北站。',
      wordCount: 8,
      status: 'draft',
      generationRunId: 'run-1',
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
    chapters,
    states: new StoryStateRepository(db),
    lease,
    publication: new ChapterPublicationService(db, () => publicationTime),
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

it('publishes revision, outline, state and checkpoint atomically', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { chapters, states, lease, publication } = seedPublication(testDb.db);

  const result = publication.publishCandidate({
    lease,
    candidateRevisionId: fixtureChapterRevisionId,
    previousStateRevisionId: null,
    state: fixtureStoryState(),
    delta: fixtureStoryStateDelta(),
    model: 'test-model',
    promptVersion: 'state-v1',
    checkpoint: { jobId, outlinePosition: 1 },
  });

  assert.equal(result.outlineStatus, 'written');
  assert.equal(chapters.getActiveRevision(fixtureChapterId)?.id, fixtureChapterRevisionId);
  assert.equal(
    states.getCurrentAtPosition(fixtureProjectId, 1)?.chapterRevisionId,
    fixtureChapterRevisionId,
  );
  assert.deepEqual(
    testDb.db.prepare(
      'SELECT last_outline_position, checkpoint_json FROM job WHERE id = ?',
    ).get(jobId),
    {
      last_outline_position: 1,
      checkpoint_json: '{"outlinePosition":1}',
    },
  );
});

it('rolls back every publication write when story state insertion fails', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { chapters, states, lease, publication } = seedPublication(testDb.db);
  testDb.db.exec(`
    CREATE TEMP TRIGGER reject_story_state_insert
    BEFORE INSERT ON story_state_revision
    BEGIN
      SELECT RAISE(ABORT, 'forced story state failure');
    END
  `);

  assert.throws(() => publication.publishCandidate({
    lease,
    candidateRevisionId: fixtureChapterRevisionId,
    previousStateRevisionId: null,
    state: fixtureStoryState(),
    delta: fixtureStoryStateDelta(),
    model: 'test-model',
    promptVersion: 'state-v1',
    checkpoint: { jobId, outlinePosition: 1 },
  }), /forced story state failure/);

  assert.equal(chapters.getRevision(fixtureChapterRevisionId)?.revision.status, 'draft');
  assert.equal(chapters.getActiveRevision(fixtureChapterId), null);
  assert.equal(states.getCurrentAtPosition(fixtureProjectId, 1), null);
  assert.deepEqual(
    testDb.db.prepare(
      'SELECT status FROM chapter_outline WHERE id = ?',
    ).get(fixtureOutlineId),
    { status: 'approved' },
  );
  assert.deepEqual(
    testDb.db.prepare(
      'SELECT last_outline_position, checkpoint_json FROM job WHERE id = ?',
    ).get(jobId),
    { last_outline_position: 0, checkpoint_json: null },
  );
});

it('rejects publication when the lease expires after the entrance check', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { lease } = seedPublication(testDb.db);
  let clockReads = 0;
  const publication = new ChapterPublicationService(testDb.db, () => {
    clockReads += 1;
    return clockReads === 1
      ? publicationTime
      : new Date('2026-07-16T09:01:00.000Z');
  });

  assert.throws(
    () => publication.publishCandidate(publicationInput({
      lease,
      candidateRevisionId: fixtureChapterRevisionId,
      previousStateRevisionId: null,
      outlinePosition: 1,
    })),
    /lease/i,
  );
});

it('rejects publication when the lease is replaced before the transaction check', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { lease, publication } = seedPublication(testDb.db);
  const leases = new ProjectWriteLeaseRepository(testDb.db);
  let projectReads = 0;
  const racingLease: ProjectWriteLease = {
    id: lease.id,
    get projectId() {
      projectReads += 1;
      if (projectReads === 2) {
        leases.release({ leaseId: lease.id, ownerId: lease.ownerId });
        leases.acquire({
          projectId: lease.projectId,
          jobId: lease.jobId,
          ownerId: 'replacement-worker',
          ttlMs: 60_000,
          now: new Date(fixtureTime),
        });
      }
      return lease.projectId;
    },
    jobId: lease.jobId,
    ownerId: lease.ownerId,
    expiresAt: lease.expiresAt,
    createdAt: lease.createdAt,
    updatedAt: lease.updatedAt,
  };

  assert.throws(
    () => publication.publishCandidate(publicationInput({
      lease: racingLease,
      candidateRevisionId: fixtureChapterRevisionId,
      previousStateRevisionId: null,
      outlinePosition: 1,
    })),
    /lease/i,
  );
});

it('rejects position N without the current state from position N-1', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { lease, publication } = seedPublication(testDb.db);
  const secondRevisionId = chapterRevisionId('chapter-revision-2');
  seedCandidateAt(testDb.db, {
    position: 2,
    outlineId: outlineId('outline-2'),
    chapterId: chapterId('chapter-2'),
    revisionId: secondRevisionId,
  });

  assert.throws(
    () => publication.publishCandidate(publicationInput({
      lease,
      candidateRevisionId: secondRevisionId,
      previousStateRevisionId: null,
      outlinePosition: 2,
    })),
    /requires the current state from chapter 1/,
  );
});

it('marks downstream states stale without deleting downstream chapters or revisions', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const { chapters, states, lease, publication } = seedPublication(testDb.db);
  const first = publication.publishCandidate(publicationInput({
    lease,
    candidateRevisionId: fixtureChapterRevisionId,
    previousStateRevisionId: null,
    outlinePosition: 1,
  }));

  const secondChapterId = chapterId('chapter-2');
  const secondRevisionId = chapterRevisionId('chapter-revision-2');
  seedCandidateAt(testDb.db, {
    position: 2,
    outlineId: outlineId('outline-2'),
    chapterId: secondChapterId,
    revisionId: secondRevisionId,
  });
  const second = publication.publishCandidate(publicationInput({
    lease,
    candidateRevisionId: secondRevisionId,
    previousStateRevisionId: first.storyStateRevisionId,
    outlinePosition: 2,
  }));

  const thirdChapterId = chapterId('chapter-3');
  const thirdRevisionId = chapterRevisionId('chapter-revision-3');
  seedCandidateAt(testDb.db, {
    position: 3,
    outlineId: outlineId('outline-3'),
    chapterId: thirdChapterId,
    revisionId: thirdRevisionId,
  });
  const third = publication.publishCandidate(publicationInput({
    lease,
    candidateRevisionId: thirdRevisionId,
    previousStateRevisionId: second.storyStateRevisionId,
    outlinePosition: 3,
  }));

  const replacementRevisionId = chapterRevisionId('chapter-revision-2b');
  testDb.db.prepare(`
    INSERT INTO chapter_revision (
      id, chapter_id, revision_number, source, parent_revision_id, title, content,
      word_count, status, generation_run_id, created_at
    ) VALUES (?, ?, 2, 'correction', ?, '第二章修订', '第二章修订正文', 7, 'draft', NULL, ?)
  `).run(replacementRevisionId, secondChapterId, secondRevisionId, fixtureTime);

  const replacement = publication.publishCandidate(publicationInput({
    lease,
    candidateRevisionId: replacementRevisionId,
    previousStateRevisionId: first.storyStateRevisionId,
    outlinePosition: 2,
  }));

  assert.equal(states.get(second.storyStateRevisionId)?.status, 'stale');
  assert.equal(states.get(third.storyStateRevisionId)?.status, 'stale');
  assert.equal(states.get(replacement.storyStateRevisionId)?.status, 'current');
  assert.equal(chapters.getActiveRevision(thirdChapterId)?.id, thirdRevisionId);
  assert.equal(chapters.getRevision(thirdRevisionId)?.revision.id, thirdRevisionId);
});
