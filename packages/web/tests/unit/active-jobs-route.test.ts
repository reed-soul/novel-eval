/**
 * GET /api/projects/jobs/active — list running/paused jobs across projects.
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
  createJobRow,
  updateJobStatus,
  type DB,
} from '@novel-eval/writer';
import { generateRoutes } from '../../server/routes/generate.ts';
import { EngineRegistry } from '../../server/engine-registry.ts';

let tempRoot: string;
let db: DB;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-active-jobs-'));
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

describe('GET /jobs/active', () => {
  it('returns running jobs with project titles', async () => {
    const project = createProject(db, {
      title: '进度可见',
      genreProfile: '都市',
      targetAudience: '青年',
      premise: 'active jobs banner',
    });
    const jobId = createJobRow(db, {
      projectId: project.id,
      type: 'chapter',
      scope: { from: 1, to: 3 },
      engine: 'mock',
      model: 'mock',
      wordCount: 800,
    });
    updateJobStatus(db, jobId, 'running');

    const app = new Hono();
    app.route('/api/projects', generateRoutes(db, mockRegistry()));
    const res = await app.fetch(new Request('http://test/api/projects/jobs/active'));
    assert.equal(res.status, 200);
    const body = await res.json() as {
      jobs: Array<{ id: string; projectTitle: string; status: string; type: string }>;
    };
    assert.equal(body.jobs.length, 1);
    assert.equal(body.jobs[0]?.id, jobId);
    assert.equal(body.jobs[0]?.projectTitle, '进度可见');
    assert.equal(body.jobs[0]?.status, 'running');
    assert.equal(body.jobs[0]?.type, 'chapter');
  });

  it('omits completed jobs', async () => {
    const project = createProject(db, {
      title: '已完成不展示',
      genreProfile: '都市',
      targetAudience: '青年',
      premise: 'completed job hidden',
    });
    const jobId = createJobRow(db, {
      projectId: project.id,
      type: 'correction',
      scope: { from: 2, to: 2 },
      engine: 'mock',
      model: 'mock',
    });
    updateJobStatus(db, jobId, 'completed');

    const app = new Hono();
    app.route('/api/projects', generateRoutes(db, mockRegistry()));
    const res = await app.fetch(new Request('http://test/api/projects/jobs/active'));
    assert.equal(res.status, 200);
    const body = await res.json() as { jobs: unknown[] };
    assert.equal(body.jobs.length, 0);
  });
});
