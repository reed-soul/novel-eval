/**
 * 从 writer.db 读取章节定稿（active_revision），供有声书管线消费。
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import {
  ChapterRepository,
  ProjectRepository,
  projectId as toProjectId,
  type DB,
} from '@novel-eval/writer';

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
  const repo = new ProjectRepository(db as unknown as DB);
  return repo.list().map((p) => ({ id: p.id, title: p.title }));
}

export function resolveProjectId(db: Database.Database, nameOrId: string): string {
  const repo = new ProjectRepository(db as unknown as DB);
  return repo.resolveProjectIdByName(nameOrId);
}

export function loadChapters(db: Database.Database, projectId: string, range?: string): Chapter[] {
  let rangeParam: { from?: number; to?: number } | undefined;
  if (range) {
    const [a, b] = range.split('-').map(Number);
    const hi = b ?? a;
    rangeParam = { from: a, to: hi };
  }
  const repo = new ChapterRepository(db as unknown as DB);
  const rows = repo.listPublishedChapters(toProjectId(projectId), rangeParam);
  if (rows.length === 0) throw new Error('没有可用的章节（检查范围或 active_revision）');

  return rows.map((r) => ({
    position: r.position,
    title: r.title ?? `第${r.position}章`,
    content: r.content ?? '',
  }));
}
