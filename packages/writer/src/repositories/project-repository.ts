import type { DB } from '../db.ts';
import {
  projectId,
  type ProjectId,
} from '../domain/ids.ts';
import type { Project, PersistedProjectStatus } from '../project.ts';
import {
  nullableStringField,
  oneOf,
  persistedRecord,
  stringField,
} from './validation.ts';

export interface CreateProjectInput {
  id: ProjectId;
  title: string;
  genreProfile: string;
  targetAudience: string;
  premise: string;
  createdAt: string;
}

const statuses = ['draft', 'planning', 'writing', 'completed', 'archived'] as const;

function readProject(value: unknown): Project {
  const entity = 'project';
  const row = persistedRecord(value, entity);
  const genreProfile = stringField(row, 'genre_profile', entity);
  const targetAudience = stringField(row, 'target_audience', entity);
  const premise = stringField(row, 'premise', entity);
  return {
    id: projectId(stringField(row, 'id', entity)),
    title: stringField(row, 'title', entity),
    genreProfile,
    targetAudience,
    premise,
    status: oneOf(stringField(row, 'status', entity), statuses, entity),
    activeBibleRevisionId: nullableStringField(row, 'active_bible_revision_id', entity),
    createdAt: stringField(row, 'created_at', entity),
    updatedAt: stringField(row, 'updated_at', entity),
    genre: genreProfile,
    audience: targetAudience,
    topic: premise,
  };
}

export class ProjectRepository {
  constructor(private readonly db: DB) {}

  create(input: CreateProjectInput): Project {
    this.db.prepare(`
      INSERT INTO project (
        id, title, genre_profile, target_audience, premise, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(
      input.id,
      input.title,
      input.genreProfile,
      input.targetAudience,
      input.premise,
      input.createdAt,
      input.createdAt,
    );
    const created = this.get(input.id);
    if (!created) throw new Error(`Project ${input.id} was not persisted`);
    return created;
  }

  get(id: ProjectId): Project | null {
    const row: unknown = this.db.prepare('SELECT * FROM project WHERE id = ?').get(id);
    return row === undefined ? null : readProject(row);
  }

  list(): Project[] {
    const rows: unknown[] = this.db.prepare(
      'SELECT * FROM project ORDER BY created_at DESC, rowid DESC',
    ).all();
    return rows.map(readProject);
  }

  updateStatus(id: ProjectId, status: PersistedProjectStatus, updatedAt: string): void {
    this.db.prepare(
      'UPDATE project SET status = ?, updated_at = ? WHERE id = ?',
    ).run(status, updatedAt, id);
  }

  setActiveBibleRevision(id: ProjectId, bibleRevisionId: string, updatedAt: string): void {
    this.db.prepare(`
      UPDATE project
      SET active_bible_revision_id = ?, updated_at = ?
      WHERE id = ?
    `).run(bibleRevisionId, updatedAt, id);
  }
}
