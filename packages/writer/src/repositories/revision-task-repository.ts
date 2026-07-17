import type { DB } from '../db.ts';
import { InvalidPersistenceDataError } from '../domain/errors.ts';
import {
  oneOf,
  persistedRecord,
  stringField,
  nullableStringField,
} from './validation.ts';

export const REVISION_TASK_STATUSES = [
  'open',
  'in_progress',
  'done',
  'dismissed',
] as const;

export type RevisionTaskStatus = (typeof REVISION_TASK_STATUSES)[number];

export const REVISION_TASK_SCOPES = ['chapter', 'volume', 'book'] as const;
export type RevisionTaskScope = (typeof REVISION_TASK_SCOPES)[number];

export const REVISION_TASK_SOURCE_KINDS = [
  'evaluation_report',
  'manual',
] as const;
export type RevisionTaskSourceKind = (typeof REVISION_TASK_SOURCE_KINDS)[number];

export interface RevisionTaskExcerptRef {
  chapterId: string;
  excerptIndex: number;
}

export interface RevisionTask {
  id: string;
  projectId: string;
  status: RevisionTaskStatus;
  scope: RevisionTaskScope;
  dimension: string | null;
  content: string;
  type: string | null;
  relatedChapters: string[];
  excerptRef: RevisionTaskExcerptRef | null;
  sourceEvalTaskId: string | null;
  sourceKind: RevisionTaskSourceKind;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRevisionTaskInput {
  id: string;
  projectId: string;
  status?: RevisionTaskStatus;
  scope: RevisionTaskScope;
  dimension?: string | null;
  content: string;
  type?: string | null;
  relatedChapters?: string[];
  excerptRef?: RevisionTaskExcerptRef | null;
  sourceEvalTaskId?: string | null;
  sourceKind?: RevisionTaskSourceKind;
  now?: string;
}

function parseRelatedChapters(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new InvalidPersistenceDataError('revision_task', 'related_chapters_json is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new InvalidPersistenceDataError('revision_task', 'related_chapters_json must be an array');
  }
  return parsed.filter((item): item is string => typeof item === 'string');
}

function parseExcerptRef(raw: string | null): RevisionTaskExcerptRef | null {
  if (raw === null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new InvalidPersistenceDataError('revision_task', 'excerpt_ref_json is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidPersistenceDataError('revision_task', 'excerpt_ref_json must be an object');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.chapterId !== 'string' || typeof record.excerptIndex !== 'number') {
    throw new InvalidPersistenceDataError(
      'revision_task',
      'excerpt_ref_json requires chapterId:string and excerptIndex:number',
    );
  }
  return { chapterId: record.chapterId, excerptIndex: record.excerptIndex };
}

function readRevisionTask(value: unknown): RevisionTask {
  const entity = 'revision_task';
  const row = persistedRecord(value, entity);
  return {
    id: stringField(row, 'id', entity),
    projectId: stringField(row, 'project_id', entity),
    status: oneOf(stringField(row, 'status', entity), REVISION_TASK_STATUSES, entity),
    scope: oneOf(stringField(row, 'scope', entity), REVISION_TASK_SCOPES, entity),
    dimension: nullableStringField(row, 'dimension', entity),
    content: stringField(row, 'content', entity),
    type: nullableStringField(row, 'type', entity),
    relatedChapters: parseRelatedChapters(stringField(row, 'related_chapters_json', entity)),
    excerptRef: parseExcerptRef(nullableStringField(row, 'excerpt_ref_json', entity)),
    sourceEvalTaskId: nullableStringField(row, 'source_eval_task_id', entity),
    sourceKind: oneOf(
      stringField(row, 'source_kind', entity),
      REVISION_TASK_SOURCE_KINDS,
      entity,
    ),
    createdAt: stringField(row, 'created_at', entity),
    updatedAt: stringField(row, 'updated_at', entity),
  };
}

export class RevisionTaskRepository {
  constructor(private readonly db: DB) {}

  create(input: CreateRevisionTaskInput): RevisionTask {
    const now = input.now ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO revision_task (
           id, project_id, status, scope, dimension, content, type,
           related_chapters_json, excerpt_ref_json, source_eval_task_id,
           source_kind, created_at, updated_at
         ) VALUES (
           @id, @project_id, @status, @scope, @dimension, @content, @type,
           @related_chapters_json, @excerpt_ref_json, @source_eval_task_id,
           @source_kind, @created_at, @updated_at
         )`,
      )
      .run({
        id: input.id,
        project_id: input.projectId,
        status: input.status ?? 'open',
        scope: input.scope,
        dimension: input.dimension ?? null,
        content: input.content,
        type: input.type ?? null,
        related_chapters_json: JSON.stringify(input.relatedChapters ?? []),
        excerpt_ref_json: input.excerptRef == null
          ? null
          : JSON.stringify(input.excerptRef),
        source_eval_task_id: input.sourceEvalTaskId ?? null,
        source_kind: input.sourceKind ?? 'evaluation_report',
        created_at: now,
        updated_at: now,
      });
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`revision task create failed: ${input.id}`);
    }
    return created;
  }

  findById(id: string): RevisionTask | null {
    const row: unknown = this.db
      .prepare(`SELECT * FROM revision_task WHERE id = ?`)
      .get(id);
    return row === undefined ? null : readRevisionTask(row);
  }

  listByProject(
    projectId: string,
    options?: { status?: RevisionTaskStatus },
  ): RevisionTask[] {
    if (options?.status) {
      const rows: unknown[] = this.db
        .prepare(
          `SELECT * FROM revision_task
           WHERE project_id = ? AND status = ?
           ORDER BY created_at DESC, rowid DESC`,
        )
        .all(projectId, options.status);
      return rows.map(readRevisionTask);
    }
    const rows: unknown[] = this.db
      .prepare(
        `SELECT * FROM revision_task
         WHERE project_id = ?
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(projectId);
    return rows.map(readRevisionTask);
  }

  /**
   * Dismiss open tasks for a project. Optionally limit to a source eval id.
   * Returns number of rows updated.
   */
  dismissOpen(
    projectId: string,
    options?: { sourceEvalTaskId?: string | null; now?: string },
  ): number {
    const now = options?.now ?? new Date().toISOString();
    if (options?.sourceEvalTaskId) {
      const result = this.db
        .prepare(
          `UPDATE revision_task
           SET status = 'dismissed', updated_at = ?
           WHERE project_id = ? AND status = 'open' AND source_eval_task_id = ?`,
        )
        .run(now, projectId, options.sourceEvalTaskId);
      return result.changes;
    }
    const result = this.db
      .prepare(
        `UPDATE revision_task
         SET status = 'dismissed', updated_at = ?
         WHERE project_id = ? AND status = 'open'`,
      )
      .run(now, projectId);
    return result.changes;
  }

  updateStatus(
    id: string,
    status: RevisionTaskStatus,
    now = new Date().toISOString(),
  ): RevisionTask | null {
    const result = this.db
      .prepare(
        `UPDATE revision_task
         SET status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, now, id);
    if (result.changes === 0) return null;
    return this.findById(id);
  }
}
