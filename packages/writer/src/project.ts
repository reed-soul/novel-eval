/**
 * 项目 CRUD — 一本书一个项目
 *
 * 单库设计：所有项目存在 data/writer/writer.db 的 project 表。
 */
import { randomUUID } from 'node:crypto';
import type { DB } from './db.ts';

export type ProjectStatus =
  | 'initialized'   // 项目已建，bible 未生成
  | 'bible_done'    // bible 完成，大纲未生成（M2）
  | 'outlining'     // 大纲生成中（M2）
  | 'writing'       // 正在写章节（M2）
  | 'completed';    // 全部完成

export interface Project {
  id: string;
  title: string;
  genre: string;
  audience: string;
  topic: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  title: string;
  genre: string;
  audience: string;
  topic: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    audience: row.audience,
    topic: row.topic,
    status: row.status as ProjectStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProject(
  db: DB,
  opts: { title: string; genre: string; audience: string; topic: string },
): Project {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project (id, title, genre, audience, topic, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'initialized', ?, ?)`,
  ).run(id, opts.title, opts.genre, opts.audience, opts.topic, now, now);
  return { id, ...opts, status: 'initialized', createdAt: now, updatedAt: now };
}

export function getProject(db: DB, projectId: string): Project | null {
  const row = db.prepare('SELECT * FROM project WHERE id = ?').get(projectId) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export function listProjects(db: DB): Project[] {
  // rowid 是 SQLite 隐式自增主键，保证插入顺序的稳定 tiebreak（created_at 同毫秒时按插入先后）
  const rows = db.prepare('SELECT * FROM project ORDER BY created_at DESC, rowid DESC').all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function updateProjectStatus(db: DB, projectId: string, status: ProjectStatus): void {
  const now = new Date().toISOString();
  db.prepare('UPDATE project SET status = ?, updated_at = ? WHERE id = ?').run(status, now, projectId);
}
