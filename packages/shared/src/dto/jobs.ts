export type JobStatusDto = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type JobTypeDto = 'bible' | 'outline' | 'chapter' | 'correction';

/** Stable job status payload returned by GET /api/projects/jobs/:jobId */
export interface JobStatusResponse {
  id: string;
  type: JobTypeDto;
  projectId: string;
  status: JobStatusDto;
  events?: number;
  lastChapter?: number | null;
  fromChapter?: number | null;
  toChapter?: number | null;
  result?: unknown;
  error?: string | null;
  qualityGate?: boolean;
  maxRevise?: number;
  createdAt?: string;
  updatedAt?: string;
}
