/**
 * Job 管理器 — 内存 Map（SSE 订阅源）+ DB job 表（断点真相）双层桥接
 *
 * 流程：
 *   POST 生成端点 → createJob(...) → 立即返回 {jobId}
 *   runner 内部调 onProgress(step, msg) → emit('progress') + events.push + 同步可选回调
 *   GET /api/jobs/:jobId/events (SSE) → 订阅 emitter，推历史 + 后续 events
 *
 * 暂停/取消（章节边界生效）：
 *   pauseJob(jobId) → 翻 pauseRequested 标志 + 写 DB status='paused'
 *     generateRange 在每章开头检查 control.shouldPause，抛 JobPausedError
 *     runner.catch 识别此错误，写 DB status='paused'，emit('paused')
 *   resumeJob → 由路由层新建一个 job 续跑（见 generate.ts）
 *
 * 内存 job 进程重启即失，DB job 表是真相来源。
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { DB } from '@novel-eval/writer';
import {
  createJobRow, updateJobStatus, updateJobProgress, getJobRow,
  type JobType, type JobRow,
} from '@novel-eval/writer';

export type { JobType };
export type JobStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled';

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
}

const jobs = new Map<string, Job>();

/** 创建并启动一个 job，返回 jobId。runner 通过 ctx.control 与暂停/取消联动。*/
export function createJob(
  db: DB,
  opts: CreateJobOpts,
  runner: (ctx: JobRunnerContext) => Promise<unknown>,
): string {
  // 1. DB 记录（真相来源）
  const id = createJobRow(db, {
    projectId: opts.projectId,
    type: opts.type,
    fromChapter: opts.fromChapter ?? null,
    toChapter: opts.toChapter ?? null,
    qualityGate: opts.qualityGate,
    maxRevise: opts.maxRevise,
  });

  // 2. 内存 Job（SSE 源）
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

  const onProgress = (step: string, msg: string) => {
    const evt: JobEvent = { step, msg, ts: Date.now() };
    job.events.push(evt);
    emitter.emit('progress', evt);
  };

  const control = {
    shouldPause: () => job.pauseRequested,
    shouldCancel: () => job.cancelRequested,
    onChapterComplete: (n: number) => {
      job.lastChapter = n;
      updateJobProgress(db, id, n);
    },
  };

  // 3. 后台运行（不 await，立即返回 jobId）
  runner({ onProgress, control, job })
    .then((result) => {
      job.status = 'done';
      job.result = result;
      updateJobStatus(db, id, 'done', { result });
      emitter.emit('done', result);
    })
    .catch((err) => {
      const name = (err as Error)?.name;
      if (name === 'JobPausedError') {
        job.status = 'paused';
        updateJobStatus(db, id, 'paused');
        emitter.emit('paused');
      } else if (name === 'JobCancelledError') {
        job.status = 'cancelled';
        updateJobStatus(db, id, 'cancelled');
        emitter.emit('cancelled');
      } else {
        job.status = 'error';
        job.error = (err as Error).message;
        updateJobStatus(db, id, 'error', { error: (err as Error).message });
        emitter.emit('error', (err as Error).message);
      }
    });

  return id;
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
  // running 不可恢复（进程重启后不可能有活的 runner），只恢复 paused/done/error/cancelled 用于 SSE 历史回放
  if (row.status === 'running') return null;
  const emitter = new EventEmitter();
  const job: Job = {
    id: row.id, type: row.type, projectId: row.projectId,
    status: row.status as JobStatus, events: [], emitter,
    fromChapter: row.fromChapter ?? undefined,
    toChapter: row.toChapter ?? undefined,
    qualityGate: row.qualityGate || undefined,
    maxRevise: row.maxRevise || undefined,
    lastChapter: row.lastChapter,
    pauseRequested: false, cancelRequested: false,
    result: row.result, error: row.error ?? undefined,
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
  }
  // DB 立即改 paused（UI 即时反馈；实际 runner 停下后会再写一次，幂等）
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
    // 若已暂停（runner 已退出），直接落 cancelled
    if (job.status === 'paused') {
      job.status = 'cancelled';
      updateJobStatus(db, jobId, 'cancelled');
      job.emitter.emit('cancelled');
    }
  } else {
    // job 不在内存（paused 状态，进程重启过）：直接 DB 标 cancelled
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
