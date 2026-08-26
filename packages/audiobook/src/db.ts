/**
 * 从 writer.db 读取章节定稿（active_revision），供有声书管线消费。
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

export interface Chapter {
  position: number;
  title: string;
  content: string;
}

export function openWriterDb(dbPath?: string): Database.Database {
  const p = dbPath ?? process.env.WRITER_DB_PATH ?? resolve(process.cwd(), 'data/writer/writer.db');
  return new Database(p, { readonly: true });
}

export function listProjects(db: Database.Database): { id: string; title: string }[] {
  return db.prepare('SELECT id, title FROM project ORDER BY created_at').all() as { id: string; title: string }[];
}

export function resolveProjectId(db: Database.Database, nameOrId: string): string {
  if (db.prepare('SELECT 1 FROM project WHERE id = ?').get(nameOrId)) return nameOrId;
  const hit = db
    .prepare('SELECT id FROM project WHERE title LIKE ?')
    .all(`%${nameOrId}%`) as { id: string }[];
  if (hit.length === 0) throw new Error(`未找到项目：${nameOrId}`);
  if (hit.length > 1) throw new Error(`项目名歧义（${hit.length} 个匹配），请用完整 id`);
  return hit[0].id;
}

export function loadChapters(db: Database.Database, projectId: string, range?: string): Chapter[] {
  const rows = db
    .prepare(
      `SELECT o.position AS pos, r.title, r.content
       FROM chapter c
       JOIN chapter_outline o ON o.id = c.outline_id
       JOIN chapter_revision r ON r.id = c.active_revision_id
       WHERE c.project_id = ?
       ORDER BY o.position`
    )
    .all(projectId) as { pos: number; title: string; content: string }[];

  let chapters = rows.map((r) => ({
    position: r.pos,
    title: r.title ?? `第${r.pos}章`,
    content: r.content ?? '',
  }));

  if (range) {
    const [a, b] = range.split('-').map(Number);
    const hi = b ?? a;
    chapters = chapters.filter((c) => c.position >= a && c.position <= hi);
  }
  if (chapters.length === 0) throw new Error('没有可用的章节（检查范围或 active_revision）');
  return chapters;
}
