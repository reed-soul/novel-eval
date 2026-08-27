/**
 * 剧情逻辑审计（推敲器）后台任务注册表 — 对齐 eval-jobs 模式
 */
import { auditPlot, type PlotAuditReport } from '@novel-eval/eval';

export type AuditJobStatus = 'running' | 'completed' | 'failed';

export interface AuditJob {
  taskId: string;
  status: AuditJobStatus;
  history: string[];
  result?: PlotAuditReport;
  error?: string;
  updatedAt: number;
  title?: string | null;
}

export interface ActiveAuditJobListItem {
  taskId: string;
  status: AuditJobStatus;
  latestMessage: string | null;
  updatedAt: number;
  title: string | null;
}

const auditJobs = new Map<string, AuditJob>();
const AUDIT_JOB_TTL = 30 * 60 * 1000;

function cleanupStaleJobs() {
  const now = Date.now();
  for (const [taskId, job] of auditJobs.entries()) {
    if ((job.status === 'completed' || job.status === 'failed') && now - job.updatedAt > AUDIT_JOB_TTL) {
      auditJobs.delete(taskId);
    }
  }
}

export function createAuditJob(taskId: string, meta: { title?: string | null } = {}): AuditJob {
  const job: AuditJob = {
    taskId,
    status: 'running',
    history: [],
    updatedAt: Date.now(),
    title: meta.title ?? null,
  };
  auditJobs.set(taskId, job);
  cleanupStaleJobs();
  return job;
}

export function getAuditJob(taskId: string): AuditJob | undefined {
  return auditJobs.get(taskId);
}

export function listActiveAuditJobs(limit = 20): ActiveAuditJobListItem[] {
  cleanupStaleJobs();
  const capped = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20;
  return [...auditJobs.values()]
    .filter((job) => job.status === 'running')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, capped)
    .map((job) => ({
      taskId: job.taskId,
      status: job.status,
      latestMessage: job.history.length > 0 ? job.history[job.history.length - 1]! : null,
      updatedAt: job.updatedAt,
      title: job.title ?? null,
    }));
}

export function appendAuditProgress(taskId: string, message: string) {
  const job = auditJobs.get(taskId);
  if (job) {
    job.history.push(message);
    job.updatedAt = Date.now();
  }
}

export function completeAuditJob(taskId: string, result: PlotAuditReport) {
  const job = auditJobs.get(taskId);
  if (job) {
    job.status = 'completed';
    job.result = result;
    job.updatedAt = Date.now();
  }
}

export function failAuditJob(taskId: string, error: Error) {
  const job = auditJobs.get(taskId);
  if (job) {
    job.status = 'failed';
    job.error = error.message;
    job.updatedAt = Date.now();
  }
}

export interface RunAuditOptions {
  filePath: string;
  title?: string;
  genre?: string;
  climaxChapter?: number;
}

export async function runAuditTaskInBackground(
  taskId: string,
  options: RunAuditOptions,
  meta: { title?: string | null } = {},
) {
  createAuditJob(taskId, meta);

  try {
    const { report } = await auditPlot({
      filePath: options.filePath,
      title: options.title,
      genre: options.genre,
      climaxChapter: options.climaxChapter,
      onProgress: (msg) => {
        appendAuditProgress(taskId, msg);
      },
    });

    completeAuditJob(taskId, report);
    return report;
  } catch (err: unknown) {
    failAuditJob(taskId, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
