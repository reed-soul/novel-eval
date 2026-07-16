import { fail, isRecord, type ParseResult } from './parse.ts';

export type JobStatusDto =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobTypeDto =
  | 'bible'
  | 'outline'
  | 'chapter'
  | 'correction'
  | 'rebuild'
  | 'edit';

const JOB_STATUSES = new Set<JobStatusDto>([
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

const JOB_TYPES = new Set<JobTypeDto>([
  'bible',
  'outline',
  'chapter',
  'correction',
  'rebuild',
  'edit',
]);

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

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return value;
  return undefined;
}

export function parseJobStatusResponse(raw: unknown): ParseResult<JobStatusResponse> {
  if (!isRecord(raw)) return fail('JobStatusResponse 必须是对象');

  if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
    return fail('JobStatusResponse.id 必须是非空字符串');
  }
  if (typeof raw.type !== 'string' || !JOB_TYPES.has(raw.type as JobTypeDto)) {
    return fail('JobStatusResponse.type 非法');
  }
  if (typeof raw.projectId !== 'string' || raw.projectId.trim().length === 0) {
    return fail('JobStatusResponse.projectId 必须是非空字符串');
  }
  if (typeof raw.status !== 'string' || !JOB_STATUSES.has(raw.status as JobStatusDto)) {
    return fail('JobStatusResponse.status 非法');
  }

  const data: JobStatusResponse = {
    id: raw.id,
    type: raw.type as JobTypeDto,
    projectId: raw.projectId,
    status: raw.status as JobStatusDto,
  };

  const events = optionalFiniteNumber(raw.events);
  if (events !== undefined) data.events = events;

  const lastChapter = optionalNullableNumber(raw.lastChapter);
  if (lastChapter !== undefined) data.lastChapter = lastChapter;

  const fromChapter = optionalNullableNumber(raw.fromChapter);
  if (fromChapter !== undefined) data.fromChapter = fromChapter;

  const toChapter = optionalNullableNumber(raw.toChapter);
  if (toChapter !== undefined) data.toChapter = toChapter;

  if ('result' in raw) data.result = raw.result;

  const error = optionalNullableString(raw.error);
  if (error !== undefined) data.error = error;

  if (typeof raw.qualityGate === 'boolean') data.qualityGate = raw.qualityGate;

  const maxRevise = optionalFiniteNumber(raw.maxRevise);
  if (maxRevise !== undefined) data.maxRevise = maxRevise;

  const createdAt = optionalString(raw.createdAt);
  if (createdAt !== undefined) data.createdAt = createdAt;

  const updatedAt = optionalString(raw.updatedAt);
  if (updatedAt !== undefined) data.updatedAt = updatedAt;

  return { ok: true, data };
}
