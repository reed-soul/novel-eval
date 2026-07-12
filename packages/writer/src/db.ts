/**
 * SQLite 数据层 — writer 项目持久化
 *
 * 单库设计：data/writer/writer.db 存所有项目（本地工具，几十本书无压力）。
 * 每个项目通过 project_id 外键关联 bible/章节/伏笔等表。
 * schema 随里程碑演进：M1 建 project + bible 表。
 *
 * better-sqlite3 是同步 API，适合本地 CLI/Web（无连接池开销）。
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export type DB = Database.Database;

/** writer 数据根目录（data/writer/，gitignore）*/
export function writerDataDir(): string {
  return resolve(process.cwd(), 'data', 'writer');
}

/**
 * 打开（或创建）全局 writer 数据库。
 * 单库存所有项目，避免「project id 还没生成就要建目录」的鸡生蛋问题。
 */
export function openDb(): DB {
  const dir = writerDataDir();
  mkdirSync(dir, { recursive: true });
  const db = new Database(resolve(dir, 'writer.db'));
  db.pragma('journal_mode = WAL');  // 写入并发友好
  migrate(db);
  return db;
}

/** 幂等 schema 迁移：建表（IF NOT EXISTS），随里程碑累积 */
function migrate(db: DB): void {
  // M1：项目 + bible
  db.exec(`
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      genre TEXT,
      audience TEXT,
      topic TEXT,
      status TEXT NOT NULL DEFAULT 'initialized',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bible (
      project_id TEXT PRIMARY KEY REFERENCES project(id),
      core_seed TEXT,
      character_dynamics TEXT,
      character_state TEXT,
      world_building TEXT,
      plot_architecture TEXT,
      full_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- M2：章节蓝图（每行一章）
    CREATE TABLE IF NOT EXISTS chapter_outline (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      number INTEGER NOT NULL,
      title TEXT,
      act INTEGER NOT NULL,
      beat TEXT,
      role TEXT,
      purpose TEXT,
      suspense_level INTEGER,
      foreshadowing TEXT,
      twist_level INTEGER,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, number)
    );

    -- M2：章节正文
    CREATE TABLE IF NOT EXISTS chapter (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      number INTEGER NOT NULL,
      outline_id TEXT REFERENCES chapter_outline(id),
      title TEXT,
      content TEXT NOT NULL,
      word_count INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, number)
    );

    -- M2：叙事状态（滚动摘要 + 伏笔追踪，每项目一行）
    CREATE TABLE IF NOT EXISTS narrative_state (
      project_id TEXT PRIMARY KEY REFERENCES project(id),
      macro_summary TEXT,
      open_foreshadows TEXT,
      arc_summaries TEXT,
      up_to_chapter INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}

/** 关闭数据库（测试与 CLI 退出时调用，防句柄泄漏）*/
export function closeDb(db: DB): void {
  try { db.close(); } catch { /* 已关闭 */ }
}
