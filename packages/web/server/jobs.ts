/**
 * Job 管理器 — 内存 Map + EventEmitter，桥接 onProgress 回调到 SSE
 *
 * 流程：
 *   POST 生成端点 → createJob(type, runner) → 立即返回 {jobId}
 *   runner 内部调 onProgress(step, msg) → job.emit('progress') + events.push
 *   GET /api/jobs/:jobId/events (SSE) → 订阅 emitter，推历史 + 后续 events
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export type JobType = 'bible' | 'outline' | 'chapter' | 'auto';
export type JobStatus = 'running' | 'done' | 'error';

export interface JobEvent {
  step: string;
  msg: string;
  ts: number;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  events: JobEvent[];
  result?: unknown;
  error?: string;
  emitter: EventEmitter;
}

const jobs = new Map<string, Job>();

/** 创建并启动一个 job，返回 jobId */
export function createJob(
  type: JobType,
  runner: (onProgress: (step: string, msg: string) => void) => Promise<unknown>,
): string {
  const id = randomUUID();
  const emitter = new EventEmitter();
  const job: Job = { id, type, status: 'running', events: [], emitter };
  jobs.set(id, job);

  const onProgress = (step: string, msg: string) => {
    const evt: JobEvent = { step, msg, ts: Date.now() };
    job.events.push(evt);
    emitter.emit('progress', evt);
  };

  // 后台运行（不 await，立即返回 jobId）
  runner(onProgress)
    .then((result) => {
      job.status = 'done';
      job.result = result;
      emitter.emit('done', result);
    })
    .catch((err) => {
      job.status = 'error';
      job.error = (err as Error).message;
      emitter.emit('error', (err as Error).message);
    });

  return id;
}

export function getJob(jobId: string): Job | null {
  return jobs.get(jobId) ?? null;
}
