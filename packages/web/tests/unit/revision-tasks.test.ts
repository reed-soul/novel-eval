/**
 * Revision-task API routes — import / list / get / patch status.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

import {
  openDb,
  closeDb,
  createProject,
  type DB,
} from '@novel-eval/writer';
import { revisionTaskRoutes } from '../../server/routes/revision-tasks.ts';

let tempRoot: string;
let db: DB;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-revision-task-'));
  db = openDb({ path: join(tempRoot, 'writer.db') });
});

afterEach(() => {
  closeDb(db);
  rmSync(tempRoot, { recursive: true, force: true });
});

function testApp(database: DB) {
  const app = new Hono();
  app.route('/api/projects', revisionTaskRoutes(database));
  return app;
}

describe('revision-task routes', () => {
  it('imports suggestions, lists, patches status, and 400s on invalid status', async () => {
    const project = createProject(db, {
      title: 'Web 修订任务',
      genreProfile: '玄幻',
      targetAudience: '青年',
      premise: 'route test',
    });
    const app = testApp(db);

    const importRes = await app.fetch(new Request(
      `http://test/api/projects/${project.id}/revision-tasks/from-eval`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceEvalTaskId: 'eval-web-1',
          suggestions: [
            {
              dimension: 'storyStructure',
              content: '高潮铺垫不足',
              relatedChapters: ['12'],
            },
          ],
        }),
      },
    ));
    assert.equal(importRes.status, 201);
    const imported = await importRes.json() as {
      createdCount: number;
      tasks: Array<{ id: string; status: string; scope: string }>;
    };
    assert.equal(imported.createdCount, 1);
    assert.equal(imported.tasks[0]?.scope, 'chapter');
    const taskId = imported.tasks[0]!.id;

    const listRes = await app.fetch(new Request(
      `http://test/api/projects/${project.id}/revision-tasks?status=open`,
    ));
    assert.equal(listRes.status, 200);
    const listed = await listRes.json() as { tasks: unknown[] };
    assert.equal(listed.tasks.length, 1);

    const getRes = await app.fetch(new Request(
      `http://test/api/projects/${project.id}/revision-tasks/${taskId}`,
    ));
    assert.equal(getRes.status, 200);

    const badPatch = await app.fetch(new Request(
      `http://test/api/projects/${project.id}/revision-tasks/${taskId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'nope' }),
      },
    ));
    assert.equal(badPatch.status, 400);

    const patchRes = await app.fetch(new Request(
      `http://test/api/projects/${project.id}/revision-tasks/${taskId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    ));
    assert.equal(patchRes.status, 200);
    const patched = await patchRes.json() as { task: { status: string } };
    assert.equal(patched.task.status, 'done');
  });

  it('open-correction marks chapter-scoped task in_progress', async () => {
    const project = createProject(db, {
      title: '打开修正',
      genreProfile: '都市',
      targetAudience: '成年',
      premise: 'open-correction route',
    });
    const app = testApp(db);

    const importRes = await app.fetch(new Request(
      `http://test/api/projects/${project.id}/revision-tasks/from-eval`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxSuggestions: 1,
          suggestions: [
            {
              dimension: 'characterization',
              content: '单章可打开',
              relatedChapters: ['ch003'],
            },
            {
              dimension: 'thematicDepth',
              content: '全书应被截断',
            },
          ],
        }),
      },
    ));
    assert.equal(importRes.status, 201);
    const imported = await importRes.json() as {
      createdCount: number;
      tasks: Array<{ id: string; scope: string }>;
    };
    assert.equal(imported.createdCount, 1);
    assert.equal(imported.tasks[0]?.scope, 'chapter');
    const taskId = imported.tasks[0]!.id;

    const openRes = await app.fetch(new Request(
      `http://test/api/projects/${project.id}/revision-tasks/${taskId}/open-correction`,
      { method: 'POST' },
    ));
    assert.equal(openRes.status, 200);
    const opened = await openRes.json() as {
      chapterNumber: number;
      path: string;
      task: { status: string };
    };
    assert.equal(opened.chapterNumber, 3);
    assert.equal(opened.task.status, 'in_progress');
    assert.match(opened.path, /\/chapters\/3\/correction$/);
  });
});
