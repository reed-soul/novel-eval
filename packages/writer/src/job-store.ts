/**
 * Job 持久化 — job 表的 CRUD（版本化 schema）
 *
 * 任务恢复必须继续原始范围（scope）和配置快照（engine/model/word_count/...）。
 * 状态机：queued → running → paused | completed | failed | cancelled
 */
import { randomUUID } from 'node:crypto';

import type { DB } from './db.ts';
import {
  numberField,
  parseJson,
  parseJsonValue,
  persistedRecord,
  stringField,
  type JsonValue,
} from './repositories/validation.ts';

export type JobType = 'bible' | 'outline' | 'chapter' | 'correction' | 'rebuild' | 'edit';
export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface JobScope {
  from: number | null;
  to: number | null;
}

export interface JobRow {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  scope: JobScope;
  input: JsonValue;
  engine: string;
  model: string;
  wordCount: number;
  qualityProfile: string;
  budget: JsonValue;
  promptVersion: string;
  checkpoint: JsonValue | null;
  lastOutlinePosition: number;
  usage: JsonValue | null;
  errorType: string | null;
  retryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Alias for resume/CLI readability */
export type JobResumeConfig = {
  scope: { from: number; to: number };
  engine: string;
  model: string;
  wordCount: number;
  qualityProfile: string;
  promptVersion: string;
  budget: JsonValue;
  lastOutlinePosition: number;
};

function readScope(text: string): JobScope {
  const value = persistedRecord(parseJson(text, 'job scope'), 'job scope');
  const from = value.from;
  const to = value.to;
  if (from !== null && (typeof from !== 'number' || !Number.isInteger(from))) {
    throw new Error('Invalid job scope.from');
  }
  if (to !== null && (typeof to !== 'number' || !Number.isInteger(to))) {
    throw new Error('Invalid job scope.to');
  }
  return {
    from: from === null || from === undefined ? null : from,
    to: to === null || to === undefined ? null : to,
  };
}

function readJob(value: unknown): JobRow {
  const entity = 'job';
  const row = persistedRecord(value, entity);
  const checkpointRaw = row.checkpoint_json;
  const usageRaw = row.usage_json;
  return {
    id: stringField(row, 'id', entity),
    projectId: stringField(row, 'project_id', entity),
    type: stringField(row, 'type', entity) as JobType,
    status: stringField(row, 'status', entity) as JobStatus,
    scope: readScope(stringField(row, 'scope_json', entity)),
    input: parseJsonValue(parseJson(stringField(row, 'input_json', entity), 'job input'), 'job input'),
    engine: stringField(row, 'engine', entity),
    model: stringField(row, 'model', entity),
    wordCount: numberField(row, 'word_count', entity),
    qualityProfile: stringField(row, 'quality_profile', entity),
    budget: parseJsonValue(parseJson(stringField(row, 'budget_json', entity), 'job budget'), 'job budget'),
    promptVersion: stringField(row, 'prompt_version', entity),
    checkpoint: checkpointRaw === null || checkpointRaw === undefined
      ? null
      : parseJsonValue(parseJson(stringField(row, 'checkpoint_json', entity), 'job checkpoint'), 'job checkpoint'),
    lastOutlinePosition: numberField(row, 'last_outline_position', entity),
    usage: usageRaw === null || usageRaw === undefined
      ? null
      : parseJsonValue(parseJson(stringField(row, 'usage_json', entity), 'job usage'), 'job usage'),
    errorType: row.error_type === null || row.error_type === undefined
      ? null
      : stringField(row, 'error_type', entity),
    retryAt: row.retry_at === null || row.retry_at === undefined
      ? null
      : stringField(row, 'retry_at', entity),
    createdAt: stringField(row, 'created_at', entity),
    updatedAt: stringField(row, 'updated_at', entity),
  };
}

export interface CreateJobRowOpts {
  projectId: string;
  type: JobType;
  scope?: { from?: number | null; to?: number | null };
  /** @deprecated prefer scope.from / scope.to */
  fromChapter?: number | null;
  /** @deprecated prefer scope.from / scope.to */
  toChapter?: number | null;
  engine?: string;
  model?: string;
  wordCount?: number;
  qualityProfile?: string;
  budget?: JsonValue;
  promptVersion?: string;
  input?: JsonValue;
  qualityGate?: boolean;
  maxRevise?: number;
}

/** 创建一条 running 状态的 job 记录，返回 id */
export function createJobRow(db: DB, opts: CreateJobRowOpts): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const from = opts.scope?.from ?? opts.fromChapter ?? null;
  const to = opts.scope?.to ?? opts.toChapter ?? null;
  const budget = opts.budget
    ?? (opts.qualityGate !== undefined || opts.maxRevise !== undefined
      ? {
          qualityGate: opts.qualityGate ?? false,
          maxRevise: opts.maxRevise ?? 0,
        }
      : {});
  const input = opts.input ?? {};

  db.prepare(`
    INSERT INTO job (
      id, project_id, type, scope_json, input_json, engine, model, word_count,
      quality_profile, budget_json, prompt_version, status,
      checkpoint_json, last_outline_position, usage_json, error_type, retry_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, 0, NULL, NULL, NULL, ?, ?)
  `).run(
    id,
    opts.projectId,
    opts.type,
    JSON.stringify({ from, to }),
    JSON.stringify(parseJsonValue(input, 'job input')),
    opts.engine ?? 'default',
    opts.model ?? 'default',
    opts.wordCount ?? 0,
    opts.qualityProfile ?? 'default',
    JSON.stringify(parseJsonValue(budget, 'job budget')),
    opts.promptVersion ?? 'v1',
    now,
    now,
  );
  return id;
}

export function getJobRow(db: DB, jobId: string): JobRow | null {
  const row: unknown = db.prepare('SELECT * FROM job WHERE id = ?').get(jobId);
  return row === undefined ? null : readJob(row);
}

export function listJobsByProject(db: DB, projectId: string): JobRow[] {
  const rows: unknown[] = db.prepare(
    'SELECT * FROM job WHERE project_id = ? ORDER BY created_at DESC, rowid DESC',
  ).all(projectId);
  return rows.map(readJob);
}

/** 活动任务（running 或 paused）——详情页刷新后重连 SSE 的关键 */
export function getActiveJob(db: DB, projectId: string): JobRow | null {
  const row: unknown = db.prepare(`
    SELECT * FROM job
    WHERE project_id = ? AND status IN ('running', 'paused')
    ORDER BY updated_at DESC, rowid DESC
    LIMIT 1
  `).get(projectId);
  return row === undefined ? null : readJob(row);
}

export function updateJobStatus(
  db: DB,
  jobId: string,
  status: JobStatus,
  extra?: { result?: unknown; error?: string | null; errorType?: string | null },
): void {
  const now = new Date().toISOString();
  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const args: unknown[] = [status, now];
  if (extra?.result !== undefined) {
    const existing = getJobRow(db, jobId);
    const previous = existing?.usage;
    const resultValue = parseJsonValue(extra.result, 'job usage result');
    let usagePayload: JsonValue;
    if (typeof previous === 'object' && previous !== null && !Array.isArray(previous)) {
      usagePayload = { ...previous, result: resultValue };
    } else {
      usagePayload = { result: resultValue };
    }
    sets.push('usage_json = ?');
    args.push(JSON.stringify(usagePayload));
  }
  if (extra?.error !== undefined || extra?.errorType !== undefined) {
    sets.push('error_type = ?');
    args.push(extra.errorType ?? extra.error ?? null);
  }
  args.push(jobId);
  db.prepare(`UPDATE job SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

/** 推进断点：已完成的最后 outline position */
export function updateJobProgress(db: DB, jobId: string, lastOutlinePosition: number): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE job
    SET last_outline_position = ?, checkpoint_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    lastOutlinePosition,
    JSON.stringify({ outlinePosition: lastOutlinePosition }),
    now,
    jobId,
  );
}

/**
 * 启动恢复：把残留的 running job（上次进程没正常退出）改成 paused。
 */
export function recoverInterruptedJobs(db: DB): number {
  const now = new Date().toISOString();
  const info = db.prepare(`
    UPDATE job SET status = 'paused', updated_at = ? WHERE status = 'running'
  `).run(now);
  return info.changes;
}

/** 读取 resume 所需的原始范围与配置快照 */
export function readJobResumeConfig(db: DB, jobId: string): JobResumeConfig {
  const job = getJobRow(db, jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.scope.from === null || job.scope.to === null) {
    throw new Error(`Job ${jobId} has no chapter range scope`);
  }
  return {
    scope: { from: job.scope.from, to: job.scope.to },
    engine: job.engine,
    model: job.model,
    wordCount: job.wordCount,
    qualityProfile: job.qualityProfile,
    promptVersion: job.promptVersion,
    budget: job.budget,
    lastOutlinePosition: job.lastOutlinePosition,
  };
}

export interface JobEventRow {
  jobId: string;
  seq: number;
  step: string;
  msg: string;
  ts: number;
}

export interface AppendJobEventInput {
  jobId: string;
  seq: number;
  step: string;
  msg: string;
  ts: number;
}

/** 追加一条可续传的进度事件（(job_id, seq) 唯一）*/
export function appendJobEvent(db: DB, event: AppendJobEventInput): void {
  if (!Number.isInteger(event.seq) || event.seq <= 0) {
    throw new Error('job event seq must be a positive integer');
  }
  db.prepare(`
    INSERT INTO job_event (job_id, seq, step, msg, ts)
    VALUES (?, ?, ?, ?, ?)
  `).run(event.jobId, event.seq, event.step, event.msg, event.ts);
}

/** 列出 seq > afterSeq 的事件（进程重启后续传）*/
export function listJobEventsAfter(db: DB, jobId: string, afterSeq: number): JobEventRow[] {
  const rows: unknown[] = db.prepare(`
    SELECT job_id, seq, step, msg, ts
    FROM job_event
    WHERE job_id = ? AND seq > ?
    ORDER BY seq ASC
  `).all(jobId, afterSeq);
  return rows.map((value) => {
    const row = persistedRecord(value, 'job_event');
    return {
      jobId: stringField(row, 'job_id', 'job_event'),
      seq: numberField(row, 'seq', 'job_event'),
      step: stringField(row, 'step', 'job_event'),
      msg: stringField(row, 'msg', 'job_event'),
      ts: numberField(row, 'ts', 'job_event'),
    };
  });
}

/** 当前最大 seq；无事件时返回 0 */
export function getLatestJobEventSeq(db: DB, jobId: string): number {
  const row: unknown = db.prepare(
    'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM job_event WHERE job_id = ?',
  ).get(jobId);
  if (typeof row !== 'object' || row === null || !('max_seq' in row)) {
    return 0;
  }
  const maxSeq = (row as { max_seq: unknown }).max_seq;
  return typeof maxSeq === 'number' ? maxSeq : Number(maxSeq);
}

/** 写入累计 usage（cost / tokens），供预算校验与详情展示 */
export function updateJobUsage(db: DB, jobId: string, usage: JsonValue): void {
  const now = new Date().toISOString();
  const existing = getJobRow(db, jobId);
  const previous = existing?.usage;
  const next = parseJsonValue(usage, 'job usage');
  let merged: JsonValue = next;
  if (
    typeof previous === 'object' && previous !== null && !Array.isArray(previous)
    && typeof next === 'object' && next !== null && !Array.isArray(next)
  ) {
    const preservedResult = Object.prototype.hasOwnProperty.call(previous, 'result')
      ? previous.result
      : undefined;
    merged = preservedResult === undefined
      ? next
      : { ...next, result: preservedResult };
  }
  db.prepare(`
    UPDATE job SET usage_json = ?, updated_at = ? WHERE id = ?
  `).run(JSON.stringify(merged), now, jobId);
}
