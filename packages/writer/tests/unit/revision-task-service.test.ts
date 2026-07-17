import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createProject } from '../../src/project.ts';
import { ValidationError } from '../../src/domain/errors.ts';
import { RevisionTaskService } from '../../src/services/revision-task-service.ts';
import { createTestDb } from '../helpers/test-db.ts';

describe('RevisionTaskService', () => {
  const testDb = createTestDb();
  let projectId = '';
  const service = new RevisionTaskService(testDb.db);

  before(() => {
    const project = createProject(testDb.db, {
      title: '修订任务测试',
      genreProfile: '都市',
      targetAudience: '成年',
      premise: '评估建议落成清单',
    });
    projectId = project.id;
  });

  after(() => testDb.cleanup());

  it('imports suggestions from eval result and lists them', () => {
    const outcome = service.importFromEval({
      projectId,
      sourceEvalTaskId: 'eval-1',
      result: {
        suggestions: [
          {
            dimension: 'pacingRetention',
            content: '中段节奏拖沓，建议压缩过渡章',
            relatedChapters: ['ch-10', 'ch-11'],
            type: 'pacing',
          },
          {
            dimension: 'characterization',
            content: '主角动机不够清晰',
            relatedChapters: ['ch-3'],
          },
          {
            dimension: 'thematicDepth',
            content: '主题回响不足',
          },
        ],
      },
      now: '2026-07-17T12:00:00.000Z',
    });

    assert.equal(outcome.created.length, 3);
    assert.equal(outcome.dismissedOpenCount, 0);
    assert.equal(outcome.created[0]?.scope, 'volume');
    assert.equal(outcome.created[1]?.scope, 'chapter');
    assert.equal(outcome.created[2]?.scope, 'book');

    const listed = service.list(projectId, { status: 'open' });
    assert.equal(listed.length, 3);
    assert.ok(listed.every((task) => task.sourceEvalTaskId === 'eval-1'));
  });

  it('replaceOpen dismisses only open tasks and keeps done', () => {
    const existing = service.list(projectId, { status: 'open' });
    assert.ok(existing[0]);
    service.setStatus({
      projectId,
      taskId: existing[0].id,
      status: 'done',
      now: '2026-07-17T12:01:00.000Z',
    });

    const outcome = service.importFromEval({
      projectId,
      replaceOpen: true,
      suggestions: [
        { dimension: 'writingQuality', content: '对白可再精炼' },
      ],
      now: '2026-07-17T12:02:00.000Z',
    });

    assert.equal(outcome.created.length, 1);
    assert.equal(outcome.dismissedOpenCount, 2);

    const open = service.list(projectId, { status: 'open' });
    const done = service.list(projectId, { status: 'done' });
    const dismissed = service.list(projectId, { status: 'dismissed' });
    assert.equal(open.length, 1);
    assert.equal(done.length, 1);
    assert.equal(dismissed.length, 2);
    assert.equal(open[0]?.content, '对白可再精炼');
  });

  it('rejects invalid status updates', () => {
    const open = service.list(projectId, { status: 'open' });
    assert.ok(open[0]);
    assert.throws(
      () => service.setStatus({
        projectId,
        taskId: open[0].id,
        status: 'nope' as 'open',
      }),
      (error: unknown) => error instanceof ValidationError,
    );
  });
});
