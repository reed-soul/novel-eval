/**
 * Job 持久化 — job 表的 CRUD
 *
 * 内存 job（web/server/jobs.ts 的 Map）进程重启即失，job 表才是断点的真相来源。
 * 暂停/继续/取消、Web server 重启恢复，都依赖这张表。
 *
 * 状态机：running → paused | done | error | cancelled
 *   - running：内存里有 job + DB 里也是 running
 *   - paused：用户点暂停 / server 重启时把残留 running 改成 paused
 *   - cancelled：用户放弃，已写章节保留但不再提示继续
 *   - done/error：终态
 */
import { randomUUID } from 'node:crypto';
import type { DB } from './db.ts';

export type JobType = 'bible' | 'outline' | 'chapter';
export type JobStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled';

export interface JobRow {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  fromChapter: number | null;
  toChapter: number | null;
  lastChapter: number;
  qualityGate: boolean;
  maxRevise: number;
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobDbRow {
  id: string;
  project_id: string;
  type: string;
  status: string;
  from_chapter: number | null;
  to_chapter: number | null;
  last_chapter: number;
  quality_gate: number;
  max_revise: number;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobDbRow): JobRow {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type as JobType,
    status: row.status as JobStatus,
    fromChapter: row.from_chapter,
    toChapter: row.to_chapter,
    lastChapter: row.last_chapter,
    qualityGate: row.quality_gate === 1,
    maxRevise: row.max_revise,
    result: row.result ? JSON.parse(row.result) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateJobRowOpts {
  projectId: string;
  type: JobType;
  fromChapter?: number | null;
  toChapter?: number | null;
  qualityGate?: boolean;
  maxRevise?: number;
}

/** 创建一条 running 状态的 job 记录，返回 id */
export function createJobRow(db: DB, opts: CreateJobRowOpts): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO job (id, project_id, type, status, from_chapter, to_chapter, last_chapter, quality_gate, max_revise, result, error, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?, 0, ?, ?, NULL, NULL, ?, ?)`,
  ).run(
    id, opts.projectId, opts.type,
    opts.fromChapter ?? null, opts.toChapter ?? null,
    opts.qualityGate ? 1 : 0, opts.maxRevise ?? 0,
    now, now,
  );
  return id;
}

export function getJobRow(db: DB, jobId: string): JobRow | null {
  const row = db.prepare('SELECT * FROM job WHERE id = ?').get(jobId) as JobDbRow | undefined;
  return row ? rowToJob(row) : null;
}

export function listJobsByProject(db: DB, projectId: string): JobRow[] {
  const rows = db.prepare('SELECT * FROM job WHERE project_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(projectId) as JobDbRow[];
  return rows.map(rowToJob);
}

/** 活动任务（running 或 paused）——详情页刷新后重连 SSE 的关键 */
export function getActiveJob(db: DB, projectId: string): JobRow | null {
  const row = db.prepare(
    `SELECT * FROM job WHERE project_id = ? AND status IN ('running', 'paused') ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
  ).get(projectId) as JobDbRow | undefined;
  return row ? rowToJob(row) : null;
}

export function updateJobStatus(db: DB, jobId: string, status: JobStatus, extra?: { result?: unknown; error?: string | null }): void {
  const now = new Date().toISOString();
  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const args: unknown[] = [status, now];
  if (extra?.result !== undefined) {
    sets.push('result = ?');
    args.push(JSON.stringify(extra.result));
  }
  if (extra?.error !== undefined) {
    sets.push('error = ?');
    args.push(extra.error);
  }
  args.push(jobId);
  db.prepare(`UPDATE job SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

/** 推进断点：已完成的最后一章号 */
export function updateJobProgress(db: DB, jobId: string, lastChapter: number): void {
  const now = new Date().toISOString();
  db.prepare('UPDATE job SET last_chapter = ?, updated_at = ? WHERE id = ?').run(lastChapter, now, jobId);
}

/**
 * 启动恢复：把残留的 running job（上次进程没正常退出）改成 paused。
 * 让用户重启后看到"已暂停"，可以点继续，而不是永远卡 running。
 */
export function recoverInterruptedJobs(db: DB): number {
  const now = new Date().toISOString();
  const info = db.prepare(`UPDATE job SET status = 'paused', updated_at = ? WHERE status = 'running'`).run(now);
  return info.changes;
}
