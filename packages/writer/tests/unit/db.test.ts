import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { closeDb, openDb } from '../../src/db.ts';

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'writer-db-test-'));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('openDb', () => {
  it('creates the explicitly requested database and parent directory', () => {
    const path = join(tempRoot, 'nested', 'writer.db');
    const db = openDb({ path });

    assert.equal(existsSync(path), true);
    closeDb(db);
  });

  it('records each migration only once when reopening the same path', () => {
    const path = join(tempRoot, 'writer.db');
    closeDb(openDb({ path }));
    const db = openDb({ path });
    const row: unknown = db.prepare(
      'SELECT COUNT(*) AS count FROM schema_version WHERE version = 1',
    ).get();

    assert.ok(typeof row === 'object' && row !== null && 'count' in row);
    assert.equal(row.count, 1);
    closeDb(db);
  });
});
