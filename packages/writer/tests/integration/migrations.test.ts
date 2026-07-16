import assert from 'node:assert/strict';
import { it } from 'node:test';

import { createTestDb } from '../helpers/test-db.ts';

it('creates only the phase-A schema and enables integrity pragmas', () => {
  const testDb = createTestDb();
  const rows: unknown[] = testDb.db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all();
  const tables = rows.map((row) => {
    assert.ok(typeof row === 'object' && row !== null && 'name' in row);
    const name = row.name;
    assert.equal(typeof name, 'string');
    return name;
  });

  assert.deepEqual(tables, [
    'beat',
    'chapter',
    'chapter_outline',
    'chapter_outline_revision',
    'chapter_revision',
    'job',
    'project',
    'project_write_lease',
    'schema_version',
    'story_bible_revision',
    'story_state_revision',
  ]);
  assert.equal(testDb.db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(testDb.db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(testDb.db.pragma('busy_timeout', { simple: true }), 5000);
  testDb.cleanup();
});
