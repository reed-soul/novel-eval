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
  `);
}

/** 关闭数据库（测试与 CLI 退出时调用，防句柄泄漏）*/
export function closeDb(db: DB): void {
  try { db.close(); } catch { /* 已关闭 */ }
}
