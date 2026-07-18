import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { evaluationCoverageFor, toEvaluationReportResponse } from '@novel-eval/shared';
import { EvaluationIncompleteError } from '@novel-eval/writer';
import { getEvalJob, listActiveEvalJobs, runEvalTaskInBackground } from '../eval-jobs.ts';
import { httpErrorJson, toHttpError } from '../middleware/error-mapper.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const evalTasksRouter = new Hono();

const ROUTE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(ROUTE_DIR, '..', '..');
const DEFAULT_EVALS_DIR = path.join(WEB_ROOT, 'data', 'evals');

export function resolveEvalDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.EVAL_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : DEFAULT_EVALS_DIR;
}

const EVALS_DIR = resolveEvalDataDir();

async function ensureEvalsDir() {
  await fs.mkdir(EVALS_DIR, { recursive: true });
}

function evalArtifactPath(taskId: string, extension: 'txt' | 'json'): string {
  return path.join(EVALS_DIR, `${taskId}.${extension}`);
}

function completeReportResponse(raw: unknown) {
  const report = toEvaluationReportResponse(raw);
  const coverage = evaluationCoverageFor({
    dimensions: report.dimensions,
    excerpts: report.excerpts,
    chapters: report.chapters,
    skippedChapterIds: report.coverage.skippedChapterIds,
    task: {
      chapterCount: report.coverage.chapterCount,
      sourceWordCount: report.coverage.sourceWordCount,
    },
  });
  if (!coverage.complete) {
    const reasons = coverage.incompleteReasons?.join('; ') || 'incomplete coverage';
    throw new EvaluationIncompleteError(`Evaluation report incomplete: ${reasons}`);
  }
  return { ...report, coverage };
}

function persistReportResponse(raw: unknown) {
  // Always persist flat DTO including incomplete coverage for later GET gating.
  const report = toEvaluationReportResponse(raw);
  const coverage = evaluationCoverageFor({
    dimensions: report.dimensions,
    excerpts: report.excerpts,
    chapters: report.chapters,
    skippedChapterIds: report.coverage.skippedChapterIds,
    task: {
      chapterCount: report.coverage.chapterCount,
      sourceWordCount: report.coverage.sourceWordCount,
    },
  });
  return { ...report, coverage };
}

function errorResponse(c: Context, error: unknown) {
  const mapped = toHttpError(error);
  return c.json(httpErrorJson(mapped), mapped.status as 400 | 402 | 409 | 422 | 500);
}

evalTasksRouter.post('/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400);
  }

  const taskId = randomUUID();
  const filePath = evalArtifactPath(taskId, 'txt');

  await ensureEvalsDir();

  const buffer = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));

  const profile = typeof body['profile'] === 'string' ? body['profile'] : 'default';
  const genre = typeof body['genre'] === 'string' ? body['genre'] : '未知';
  const audience = typeof body['audience'] === 'string' ? body['audience'] : '全年龄';
  const projectId = typeof body['projectId'] === 'string' && body['projectId'].trim() !== ''
    ? body['projectId'].trim()
    : null;
  const title = typeof body['title'] === 'string' && body['title'].trim() !== ''
    ? body['title'].trim()
    : (file instanceof File ? file.name : null);

  runEvalTaskInBackground(taskId, {
    filePath,
    profile,
    metadata: {
      genre,
      targetAudience: audience,
      platform: 'web',
    },
  }, { projectId, title }).then(async (result) => {
    const resultPath = evalArtifactPath(taskId, 'json');
    // Persist flat report even when incomplete; GET /result enforces the gate.
    const report = persistReportResponse(result);
    await fs.writeFile(resultPath, JSON.stringify(report, null, 2));
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Eval task ${taskId} failed:`, message);
  });

  return c.json({ taskId });
});

evalTasksRouter.get('/jobs/active', (c) => {
  return c.json({ jobs: listActiveEvalJobs(20) });
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
      return c.json(completeReportResponse(job.result));
    } catch (error: unknown) {
      return errorResponse(c, error);
    }
  }

  try {
    const resultPath = evalArtifactPath(taskId, 'json');
    const content = await fs.readFile(resultPath, 'utf-8');
    const raw: unknown = JSON.parse(content);
    return c.json(completeReportResponse(raw));
  } catch (error: unknown) {
    if (error instanceof EvaluationIncompleteError) {
      return errorResponse(c, error);
    }
    return c.json({ error: 'Result not found or not ready' }, 404);
  }
});
