import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';

import type { DB } from '../../src/db.ts';
import { runMigrations } from '../../src/migrations/runner.ts';
import { createTestDb } from '../helpers/test-db.ts';

const now = '2026-07-16T09:00:00.000Z';

function insertProject(db: DB, id = 'project-1'): void {
  db.prepare(`
    INSERT INTO project (
      id, title, genre_profile, target_audience, premise, status, created_at, updated_at
    ) VALUES (?, 'Test', 'mystery', 'adult', 'Premise', 'draft', ?, ?)
  `).run(id, now, now);
}

function insertOutline(db: DB, input: { id: string; projectId: string; position: number }): void {
  db.prepare(`
    INSERT INTO chapter_outline (
      id, project_id, position, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'draft', ?, ?)
  `).run(input.id, input.projectId, input.position, now, now);
}

function insertChapter(db: DB, input: { id: string; projectId: string; outlineId: string }): void {
  db.prepare(`
    INSERT INTO chapter (id, project_id, outline_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(input.id, input.projectId, input.outlineId, now);
}

function insertChapterRevision(
  db: DB,
  input: { id: string; chapterId: string; revisionNumber: number },
): void {
  db.prepare(`
    INSERT INTO chapter_revision (
      id, chapter_id, revision_number, source, title, content, word_count, status, created_at
    ) VALUES (?, ?, ?, 'manual', 'Title', 'Content', 1, 'draft', ?)
  `).run(input.id, input.chapterId, input.revisionNumber, now);
}

function insertJob(db: DB, input: { id: string; projectId: string }): void {
  db.prepare(`
    INSERT INTO job (
      id, project_id, type, scope_json, input_json, engine, model, word_count,
      quality_profile, budget_json, prompt_version, status, created_at, updated_at
    ) VALUES (?, ?, 'chapter', '{}', '{}', 'test', 'test', 1, 'test', '{}', 'v1', 'queued', ?, ?)
  `).run(input.id, input.projectId, now, now);
}

function insertStoryState(
  db: DB,
  input: {
    id: string;
    projectId: string;
    chapterId: string;
    chapterRevisionId: string;
    sequence: number;
    status: 'current' | 'stale';
  },
): void {
  db.prepare(`
    INSERT INTO story_state_revision (
      id, project_id, chapter_id, chapter_revision_id, sequence, status,
      state_json, delta_json, summary, model, prompt_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', 'Summary', 'test', 'v1', ?)
  `).run(
    input.id,
    input.projectId,
    input.chapterId,
    input.chapterRevisionId,
    input.sequence,
    input.status,
    now,
  );
}

it('creates only the phase-A schema and enables integrity pragmas', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
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
});

it('rejects duplicate integer migration versions', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'writer-migrations-'));
  const db = new Database(':memory:');
  t.after(() => {
    try {
      db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  writeFileSync(join(directory, '001_first.sql'), 'SELECT 1;');
  writeFileSync(join(directory, '001_second.sql'), 'SELECT 2;');

  assert.throws(
    () => runMigrations(db, { directory }),
    /Duplicate migration version 1/,
  );
});

it('enforces foreign keys', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());

  assert.throws(
    () => insertOutline(testDb.db, { id: 'outline-1', projectId: 'missing', position: 1 }),
    /FOREIGN KEY constraint failed/,
  );
});

it('enforces status checks', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());

  assert.throws(
    () => testDb.db.prepare(`
      INSERT INTO project (
        id, title, genre_profile, target_audience, premise, status, created_at, updated_at
      ) VALUES ('project-1', 'Test', 'mystery', 'adult', 'Premise', 'invalid', ?, ?)
    `).run(now, now),
    /CHECK constraint failed/,
  );

  insertProject(testDb.db);
  assert.throws(
    () => testDb.db.prepare(`
      INSERT INTO chapter_outline (
        id, project_id, position, status, created_at, updated_at
      ) VALUES ('outline-invalid', 'project-1', 1, 'invalid', ?, ?)
    `).run(now, now),
    /CHECK constraint failed/,
  );

  insertOutline(testDb.db, { id: 'outline-1', projectId: 'project-1', position: 1 });
  assert.throws(
    () => testDb.db.prepare(`
      INSERT INTO chapter_outline_revision (
        id, outline_id, revision_number, status, title, content_json, created_at
      ) VALUES ('outline-revision-invalid', 'outline-1', 1, 'invalid', 'Title', '{}', ?)
    `).run(now),
    /CHECK constraint failed/,
  );

  insertChapter(testDb.db, {
    id: 'chapter-1',
    projectId: 'project-1',
    outlineId: 'outline-1',
  });
  assert.throws(
    () => testDb.db.prepare(`
      INSERT INTO chapter_revision (
        id, chapter_id, revision_number, source, title, content, word_count, status, created_at
      ) VALUES ('revision-invalid', 'chapter-1', 1, 'manual', 'Title', 'Content', 1, 'invalid', ?)
    `).run(now),
    /CHECK constraint failed/,
  );

  insertChapterRevision(testDb.db, {
    id: 'revision-1',
    chapterId: 'chapter-1',
    revisionNumber: 1,
  });
  assert.throws(
    () => testDb.db.prepare(`
      INSERT INTO story_state_revision (
        id, project_id, chapter_id, chapter_revision_id, sequence, status,
        state_json, delta_json, summary, model, prompt_version, created_at
      ) VALUES (
        'state-invalid', 'project-1', 'chapter-1', 'revision-1', 1, 'invalid',
        '{}', '{}', 'Summary', 'test', 'v1', ?
      )
    `).run(now),
    /CHECK constraint failed/,
  );

  assert.throws(
    () => testDb.db.prepare(`
      INSERT INTO job (
        id, project_id, type, scope_json, input_json, engine, model, word_count,
        quality_profile, budget_json, prompt_version, status, created_at, updated_at
      ) VALUES (
        'job-invalid', 'project-1', 'chapter', '{}', '{}', 'test', 'test', 1,
        'test', '{}', 'v1', 'invalid', ?, ?
      )
    `).run(now, now),
    /CHECK constraint failed/,
  );
});

it('enforces outline and chapter revision uniqueness', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  insertProject(testDb.db);
  insertOutline(testDb.db, { id: 'outline-1', projectId: 'project-1', position: 1 });

  assert.throws(
    () => insertOutline(testDb.db, { id: 'outline-2', projectId: 'project-1', position: 1 }),
    /UNIQUE constraint failed/,
  );

  testDb.db.prepare(`
    INSERT INTO chapter_outline_revision (
      id, outline_id, revision_number, status, title, content_json, created_at
    ) VALUES ('outline-revision-1', 'outline-1', 1, 'draft', 'Title', '{}', ?)
  `).run(now);
  assert.throws(
    () => testDb.db.prepare(`
      INSERT INTO chapter_outline_revision (
        id, outline_id, revision_number, status, title, content_json, created_at
      ) VALUES ('outline-revision-2', 'outline-1', 1, 'draft', 'Title', '{}', ?)
    `).run(now),
    /UNIQUE constraint failed/,
  );

  insertChapter(testDb.db, {
    id: 'chapter-1',
    projectId: 'project-1',
    outlineId: 'outline-1',
  });
  insertChapterRevision(testDb.db, {
    id: 'revision-1',
    chapterId: 'chapter-1',
    revisionNumber: 1,
  });

  assert.throws(
    () => insertChapterRevision(testDb.db, {
      id: 'revision-2',
      chapterId: 'chapter-1',
      revisionNumber: 1,
    }),
    /UNIQUE constraint failed/,
  );
});

it('allows only one lease row per project', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  insertProject(testDb.db);
  insertJob(testDb.db, { id: 'job-1', projectId: 'project-1' });
  insertJob(testDb.db, { id: 'job-2', projectId: 'project-1' });
  testDb.db.prepare(`
    INSERT INTO project_write_lease (
      id, project_id, job_id, owner_id, expires_at, created_at, updated_at
    ) VALUES ('lease-1', 'project-1', 'job-1', 'worker-1', ?, ?, ?)
  `).run(now, now, now);

  assert.throws(
    () => testDb.db.prepare(`
      INSERT INTO project_write_lease (
        id, project_id, job_id, owner_id, expires_at, created_at, updated_at
      ) VALUES ('lease-2', 'project-1', 'job-2', 'worker-2', ?, ?, ?)
    `).run(now, now, now),
    /UNIQUE constraint failed/,
  );
});

it('allows current states at different sequences but only one current per sequence', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  insertProject(testDb.db);
  insertOutline(testDb.db, { id: 'outline-1', projectId: 'project-1', position: 1 });
  insertOutline(testDb.db, { id: 'outline-2', projectId: 'project-1', position: 2 });
  insertChapter(testDb.db, {
    id: 'chapter-1',
    projectId: 'project-1',
    outlineId: 'outline-1',
  });
  insertChapter(testDb.db, {
    id: 'chapter-2',
    projectId: 'project-1',
    outlineId: 'outline-2',
  });
  insertChapterRevision(testDb.db, {
    id: 'revision-1',
    chapterId: 'chapter-1',
    revisionNumber: 1,
  });
  insertChapterRevision(testDb.db, {
    id: 'revision-2',
    chapterId: 'chapter-2',
    revisionNumber: 1,
  });
  insertChapterRevision(testDb.db, {
    id: 'revision-3',
    chapterId: 'chapter-1',
    revisionNumber: 2,
  });
  insertChapterRevision(testDb.db, {
    id: 'revision-4',
    chapterId: 'chapter-1',
    revisionNumber: 3,
  });

  insertStoryState(testDb.db, {
    id: 'state-current-1',
    projectId: 'project-1',
    chapterId: 'chapter-1',
    chapterRevisionId: 'revision-1',
    sequence: 1,
    status: 'current',
  });
  insertStoryState(testDb.db, {
    id: 'state-current-2',
    projectId: 'project-1',
    chapterId: 'chapter-2',
    chapterRevisionId: 'revision-2',
    sequence: 2,
    status: 'current',
  });

  assert.throws(
    () => insertStoryState(testDb.db, {
      id: 'state-current-duplicate',
      projectId: 'project-1',
      chapterId: 'chapter-1',
      chapterRevisionId: 'revision-3',
      sequence: 1,
      status: 'current',
    }),
    /UNIQUE constraint failed/,
  );

  insertStoryState(testDb.db, {
    id: 'state-stale-1',
    projectId: 'project-1',
    chapterId: 'chapter-1',
    chapterRevisionId: 'revision-3',
    sequence: 1,
    status: 'stale',
  });
  insertStoryState(testDb.db, {
    id: 'state-stale-2',
    projectId: 'project-1',
    chapterId: 'chapter-1',
    chapterRevisionId: 'revision-4',
    sequence: 1,
    status: 'stale',
  });
});
