/**
 * Job 管理器 — 内存 Map（SSE 订阅源）+ DB job 表（断点真相）双层桥接
 *
 * 状态语义与 writer job-store 对齐：running | paused | completed | failed | cancelled
 */
import { EventEmitter } from 'node:events';
import type { DB, JobRow, JobType } from '@novel-eval/writer';
import {
  createJobRow, updateJobStatus, updateJobProgress, getJobRow,
} from '@novel-eval/writer';

export type { JobType };
export type JobStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface JobEvent {
  step: string;
  msg: string;
  ts: number;
}

export interface Job {
  id: string;
  type: JobType;
  projectId: string;
  status: JobStatus;
  events: JobEvent[];
  result?: unknown;
  error?: string;
  /** 章节范围（chapter 类型用，供 resume 复用）*/
  fromChapter?: number;
  toChapter?: number;
  qualityGate?: boolean;
  maxRevise?: number;
  /** 已完成的最后一章（断点）*/
  lastChapter?: number;
  emitter: EventEmitter;
  /** 控制标志（runner 内部 GenerationControl 读这两个）*/
  pauseRequested: boolean;
  cancelRequested: boolean;
}

/** runner 接收的上下文：进度回调 + 控制句柄 */
export interface JobRunnerContext {
  onProgress: (step: string, msg: string) => void;
  control: {
    shouldPause: () => boolean;
    shouldCancel: () => boolean;
    onChapterComplete: (n: number) => void;
  };
  job: Job;
}

export interface CreateJobOpts {
  type: JobType;
  projectId: string;
  fromChapter?: number;
  toChapter?: number;
  qualityGate?: boolean;
  maxRevise?: number;
  engine?: string;
  model?: string;
  wordCount?: number;
  promptVersion?: string;
}

const jobs = new Map<string, Job>();

function budgetFlag(row: JobRow, key: 'qualityGate' | 'maxRevise'): boolean | number | undefined {
  const budget = row.budget;
  if (typeof budget !== 'object' || budget === null || Array.isArray(budget)) return undefined;
  const value = (budget as Record<string, unknown>)[key];
  if (key === 'qualityGate') return typeof value === 'boolean' ? value : undefined;
  return typeof value === 'number' ? value : undefined;
}

function resultFromRow(row: JobRow): unknown {
  const usage = row.usage;
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return undefined;
  return (usage as Record<string, unknown>).result;
}

function wireJobRunner(
  db: DB,
  job: Job,
  runner: (ctx: JobRunnerContext) => Promise<unknown>,
): void {
  const onProgress = (step: string, msg: string) => {
    const evt: JobEvent = { step, msg, ts: Date.now() };
    job.events.push(evt);
    job.emitter.emit('progress', evt);
  };

  const control = {
    shouldPause: () => job.pauseRequested,
    shouldCancel: () => job.cancelRequested,
    onChapterComplete: (n: number) => {
      job.lastChapter = n;
      updateJobProgress(db, job.id, n);
    },
  };

  runner({ onProgress, control, job })
    .then((result) => {
      job.status = 'completed';
      job.result = result;
      updateJobStatus(db, job.id, 'completed', { result });
      job.emitter.emit('completed', result);
    })
    .catch((err: unknown) => {
      const name = err instanceof Error ? err.name : '';
      if (name === 'JobPausedError') {
        job.status = 'paused';
        updateJobStatus(db, job.id, 'paused');
        job.emitter.emit('paused');
      } else if (name === 'JobCancelledError') {
        job.status = 'cancelled';
        updateJobStatus(db, job.id, 'cancelled');
        job.emitter.emit('cancelled');
      } else {
        const message = err instanceof Error ? err.message : 'job failed';
        job.status = 'failed';
        job.error = message;
        updateJobStatus(db, job.id, 'failed', { error: message });
        job.emitter.emit('failed', message);
      }
    })
    .finally(() => {
      const timer = setTimeout(() => {
        jobs.delete(job.id);
      }, 10 * 60 * 1000);
      timer.unref();
    });
}

/** 创建并启动一个 job，返回 jobId。runner 通过 ctx.control 与暂停/取消联动。*/
export function createJob(
  db: DB,
  opts: CreateJobOpts,
  runner: (ctx: JobRunnerContext) => Promise<unknown>,
): string {
  const id = createJobRow(db, {
    projectId: opts.projectId,
    type: opts.type,
    fromChapter: opts.fromChapter ?? null,
    toChapter: opts.toChapter ?? null,
    qualityGate: opts.qualityGate,
    maxRevise: opts.maxRevise,
    engine: opts.engine,
    model: opts.model,
    wordCount: opts.wordCount,
    promptVersion: opts.promptVersion,
  });

  const emitter = new EventEmitter();
  const job: Job = {
    id, type: opts.type, projectId: opts.projectId, status: 'running',
    events: [], emitter,
    fromChapter: opts.fromChapter, toChapter: opts.toChapter,
    qualityGate: opts.qualityGate, maxRevise: opts.maxRevise,
    lastChapter: opts.fromChapter ? opts.fromChapter - 1 : 0,
    pauseRequested: false, cancelRequested: false,
  };
  jobs.set(id, job);
  wireJobRunner(db, job, runner);
  return id;
}

/** 把 runner 挂到已有 job（resume 同 jobId）。*/
export function attachJobRunner(
  db: DB,
  jobId: string,
  runner: (ctx: JobRunnerContext) => Promise<unknown>,
): Job | null {
  const row = getJobRow(db, jobId);
  if (!row) return null;
  let job = jobs.get(jobId);
  if (!job) {
    job = {
      id: row.id,
      type: row.type,
      projectId: row.projectId,
      status: 'running',
      events: [],
      emitter: new EventEmitter(),
      fromChapter: row.scope.from ?? undefined,
      toChapter: row.scope.to ?? undefined,
      qualityGate: budgetFlag(row, 'qualityGate') === true,
      maxRevise: typeof budgetFlag(row, 'maxRevise') === 'number'
        ? Number(budgetFlag(row, 'maxRevise'))
        : undefined,
      lastChapter: row.lastOutlinePosition,
      pauseRequested: false,
      cancelRequested: false,
    };
    jobs.set(jobId, job);
  } else {
    job.status = 'running';
    job.pauseRequested = false;
    job.cancelRequested = false;
  }
  updateJobStatus(db, jobId, 'running');
  wireJobRunner(db, job, runner);
  return job;
}

export function getJob(jobId: string): Job | null {
  return jobs.get(jobId) ?? null;
}

/** 从 DB 恢复 job 到内存（进程重启后，前端刷新页面重连 SSE 用）*/
export function hydrateJobFromDb(db: DB, jobId: string): Job | null {
  const existing = jobs.get(jobId);
  if (existing) return existing;
  const row = getJobRow(db, jobId);
  if (!row) return null;
  // running 不可恢复（进程重启后不可能有活的 runner）
  if (row.status === 'running' || row.status === 'queued') return null;
  const status: JobStatus =
    row.status === 'completed' || row.status === 'failed'
    || row.status === 'paused' || row.status === 'cancelled'
      ? row.status
      : 'failed';
  const emitter = new EventEmitter();
  const job: Job = {
    id: row.id, type: row.type, projectId: row.projectId,
    status, events: [], emitter,
    fromChapter: row.scope.from ?? undefined,
    toChapter: row.scope.to ?? undefined,
    qualityGate: budgetFlag(row, 'qualityGate') === true,
    maxRevise: typeof budgetFlag(row, 'maxRevise') === 'number'
      ? Number(budgetFlag(row, 'maxRevise'))
      : undefined,
    lastChapter: row.lastOutlinePosition,
    pauseRequested: false, cancelRequested: false,
    result: resultFromRow(row),
    error: row.errorType ?? undefined,
  };
  jobs.set(jobId, job);
  return job;
}

/** 翻暂停标志（实际停在下一章边界）。若 job 不在内存（已重启），仅写 DB。*/
export function requestPause(db: DB, jobId: string): boolean {
  const job = jobs.get(jobId);
  if (job) {
    if (job.status !== 'running') return false;
    job.pauseRequested = true;
    return true;
  }

  const row = getJobRow(db, jobId);
  if (!row || row.status !== 'running') return false;
  updateJobStatus(db, jobId, 'paused');
  return true;
}

/** 翻取消标志（实际停在下一章边界）。*/
export function requestCancel(db: DB, jobId: string): boolean {
  const job = jobs.get(jobId);
  if (job) {
    if (job.status !== 'running' && job.status !== 'paused') return false;
    job.cancelRequested = true;
    if (job.status === 'paused') {
      job.status = 'cancelled';
      updateJobStatus(db, jobId, 'cancelled');
      job.emitter.emit('cancelled');
    }
  } else {
    const row = getJobRow(db, jobId);
    if (!row || (row.status !== 'running' && row.status !== 'paused')) return false;
    updateJobStatus(db, jobId, 'cancelled');
  }
  return true;
}

/** DB→内存同步：把内存 job 的终态信息也读出来（详情页展示用）*/
export function getJobFromDb(db: DB, jobId: string): JobRow | null {
  return getJobRow(db, jobId);
}

/** 检查该项目有正在运行的任务 */
export function hasActiveJobForProject(projectId: string): boolean {
  for (const job of jobs.values()) {
    if (job.projectId === projectId && job.status === 'running') {
      return true;
    }
  }
  return false;
}

export function jobToClientPayload(job: Job | JobRow): Record<string, unknown> {
  if ('emitter' in job) {
    return {
      id: job.id,
      type: job.type,
      projectId: job.projectId,
      status: job.status,
      events: job.events.length,
      lastChapter: job.lastChapter,
      fromChapter: job.fromChapter,
      toChapter: job.toChapter,
      result: job.result,
      error: job.error,
    };
  }
  return {
    id: job.id,
    type: job.type,
    projectId: job.projectId,
    status: job.status,
    lastChapter: job.lastOutlinePosition,
    fromChapter: job.scope.from,
    toChapter: job.scope.to,
    result: resultFromRow(job),
    error: job.errorType,
    qualityGate: budgetFlag(job, 'qualityGate') === true,
    maxRevise: budgetFlag(job, 'maxRevise') ?? 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
