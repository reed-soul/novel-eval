/**
 * Project completion helpers — job range done ≠ project done.
 *
 * A chapter job may finish its scoped `to` while later outlines remain.
 * Only mark the project completed when written chapters cover all outlines.
 */
import type { DB } from './db.ts';
import { countChapters, countOutlines } from './chapter/store.ts';
import { updateJobStatus } from './job-store.ts';
import { getProject, listProjects, updateProjectStatus } from './project.ts';

export function isProjectFullyWritten(db: DB, projectId: string): boolean {
  const outlines = countOutlines(db, projectId);
  if (outlines <= 0) return false;
  return countChapters(db, projectId) >= outlines;
}

/** Mark project completed only when every outline has a written chapter. */
export function completeProjectIfFullyWritten(db: DB, projectId: string): boolean {
  if (!isProjectFullyWritten(db, projectId)) return false;
  const project = getProject(db, projectId);
  if (!project || project.status === 'archived' || project.status === 'completed') {
    return project?.status === 'completed';
  }
  updateProjectStatus(db, projectId, 'completed');
  return true;
}

/**
 * Heal denormalized project.status left behind by pre-job writes or wrappers
 * that never called completeProjectIfFullyWritten.
 */
export function healFullyWrittenProjectStatuses(db: DB): number {
  let healed = 0;
  for (const project of listProjects(db)) {
    if (project.status !== 'writing' && project.status !== 'planning') continue;
    if (completeProjectIfFullyWritten(db, project.id)) healed += 1;
  }
  return healed;
}

/**
 * Resume early-exit: the paused job's original range is exhausted.
 * Complete the job; only complete the project when all outlines are written.
 */
export function finalizeExhaustedResumeJob(
  db: DB,
  opts: { projectId: string; jobId: string },
): { jobStatus: 'completed'; projectCompleted: boolean } {
  updateJobStatus(db, opts.jobId, 'completed');
  const projectCompleted = completeProjectIfFullyWritten(db, opts.projectId);
  return { jobStatus: 'completed', projectCompleted };
}
