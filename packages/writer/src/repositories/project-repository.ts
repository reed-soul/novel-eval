import type { DB } from '../db.ts';
import {
  projectId,
  type ProjectId,
} from '../domain/ids.ts';
import type { Project, ProjectStatus, TargetPlatform } from '../project.ts';
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
  targetPlatform?: TargetPlatform;
  premise: string;
  createdAt: string;
}

const statuses = ['draft', 'planning', 'writing', 'completed', 'archived'] as const;
const platforms = ['general', 'fanqie', 'yanxuan', 'douban'] as const;

function readProject(value: unknown): Project {
  const entity = 'project';
  const row = persistedRecord(value, entity);
  const genreProfile = stringField(row, 'genre_profile', entity);
  const targetAudience = stringField(row, 'target_audience', entity);
  const premise = stringField(row, 'premise', entity);
  const rawPlatform = row.target_platform;
  const targetPlatform: TargetPlatform =
    typeof rawPlatform === 'string' && (platforms as readonly string[]).includes(rawPlatform)
      ? (rawPlatform as TargetPlatform)
      : 'general';
  return {
    id: projectId(stringField(row, 'id', entity)),
    title: stringField(row, 'title', entity),
    genreProfile,
    targetAudience,
    targetPlatform,
    premise,
    status: oneOf(stringField(row, 'status', entity), statuses, entity),
    activeBibleRevisionId: nullableStringField(row, 'active_bible_revision_id', entity),
    createdAt: stringField(row, 'created_at', entity),
    updatedAt: stringField(row, 'updated_at', entity),
  };
}

export class ProjectRepository {
  constructor(private readonly db: DB) {}

  create(input: CreateProjectInput): Project {
    const targetPlatform = input.targetPlatform ?? 'general';
    this.db.prepare(`
      INSERT INTO project (
        id, title, genre_profile, target_audience, target_platform, premise, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(
      input.id,
      input.title,
      input.genreProfile,
      input.targetAudience,
      targetPlatform,
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

  updateStatus(id: ProjectId, status: ProjectStatus, updatedAt: string): void {
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

  resolveProjectIdByName(nameOrId: string): ProjectId {
    const direct = this.get(projectId(nameOrId));
    if (direct) return direct.id;
    const rows = this.db.prepare('SELECT id FROM project WHERE title LIKE ?').all(`%${nameOrId}%`) as Array<{ id: string }>;
    if (rows.length === 0) throw new Error(`未找到项目：${nameOrId}`);
    if (rows.length > 1) throw new Error(`项目名歧义（${rows.length} 个匹配），请用完整 id`);
    return projectId(rows[0].id);
  }
}
