/**
 * Job 管理器 — 内存 Map（SSE 订阅源）+ DB job 表（断点/事件真相）双层桥接
 *
 * 状态语义与 writer job-store 对齐：running | paused | completed | failed | cancelled
 */
import { EventEmitter } from 'node:events';
import type { DB, JobRow, JobType, JsonValue } from '@novel-eval/writer';
import {
  appendJobEvent,
  createJobRow,
  getActiveJob,
  getJobRow,
  getLatestJobEventSeq,
  listJobEventsAfter,
  updateJobProgress,
  updateJobStatus,
} from '@novel-eval/writer';

export type { JobType };
export type JobStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface JobEvent {
  seq: number;
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
  /** 下一个要分配的事件 seq */
  nextEventSeq: number;
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
  /** 完整请求快照，写入 job.input_json */
  input?: JsonValue;
  /** 完整预算快照，写入 job.budget_json */
  budget?: JsonValue;
}

const jobs = new Map<string, Job>();

function budgetFlag(row: JobRow, key: 'qualityGate' | 'maxRevise'): boolean | number | undefined {
  const budget = row.budget;
  if (typeof budget !== 'object' || budget === null || Array.isArray(budget)) return undefined;
  const value = budget[key];
  if (key === 'qualityGate') return typeof value === 'boolean' ? value : undefined;
  return typeof value === 'number' ? value : undefined;
}

function resultFromRow(row: JobRow): unknown {
  const usage = row.usage;
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return undefined;
  return usage.result;
}

function loadPersistedEvents(db: DB, jobId: string): JobEvent[] {
  return listJobEventsAfter(db, jobId, 0).map((event) => ({
    seq: event.seq,
    step: event.step,
    msg: event.msg,
    ts: event.ts,
  }));
}

function wireJobRunner(
  db: DB,
  job: Job,
  runner: (ctx: JobRunnerContext) => Promise<unknown>,
): void {
  const onProgress = (step: string, msg: string) => {
    const seq = job.nextEventSeq;
    job.nextEventSeq += 1;
    const evt: JobEvent = { seq, step, msg, ts: Date.now() };
    appendJobEvent(db, { jobId: job.id, seq, step, msg, ts: evt.ts });
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
        updateJobStatus(db, job.id, 'failed', {
          error: message,
          errorType: err instanceof Error ? err.name : 'Error',
        });
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

function resolveBudget(opts: CreateJobOpts): JsonValue {
  if (opts.budget !== undefined) return opts.budget;
  if (opts.qualityGate !== undefined || opts.maxRevise !== undefined) {
    return {
      qualityGate: opts.qualityGate ?? false,
      maxRevise: opts.maxRevise ?? 0,
    };
  }
  return {};
}

function resolveInput(opts: CreateJobOpts): JsonValue {
  if (opts.input !== undefined) return opts.input;
  const input: { [key: string]: JsonValue } = {};
  if (opts.fromChapter !== undefined) input.from = opts.fromChapter;
  if (opts.toChapter !== undefined) input.to = opts.toChapter;
  if (opts.wordCount !== undefined) input.wordCount = opts.wordCount;
  if (opts.engine !== undefined) input.engine = opts.engine;
  if (opts.model !== undefined) input.model = opts.model;
  if (opts.promptVersion !== undefined) input.promptVersion = opts.promptVersion;
  return input;
}

/** 创建并启动一个 job，返回 jobId。runner 通过 ctx.control 与暂停/取消联动。*/
export function createJob(
  db: DB,
  opts: CreateJobOpts,
  runner: (ctx: JobRunnerContext) => Promise<unknown>,
): string {
  const budget = resolveBudget(opts);
  const input = resolveInput(opts);
  const id = createJobRow(db, {
    projectId: opts.projectId,
    type: opts.type,
    fromChapter: opts.fromChapter ?? null,
    toChapter: opts.toChapter ?? null,
    engine: opts.engine,
    model: opts.model,
    wordCount: opts.wordCount,
    promptVersion: opts.promptVersion,
    budget,
    input,
  });

  const emitter = new EventEmitter();
  const job: Job = {
    id, type: opts.type, projectId: opts.projectId, status: 'running',
    events: [], emitter,
    fromChapter: opts.fromChapter, toChapter: opts.toChapter,
    qualityGate: opts.qualityGate, maxRevise: opts.maxRevise,
    lastChapter: opts.fromChapter ? opts.fromChapter - 1 : 0,
    pauseRequested: false, cancelRequested: false,
    nextEventSeq: 1,
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
  const persistedEvents = loadPersistedEvents(db, jobId);
  const nextEventSeq = getLatestJobEventSeq(db, jobId) + 1;
  let job = jobs.get(jobId);
  if (!job) {
    job = {
      id: row.id,
      type: row.type,
      projectId: row.projectId,
      status: 'running',
      events: persistedEvents,
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
      nextEventSeq,
    };
    jobs.set(jobId, job);
  } else {
    job.status = 'running';
    job.pauseRequested = false;
    job.cancelRequested = false;
    job.events = persistedEvents;
    job.nextEventSeq = nextEventSeq;
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
  const events = loadPersistedEvents(db, jobId);
  const emitter = new EventEmitter();
  const job: Job = {
    id: row.id, type: row.type, projectId: row.projectId,
    status, events, emitter,
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
    nextEventSeq: getLatestJobEventSeq(db, jobId) + 1,
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

/**
 * 检查该项目是否有活动任务。以 DB 的 running|paused 为准，
 * 不依赖进程内 Map（重启后 Map 为空仍能挡住并发）。
 */
export function hasActiveJobForProject(db: DB, projectId: string): boolean {
  return getActiveJob(db, projectId) !== null;
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

export function parseAfterSeq(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) return 0;
  return value;
}
