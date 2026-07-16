import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { toEvaluationReportResponse } from '@novel-eval/shared';
import { getEvalJob, runEvalTaskInBackground } from '../eval-jobs.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const evalTasksRouter = new Hono();

const EVALS_DIR = path.join(process.cwd(), 'data', 'evals');

async function ensureEvalsDir() {
  await fs.mkdir(EVALS_DIR, { recursive: true });
}

evalTasksRouter.post('/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400);
  }

  const taskId = randomUUID();
  const filePath = path.join(process.cwd(), 'data', 'evals', `${taskId}.txt`);

  await ensureEvalsDir();

  const buffer = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));

  const profile = typeof body['profile'] === 'string' ? body['profile'] : 'default';
  const genre = typeof body['genre'] === 'string' ? body['genre'] : '未知';
  const audience = typeof body['audience'] === 'string' ? body['audience'] : '全年龄';

  runEvalTaskInBackground(taskId, {
    filePath,
    profile,
    metadata: {
      genre,
      targetAudience: audience,
      platform: 'web',
    },
  }).then(async (result) => {
    const resultPath = path.join(EVALS_DIR, `${taskId}.json`);
    // Persist the stable flat report DTO (unwrap evaluate() envelope)
    const report = toEvaluationReportResponse(result);
    await fs.writeFile(resultPath, JSON.stringify(report, null, 2));
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Eval task ${taskId} failed:`, message);
  });

  return c.json({ taskId });
});

evalTasksRouter.get('/:taskId/stream', (c) => {
  const taskId = c.req.param('taskId');

  return streamSSE(c, async (stream) => {
    const job = getEvalJob(taskId);
    if (!job) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Job not found' }) });
      return;
    }

    let lastSentIndex = 0;
    let isConnected = true;

    for (const msg of job.history) {
      await stream.writeSSE({ event: 'progress', data: msg });
      lastSentIndex++;
    }

    if (job.status === 'completed') {
      await stream.writeSSE({ event: 'done', data: 'completed' });
      isConnected = false;
    } else if (job.status === 'failed') {
      await stream.writeSSE({ event: 'error', data: job.error ?? 'Unknown error' });
      isConnected = false;
    }

    while (isConnected) {
      const currentJob = getEvalJob(taskId);
      if (!currentJob) break;

      if (currentJob.history.length > lastSentIndex) {
        for (let i = lastSentIndex; i < currentJob.history.length; i++) {
          await stream.writeSSE({ event: 'progress', data: currentJob.history[i] });
        }
        lastSentIndex = currentJob.history.length;
      }

      if (currentJob.status === 'completed') {
        await stream.writeSSE({ event: 'done', data: 'completed' });
        break;
      } else if (currentJob.status === 'failed') {
        await stream.writeSSE({ event: 'error', data: currentJob.error ?? 'Unknown error' });
        break;
      }

      await stream.sleep(500);
    }
  });
});

evalTasksRouter.get('/:taskId/result', async (c) => {
  const taskId = c.req.param('taskId');

  const job = getEvalJob(taskId);
  if (job?.status === 'completed' && job.result) {
    try {
      return c.json(toEvaluationReportResponse(job.result));
    } catch {
      return c.json({ error: 'Result malformed', code: 'InternalError', message: 'Result malformed' }, 500);
    }
  }

  try {
    const resultPath = path.join(EVALS_DIR, `${taskId}.json`);
    const content = await fs.readFile(resultPath, 'utf-8');
    const raw: unknown = JSON.parse(content);
    return c.json(toEvaluationReportResponse(raw));
  } catch {
    return c.json({ error: 'Result not found or not ready' }, 404);
  }
});
