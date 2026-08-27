/**
 * 剧情逻辑审计（推敲器）HTTP 路由 — 对齐 eval-tasks 模式
 *
 *   POST /api/audit/upload          上传全本 txt/md，后台跑审计
 *   GET  /api/audit/jobs/active     进行中的审计任务
 *   GET  /api/audit/:taskId/stream  SSE 进度
 *   GET  /api/audit/:taskId/result  审计报告（P0/P1/P2 逻辑洞清单）
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  getAuditJob,
  listActiveAuditJobs,
  runAuditTaskInBackground,
} from '../audit-jobs.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const auditTasksRouter = new Hono();

const ROUTE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(ROUTE_DIR, '..', '..');
const DEFAULT_AUDITS_DIR = path.join(WEB_ROOT, 'data', 'audits');

export function resolveAuditDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AUDIT_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : DEFAULT_AUDITS_DIR;
}

const AUDITS_DIR = resolveAuditDataDir();

async function ensureAuditsDir() {
  await fs.mkdir(AUDITS_DIR, { recursive: true });
}

function auditArtifactPath(taskId: string, extension: 'txt' | 'json'): string {
  return path.join(AUDITS_DIR, `${taskId}.${extension}`);
}

auditTasksRouter.post('/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400);
  }

  const taskId = randomUUID();
  await ensureAuditsDir();
  const filePath = auditArtifactPath(taskId, 'txt');
  const buffer = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));

  const genre = typeof body['genre'] === 'string' && body['genre'].trim() !== '' ? body['genre'].trim() : undefined;
  const title = typeof body['title'] === 'string' && body['title'].trim() !== ''
    ? body['title'].trim()
    : file.name;
  const climaxRaw = typeof body['climaxChapter'] === 'string' ? Number(body['climaxChapter']) : NaN;
  const climaxChapter = Number.isInteger(climaxRaw) && climaxRaw > 0 ? climaxRaw : undefined;

  runAuditTaskInBackground(taskId, { filePath, title, genre, climaxChapter }, { title })
    .then(async (report) => {
      await fs.writeFile(auditArtifactPath(taskId, 'json'), JSON.stringify(report, null, 2), 'utf-8');
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Audit task ${taskId} failed:`, message);
    });

  return c.json({ taskId });
});

auditTasksRouter.get('/jobs/active', (c) => {
  return c.json({ jobs: listActiveAuditJobs(20) });
});

auditTasksRouter.get('/:taskId/stream', (c) => {
  const taskId = c.req.param('taskId');

  return streamSSE(c, async (stream) => {
    const job = getAuditJob(taskId);
    if (!job) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Job not found' }) });
      return;
    }

    let lastSentIndex = 0;

    for (const msg of job.history) {
      await stream.writeSSE({ event: 'progress', data: msg });
      lastSentIndex++;
    }

    if (job.status === 'completed') {
      await stream.writeSSE({ event: 'done', data: 'completed' });
      return;
    }
    if (job.status === 'failed') {
      await stream.writeSSE({ event: 'error', data: job.error ?? 'Unknown error' });
      return;
    }

    while (true) {
      const current = getAuditJob(taskId);
      if (!current) break;

      if (current.history.length > lastSentIndex) {
        for (let i = lastSentIndex; i < current.history.length; i++) {
          await stream.writeSSE({ event: 'progress', data: current.history[i]! });
        }
        lastSentIndex = current.history.length;
      }

      if (current.status === 'completed') {
        await stream.writeSSE({ event: 'done', data: 'completed' });
        break;
      }
      if (current.status === 'failed') {
        await stream.writeSSE({ event: 'error', data: current.error ?? 'Unknown error' });
        break;
      }

      await stream.sleep(500);
    }
  });
});

auditTasksRouter.get('/:taskId/result', async (c) => {
  const taskId = c.req.param('taskId');

  const job = getAuditJob(taskId);
  if (job?.status === 'completed' && job.result) {
    return c.json(job.result);
  }

  try {
    const content = await fs.readFile(auditArtifactPath(taskId, 'json'), 'utf-8');
    return c.json(JSON.parse(content));
  } catch {
    return c.json({ error: 'Result not found or not ready' }, 404);
  }
});
