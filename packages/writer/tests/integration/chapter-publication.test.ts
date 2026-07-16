import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { DB } from '../../src/db.ts';
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
import { ChapterPublicationService } from '../../src/services/chapter-publication-service.ts';
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
