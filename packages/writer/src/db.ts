import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { runMigrations } from './migrations/runner.ts';

export type DB = Database.Database;

export function openDb(options: { path: string }): DB {
  mkdirSync(dirname(options.path), { recursive: true });
  const db = new Database(options.path);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    runMigrations(db);
    return db;
  } catch (error: unknown) {
    closeDb(db);
    throw error;
  }
}

export function closeDb(db: DB): void {
  try { db.close(); } catch { /* 已关闭 */ }
}
