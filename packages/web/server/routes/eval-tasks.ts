import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
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
  const file = body['file'] as File | undefined;
  
  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400);
  }

  const taskId = randomUUID();
  const filePath = path.join(process.cwd(), 'data', 'evals', `${taskId}.txt`);
  
  await ensureEvalsDir();
  
  // 写入临时文件供 evaluator 读取
  const buffer = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));

  // 启动后台任务
  runEvalTaskInBackground(taskId, {
    filePath,
    profile: 'default',
    metadata: {
      genre: (body['genre'] as string) || '未知',
      targetAudience: (body['audience'] as string) || '全年龄',
      platform: 'web',
    }
  }).then(async (result) => {
    // 任务完成后，持久化结果 JSON
    const resultPath = path.join(EVALS_DIR, `${taskId}.json`);
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
    
    // 可选：清理原始 txt 文件以节省空间
    // await fs.unlink(filePath).catch(() => {});
  }).catch((err) => {
    console.error(`Eval task ${taskId} failed:`, err);
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
    
    // 发送历史记录
    for (const msg of job.history) {
      await stream.writeSSE({ event: 'progress', data: msg });
      lastSentIndex++;
    }

    // 处理当前已完成或失败的情况（防止错过流尾）
    if (job.status === 'completed') {
      await stream.writeSSE({ event: 'done', data: 'completed' });
      isConnected = false;
    } else if (job.status === 'failed') {
      await stream.writeSSE({ event: 'error', data: job.error ?? 'Unknown error' });
      isConnected = false;
    }

    // 持续轮询新消息
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
  
  // 先尝试从内存获取
  const job = getEvalJob(taskId);
  if (job?.status === 'completed' && job.result) {
    return c.json(job.result);
  }

  // 否则尝试从磁盘获取 JSON
  try {
    const resultPath = path.join(EVALS_DIR, `${taskId}.json`);
    const content = await fs.readFile(resultPath, 'utf-8');
    return c.json(JSON.parse(content));
  } catch (err) {
    return c.json({ error: 'Result not found or not ready' }, 404);
  }
});
