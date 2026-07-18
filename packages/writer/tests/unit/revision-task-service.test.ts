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
    // Chapter-scoped first, then multi-chapter, then book-scoped.
    assert.equal(outcome.created[0]?.scope, 'chapter');
    assert.equal(outcome.created[1]?.scope, 'volume');
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

  it('maxSuggestions caps after chapter-scoped prioritization', () => {
    const outcome = service.importFromEval({
      projectId,
      replaceOpen: true,
      maxSuggestions: 2,
      suggestions: [
        { dimension: 'thematicDepth', content: '全书主题弱' },
        { dimension: 'pacingRetention', content: '跨章节奏', relatedChapters: ['ch-1', 'ch-2'] },
        { dimension: 'characterization', content: '单章人物', relatedChapters: ['ch-3'] },
        { dimension: 'writingQuality', content: '另一单章', relatedChapters: ['ch-4'] },
      ],
      now: '2026-07-17T12:00:30.000Z',
    });

    assert.equal(outcome.created.length, 2);
    assert.equal(outcome.created[0]?.scope, 'chapter');
    assert.equal(outcome.created[0]?.content, '单章人物');
    assert.equal(outcome.created[1]?.scope, 'chapter');
    assert.equal(outcome.created[1]?.content, '另一单章');
  });

  it('openCorrection resolves chapter-scoped tasks and marks in_progress', () => {
    const outcome = service.importFromEval({
      projectId,
      replaceOpen: true,
      suggestions: [
        {
          dimension: 'characterization',
          content: '打开修正目标章',
          relatedChapters: ['ch007'],
        },
      ],
      now: '2026-07-17T12:03:00.000Z',
    });
    const taskId = outcome.created[0]?.id;
    assert.ok(taskId);

    const opened = service.openCorrection({
      projectId,
      taskId,
      now: '2026-07-17T12:03:01.000Z',
    });
    assert.equal(opened.chapterNumber, 7);
    assert.equal(opened.task.status, 'in_progress');
    assert.match(opened.path, /\/chapters\/7\/correction\?revisionTaskId=/);
    assert.ok(opened.path.includes(encodeURIComponent(taskId)));
  });

  it('openCorrection rejects multi-chapter tasks', () => {
    const outcome = service.importFromEval({
      projectId,
      replaceOpen: true,
      suggestions: [
        {
          dimension: 'pacingRetention',
          content: '跨章不可直接打开',
          relatedChapters: ['ch-1', 'ch-2'],
        },
      ],
      now: '2026-07-17T12:04:00.000Z',
    });
    const taskId = outcome.created[0]?.id;
    assert.ok(taskId);

    assert.throws(
      () => service.openCorrection({ projectId, taskId }),
      (error: unknown) => error instanceof ValidationError
        && /spans 2 chapters|chapter-scoped/i.test(error.message),
    );
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
