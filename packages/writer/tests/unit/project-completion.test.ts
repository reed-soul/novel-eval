import assert from 'node:assert/strict';
import { it } from 'node:test';

import { countChapters, countOutlines } from '../../src/chapter/store.ts';
import { outlineId } from '../../src/domain/ids.ts';
import {
  createJobRow,
  getJobRow,
  updateJobProgress,
  updateJobStatus,
} from '../../src/job-store.ts';
import {
  finalizeExhaustedResumeJob,
  isProjectFullyWritten,
} from '../../src/project-completion.ts';
import { getProject, updateProjectStatus } from '../../src/project.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import {
  fixtureProjectId,
  fixtureTime,
} from '../helpers/fixtures.ts';
import { createTestDb } from '../helpers/test-db.ts';

function seedProjectWithOutlines(
  db: ReturnType<typeof createTestDb>['db'],
  totalOutlines: number,
): void {
  new ProjectRepository(db).create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });
  updateProjectStatus(db, fixtureProjectId, 'writing');

  const planning = new PlanningRepository(db);
  for (let position = 1; position <= totalOutlines; position += 1) {
    planning.saveApprovedOutline({
      outline: {
        id: outlineId(`outline-${position}`),
        projectId: fixtureProjectId,
        position,
        createdAt: fixtureTime,
        updatedAt: fixtureTime,
      },
      revision: {
        id: `outline-revision-${position}`,
        revisionNumber: 1,
        title: `第 ${position} 章`,
        content: { summary: `摘要${position}`, beats: ['推进'] },
        createdAt: fixtureTime,
      },
    });
  }
}

function markChaptersWritten(
  db: ReturnType<typeof createTestDb>['db'],
  positions: number[],
): void {
  for (const position of positions) {
    const outline = db.prepare(
      'SELECT id FROM chapter_outline WHERE project_id = ? AND position = ?',
    ).get(fixtureProjectId, position) as { id: string };
    const chapterId = `chapter-${position}`;
    const revisionId = `chapter-revision-${position}`;
    db.prepare(`
      INSERT INTO chapter (id, project_id, outline_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(chapterId, fixtureProjectId, outline.id, fixtureTime);
    db.prepare(`
      INSERT INTO chapter_revision (
        id, chapter_id, revision_number, source, parent_revision_id, title, content,
        word_count, status, generation_run_id, created_at
      ) VALUES (?, ?, 1, 'generated', NULL, ?, ?, 1, 'published', ?, ?)
    `).run(
      revisionId,
      chapterId,
      `第 ${position} 章`,
      `正文${position}`,
      `run-${position}`,
      fixtureTime,
    );
    db.prepare('UPDATE chapter SET active_revision_id = ? WHERE id = ?').run(revisionId, chapterId);
    db.prepare(`
      UPDATE chapter_outline SET status = 'written', updated_at = ? WHERE id = ?
    `).run(fixtureTime, outline.id);
  }
}

it('job range 1-3 done with 12 outlines does not mark project completed', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());

  seedProjectWithOutlines(testDb.db, 12);
  markChaptersWritten(testDb.db, [1, 2, 3]);

  assert.equal(countOutlines(testDb.db, fixtureProjectId), 12);
  assert.equal(countChapters(testDb.db, fixtureProjectId), 3);
  assert.equal(isProjectFullyWritten(testDb.db, fixtureProjectId), false);

  const jobId = createJobRow(testDb.db, {
    projectId: fixtureProjectId,
    type: 'chapter',
    scope: { from: 1, to: 3 },
    engine: 'mock',
    model: 'mock',
    wordCount: 800,
  });
  updateJobProgress(testDb.db, jobId, 3);
  // Simulate paused job whose range is exhausted (resumeFrom > resumeTo).
  updateJobStatus(testDb.db, jobId, 'paused');

  const result = finalizeExhaustedResumeJob(testDb.db, {
    projectId: fixtureProjectId,
    jobId,
  });

  assert.equal(result.jobStatus, 'completed');
  assert.equal(result.projectCompleted, false);
  assert.equal(getJobRow(testDb.db, jobId)?.status, 'completed');
  assert.equal(getProject(testDb.db, fixtureProjectId)?.status, 'writing');
});

it('marks project completed only when chapters cover all outlines', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());

  seedProjectWithOutlines(testDb.db, 3);
  markChaptersWritten(testDb.db, [1, 2, 3]);

  const jobId = createJobRow(testDb.db, {
    projectId: fixtureProjectId,
    type: 'chapter',
    scope: { from: 1, to: 3 },
  });
  updateJobProgress(testDb.db, jobId, 3);
  updateJobStatus(testDb.db, jobId, 'paused');

  const result = finalizeExhaustedResumeJob(testDb.db, {
    projectId: fixtureProjectId,
    jobId,
  });

  assert.equal(result.projectCompleted, true);
  assert.equal(getProject(testDb.db, fixtureProjectId)?.status, 'completed');
});
