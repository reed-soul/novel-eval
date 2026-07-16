import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, type DB } from '../../src/db.ts';

export function createTestDb(): { db: DB; path: string; cleanup(): void } {
  const directory = mkdtempSync(join(tmpdir(), 'writer-test-'));
  const path = join(directory, 'writer.db');
  const db = openDb({ path });

  return {
    db,
    path,
    cleanup(): void {
      try {
        db.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
