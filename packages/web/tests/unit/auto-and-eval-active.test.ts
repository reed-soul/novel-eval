/**
 * POST /api/projects/auto validation + GET /api/eval/jobs/active
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

import { openDb, closeDb, createProject, createJobRow, getJobRow, type DB } from '@novel-eval/writer';
import { generateRoutes } from '../../server/routes/generate.ts';
import { EngineRegistry } from '../../server/engine-registry.ts';
import { evalTasksRouter } from '../../server/routes/eval-tasks.ts';
import {
  createEvalJob,
  appendEvalProgress,
  completeEvalJob,
} from '../../server/eval-jobs.ts';

let tempRoot: string;
let db: DB;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-auto-eval-'));
  db = openDb({ path: join(tempRoot, 'writer.db') });
});

afterEach(() => {
  closeDb(db);
  rmSync(tempRoot, { recursive: true, force: true });
});

function mockRegistry(): EngineRegistry {
  return new EngineRegistry(
    {
      mock: {
        name: 'mock',
        provider: 'deepseek',
        model: 'm',
        baseUrl: 'http://localhost',
        apiKeyEnv: 'NONE',
      },
    },
    'mock',
  );
}

describe('POST /api/projects/auto', () => {
  it('rejects when approvePlanning is missing', async () => {
    const app = new Hono();
    app.route('/api/projects', generateRoutes(db, mockRegistry()));
    const res = await app.fetch(new Request('http://test/api/projects/auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '星海',
        genre: '科幻',
        audience: '青年',
        topic: '余响',
        chapters: 3,
      }),
    }));
    assert.equal(res.status, 400);
    const body = await res.json() as { error?: string; message?: string };
    const text = `${body.error ?? ''} ${body.message ?? ''}`;
    assert.match(text, /approvePlanning/);
  });

  it('persists auto job type on the project', () => {
    const project = createProject(db, {
      title: '星海',
      genreProfile: '科幻',
      targetAudience: '青年',
      premise: '余响',
    });
    const jobId = createJobRow(db, {
      projectId: project.id,
      type: 'auto',
      scope: { from: 1, to: 3 },
      engine: 'mock',
      model: 'mock',
      wordCount: 800,
    });
    const row = getJobRow(db, jobId);
    assert.ok(row);
    assert.equal(row.type, 'auto');
    assert.equal(row.scope.from, 1);
    assert.equal(row.scope.to, 3);
  });
});

describe('GET /api/eval/jobs/active', () => {
  it('lists running eval jobs with latest message', async () => {
    const taskId = 'eval-active-1';
    createEvalJob(taskId, { projectId: 'proj-1', title: '评估中的书' });
    appendEvalProgress(taskId, '正在分析第 1 章…');

    const app = new Hono();
    app.route('/api/eval', evalTasksRouter);
    const res = await app.fetch(new Request('http://test/api/eval/jobs/active'));
    assert.equal(res.status, 200);
    const body = await res.json() as {
      jobs: Array<{
        taskId: string;
        status: string;
        latestMessage: string | null;
        projectId: string | null;
        title: string | null;
      }>;
    };
    const hit = body.jobs.find((j) => j.taskId === taskId);
    assert.ok(hit);
    assert.equal(hit.status, 'running');
    assert.equal(hit.latestMessage, '正在分析第 1 章…');
    assert.equal(hit.projectId, 'proj-1');
    assert.equal(hit.title, '评估中的书');

    completeEvalJob(taskId, {} as never);
    const after = await app.fetch(new Request('http://test/api/eval/jobs/active'));
    const afterBody = await after.json() as { jobs: Array<{ taskId: string }> };
    assert.equal(afterBody.jobs.some((j) => j.taskId === taskId), false);
  });
});
