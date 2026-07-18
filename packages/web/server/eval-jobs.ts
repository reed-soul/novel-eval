import { evaluate, type EvaluateOptions, type EvaluateResult } from '@novel-eval/eval';

export type EvalJobStatus = 'running' | 'completed' | 'failed';

export interface EvalJob {
  taskId: string;
  status: EvalJobStatus;
  history: string[];
  result?: EvaluateResult;
  error?: string;
  updatedAt: number;
  /** Optional writing project bound at upload time (for banner deep-link). */
  projectId?: string | null;
  title?: string | null;
}

export interface ActiveEvalJobListItem {
  taskId: string;
  status: EvalJobStatus;
  latestMessage: string | null;
  updatedAt: number;
  projectId: string | null;
  title: string | null;
}

const evalJobs = new Map<string, EvalJob>();
const EVAL_JOB_TTL = 30 * 60 * 1000; // 30 minutes

function cleanupStaleJobs() {
  const now = Date.now();
  for (const [taskId, job] of evalJobs.entries()) {
    if ((job.status === 'completed' || job.status === 'failed') && now - job.updatedAt > EVAL_JOB_TTL) {
      evalJobs.delete(taskId);
    }
  }
}

export function createEvalJob(
  taskId: string,
  meta: { projectId?: string | null; title?: string | null } = {},
): EvalJob {
  const job: EvalJob = {
    taskId,
    status: 'running',
    history: [],
    updatedAt: Date.now(),
    projectId: meta.projectId ?? null,
    title: meta.title ?? null,
  };
  evalJobs.set(taskId, job);
  cleanupStaleJobs();
  return job;
}

export function getEvalJob(taskId: string): EvalJob | undefined {
  return evalJobs.get(taskId);
}

export function listActiveEvalJobs(limit = 20): ActiveEvalJobListItem[] {
  cleanupStaleJobs();
  const capped = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20;
  return [...evalJobs.values()]
    .filter((job) => job.status === 'running')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, capped)
    .map((job) => ({
      taskId: job.taskId,
      status: job.status,
      latestMessage: job.history.length > 0 ? job.history[job.history.length - 1]! : null,
      updatedAt: job.updatedAt,
      projectId: job.projectId ?? null,
      title: job.title ?? null,
    }));
}

export function appendEvalProgress(taskId: string, message: string) {
  const job = evalJobs.get(taskId);
  if (job) {
    job.history.push(message);
    job.updatedAt = Date.now();
  }
}

export function completeEvalJob(taskId: string, result: EvaluateResult) {
  const job = evalJobs.get(taskId);
  if (job) {
    job.status = 'completed';
    job.result = result;
    job.updatedAt = Date.now();
  }
}

export function failEvalJob(taskId: string, error: Error) {
  const job = evalJobs.get(taskId);
  if (job) {
    job.status = 'failed';
    job.error = error.message;
    job.updatedAt = Date.now();
  }
}

export async function runEvalTaskInBackground(
  taskId: string,
  options: Omit<EvaluateOptions, 'onProgress'>,
  meta: { projectId?: string | null; title?: string | null } = {},
) {
  createEvalJob(taskId, meta);

  try {
    const result = await evaluate({
      ...options,
      onProgress: (msg) => {
        appendEvalProgress(taskId, msg);
      },
    });

    completeEvalJob(taskId, result);
    return result;
  } catch (err: unknown) {
    failEvalJob(taskId, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
