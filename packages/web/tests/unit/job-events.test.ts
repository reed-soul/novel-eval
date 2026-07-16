/**
 * Durable job events + resumable SSE + DB-backed active job detection
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

import {
  openDb,
  closeDb,
  createProject,
  createJobRow,
  getJobRow,
  appendJobEvent,
  listJobEventsAfter,
  updateJobStatus,
  type DB,
  type WriterApplication,
  type GenerateChapterRangeResult,
} from '@novel-eval/writer';
import {
  createJob,
  getJob,
  hasActiveJobForProject,
  type JobRunnerContext,
} from '../../server/jobs.ts';
import { generateRoutes } from '../../server/routes/generate.ts';
import { EngineRegistry } from '../../server/engine-registry.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

let tempRoot: string;
let db: DB;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-job-events-'));
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
        provider: 'openai',
        model: 'm',
        baseUrl: 'http://localhost',
        apiKeyEnv: 'NONE',
      },
    },
    'mock',
  );
}

function parseSseBlocks(body: string): Array<{ id?: string; data: string }> {
  const blocks: Array<{ id?: string; data: string }> = [];
  for (const raw of body.split('\n\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let id: string | undefined;
    let data: string | undefined;
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('id:')) id = line.slice(3).trim();
      if (line.startsWith('data:')) data = line.slice(5).trim();
    }
    if (data !== undefined) blocks.push({ id, data });
  }
  return blocks;
}

describe('job events and resumable SSE', () => {
  it('createJob persists complete input_json and budget_json', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const jobId = createJob(db, {
      type: 'chapter',
      projectId: p.id,
      fromChapter: 1,
      toChapter: 3,
      engine: 'mock',
      model: 'm',
      wordCount: 1200,
      promptVersion: 'chapter-v1',
      input: { from: 1, to: 3, wordCount: 1200, engineName: 'mock' },
      budget: { maxCostRmb: 2.5, qualityGate: false, maxRevise: 0 },
    }, async () => ({ chapters: 0 }));

    // let runner settle
    await new Promise((resolve) => setTimeout(resolve, 40));

    const row = getJobRow(db, jobId);
    assert.ok(row);
    assert.deepEqual(row.input, { from: 1, to: 3, wordCount: 1200, engineName: 'mock' });
    assert.deepEqual(row.budget, { maxCostRmb: 2.5, qualityGate: false, maxRevise: 0 });
  });

  it('hasActiveJobForProject reads running|paused from DB, not only memory', () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    assert.equal(hasActiveJobForProject(db, p.id), false);

    const jobId = createJobRow(db, {
      projectId: p.id,
      type: 'chapter',
      scope: { from: 1, to: 2 },
    });
    assert.equal(hasActiveJobForProject(db, p.id), true);

    updateJobStatus(db, jobId, 'paused');
    assert.equal(hasActiveJobForProject(db, p.id), true);

    updateJobStatus(db, jobId, 'completed');
    assert.equal(hasActiveJobForProject(db, p.id), false);
  });

  it('SSE emits event seq as id and honors Last-Event-ID / ?after=', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });

    let resolveProgress: ((ctx: JobRunnerContext) => void) | null = null;
    const progressReady = new Promise<JobRunnerContext>((resolve) => {
      resolveProgress = resolve;
    });

    const jobId = createJob(db, {
      type: 'chapter',
      projectId: p.id,
      fromChapter: 1,
      toChapter: 1,
      engine: 'mock',
      model: 'm',
      wordCount: 800,
      input: { from: 1, to: 1 },
      budget: { maxCostRmb: 5 },
    }, async (ctx) => {
      resolveProgress?.(ctx);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { chapters: 1 };
    });

    const ctx = await progressReady;
    ctx.onProgress('chapter:1', 'start');
    ctx.onProgress('chapter:1', 'done');

    const persisted = listJobEventsAfter(db, jobId, 0);
    assert.deepEqual(persisted.map((e) => e.seq), [1, 2]);

    const spyApp = {
      async generateChapterRange(): Promise<GenerateChapterRangeResult> {
        return { jobId, outcomes: [] };
      },
    } as unknown as WriterApplication;

    const app = new Hono();
    app.route('/api/projects', generateRoutes(db, mockRegistry(), spyApp));

    const fullRes = await app.fetch(new Request(
      `http://test/api/projects/jobs/${jobId}/events`,
    ));
    assert.equal(fullRes.status, 200);
    // Abort quickly after headers — stream may stay open while running.
    // Read with timeout by racing.
    const fullBody = await Promise.race([
      fullRes.text(),
      new Promise<string>((resolve) => setTimeout(async () => {
        // Partial read unavailable; re-fetch after job completes below.
        resolve('');
      }, 50)),
    ]);
    void fullBody;

    // Wait for job to finish so SSE closes
    await new Promise((resolve) => setTimeout(resolve, 250));

    const afterRes = await app.fetch(new Request(
      `http://test/api/projects/jobs/${jobId}/events?after=1`,
    ));
    assert.equal(afterRes.status, 200);
    const afterBody = await afterRes.text();
    const afterBlocks = parseSseBlocks(afterBody);
    const progressAfter = afterBlocks.filter((b) => {
      try {
        const parsed: unknown = JSON.parse(b.data);
        return typeof parsed === 'object' && parsed !== null && 'seq' in parsed;
      } catch {
        return false;
      }
    });
    assert.ok(progressAfter.length >= 1);
    assert.equal(progressAfter[0].id, '2');
    const firstPayload: unknown = JSON.parse(progressAfter[0].data);
    assert.ok(typeof firstPayload === 'object' && firstPayload !== null);
    assert.equal((firstPayload as { seq: number }).seq, 2);

    const headerRes = await app.fetch(new Request(
      `http://test/api/projects/jobs/${jobId}/events`,
      { headers: { 'Last-Event-ID': '1' } },
    ));
    assert.equal(headerRes.status, 200);
    const headerBody = await headerRes.text();
    const headerBlocks = parseSseBlocks(headerBody);
    const progressHeader = headerBlocks.filter((b) => b.id !== undefined && /^\d+$/.test(b.id));
    assert.ok(progressHeader.some((b) => b.id === '2'));
    assert.ok(!progressHeader.some((b) => b.id === '1'));
  });

  it('useJobProgress reconnects with last event id and polls status after retries', () => {
    const src = readFileSync(join(__dirname, '../../src/hooks/useJobProgress.ts'), 'utf8');
    assert.match(src, /after=/);
    assert.match(src, /lastEventId|last_event|lastSeen|Last-Event-ID|e\.lastEventId/);
    assert.match(src, /\/jobs\/\$\{jobId\}|\/jobs\/` \+|jobs\/\$\{/);
    assert.match(src, /MAX_RETRIES/);
    assert.match(src, /fetch\(/);
    assert.match(src, /status/);
  });

  it('memory Map alone is not enough for hasActiveJob — signature takes db', () => {
    const src = readFileSync(join(__dirname, '../../server/jobs.ts'), 'utf8');
    assert.match(src, /export function hasActiveJobForProject\(\s*db:\s*DB/);
    assert.match(src, /getActiveJob/);
    assert.equal(getJob('missing'), null);
  });
});
