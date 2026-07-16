import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DB } from '../db.ts';

interface Migration {
  version: number;
  sql: string;
}

function loadMigrations(directory: string): Migration[] {
  const migrations = readdirSync(directory)
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .map((filename) => {
      const version = Number.parseInt(filename.slice(0, filename.indexOf('_')), 10);
      if (!Number.isInteger(version)) {
        throw new Error(`Invalid migration filename: ${filename}`);
      }
      return {
        version,
        sql: readFileSync(join(directory, filename), 'utf8'),
      };
    })
    .sort((left, right) => left.version - right.version);

  const versions = new Set<number>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}`);
    }
    versions.add(migration.version);
  }

  return migrations;
}

export function runMigrations(db: DB, options?: { directory: string }): void {
  const directory = options?.directory ?? dirname(fileURLToPath(import.meta.url));
  const migrations = loadMigrations(directory);
  const applyMigration = db.transaction((migration: Migration): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT
    `);

    const applied: unknown = db.prepare(
      'SELECT version FROM schema_version WHERE version = ?',
    ).get(migration.version);
    if (applied !== undefined) {
      return;
    }

    db.exec(migration.sql);
    db.prepare(
      "INSERT INTO schema_version (version, applied_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    ).run(migration.version);
  });

  for (const migration of migrations) {
    applyMigration(migration);
  }
}
