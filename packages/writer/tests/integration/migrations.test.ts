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

function insertBibleRevision(
  db: DB,
  input: { id: string; projectId: string; revisionNumber: number },
): void {
  db.prepare(`
    INSERT INTO story_bible_revision (
      id, project_id, revision_number, status, bible_json, compiled_text, created_at
    ) VALUES (?, ?, ?, 'draft', '{}', 'Bible', ?)
  `).run(input.id, input.projectId, input.revisionNumber, now);
}

function insertBeat(
  db: DB,
  input: { id: string; projectId: string; bibleRevisionId: string; position: number },
): void {
  db.prepare(`
    INSERT INTO beat (
      id, project_id, bible_revision_id, position, act, content_json, created_at
    ) VALUES (?, ?, ?, ?, 1, '{}', ?)
  `).run(input.id, input.projectId, input.bibleRevisionId, input.position, now);
}

function insertOutline(db: DB, input: { id: string; projectId: string; position: number }): void {
  db.prepare(`
    INSERT INTO chapter_outline (
      id, project_id, position, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'draft', ?, ?)
  `).run(input.id, input.projectId, input.position, now, now);
}

function insertOutlineRevision(
  db: DB,
  input: { id: string; outlineId: string; revisionNumber: number },
): void {
  db.prepare(`
    INSERT INTO chapter_outline_revision (
      id, outline_id, revision_number, status, title, content_json, created_at
    ) VALUES (?, ?, ?, 'draft', 'Title', '{}', ?)
  `).run(input.id, input.outlineId, input.revisionNumber, now);
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
    previousStateRevisionId?: string;
  },
): void {
  db.prepare(`
    INSERT INTO story_state_revision (
      id, project_id, chapter_id, chapter_revision_id, previous_state_revision_id, sequence, status,
      state_json, delta_json, summary, model, prompt_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '{}', 'Summary', 'test', 'v1', ?)
  `).run(
    input.id,
    input.projectId,
    input.chapterId,
    input.chapterRevisionId,
    input.previousStateRevisionId ?? null,
    input.sequence,
    input.status,
    now,
  );
}

function insertLease(
  db: DB,
  input: { id: string; projectId: string; jobId: string },
): void {
  db.prepare(`
    INSERT INTO project_write_lease (
      id, project_id, job_id, owner_id, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'worker', ?, ?, ?)
  `).run(input.id, input.projectId, input.jobId, now, now, now);
}

function seedCompleteSchema(db: DB): void {
  insertProject(db);
  insertBibleRevision(db, {
    id: 'bible-1',
    projectId: 'project-1',
    revisionNumber: 1,
  });
  db.prepare(
    "UPDATE project SET active_bible_revision_id = 'bible-1' WHERE id = 'project-1'",
  ).run();
  insertBeat(db, {
    id: 'beat-1',
    projectId: 'project-1',
    bibleRevisionId: 'bible-1',
    position: 1,
  });
  insertOutline(db, { id: 'outline-1', projectId: 'project-1', position: 1 });
  insertOutlineRevision(db, {
    id: 'outline-revision-1',
    outlineId: 'outline-1',
    revisionNumber: 1,
  });
  db.prepare(
    "UPDATE chapter_outline SET active_revision_id = 'outline-revision-1' WHERE id = 'outline-1'",
  ).run();
  insertChapter(db, {
    id: 'chapter-1',
    projectId: 'project-1',
    outlineId: 'outline-1',
  });
  insertChapterRevision(db, {
    id: 'revision-1',
    chapterId: 'chapter-1',
    revisionNumber: 1,
  });
  insertChapterRevision(db, {
    id: 'revision-2',
    chapterId: 'chapter-1',
    revisionNumber: 2,
  });
  db.prepare(
    "UPDATE chapter_revision SET parent_revision_id = 'revision-1' WHERE id = 'revision-2'",
  ).run();
  db.prepare(
    "UPDATE chapter SET active_revision_id = 'revision-2' WHERE id = 'chapter-1'",
  ).run();
  insertStoryState(db, {
    id: 'state-1',
    projectId: 'project-1',
    chapterId: 'chapter-1',
    chapterRevisionId: 'revision-1',
    sequence: 1,
    status: 'stale',
  });
  insertStoryState(db, {
    id: 'state-2',
    projectId: 'project-1',
    chapterId: 'chapter-1',
    chapterRevisionId: 'revision-2',
    previousStateRevisionId: 'state-1',
    sequence: 2,
    status: 'current',
  });
  insertJob(db, { id: 'job-1', projectId: 'project-1' });
  insertLease(db, { id: 'lease-1', projectId: 'project-1', jobId: 'job-1' });
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
  insertBibleRevision(testDb.db, {
    id: 'bible-1',
    projectId: 'project-1',
    revisionNumber: 1,
  });
  assert.throws(
    () => testDb.db.prepare(
      "UPDATE story_bible_revision SET status = 'invalid' WHERE id = 'bible-1'",
    ).run(),
    /CHECK constraint failed/,
  );

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
    () => testDb.db.prepare(
      "UPDATE chapter_revision SET source = 'invalid' WHERE id = 'revision-1'",
    ).run(),
    /CHECK constraint failed/,
  );
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

it('enforces every numeric range check', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  seedCompleteSchema(testDb.db);
  const invalidUpdates: ReadonlyArray<{ name: string; sql: string }> = [
    {
      name: 'story_bible_revision.revision_number',
      sql: "UPDATE story_bible_revision SET revision_number = 0 WHERE id = 'bible-1'",
    },
    {
      name: 'beat.position',
      sql: "UPDATE beat SET position = 0 WHERE id = 'beat-1'",
    },
    {
      name: 'beat.act',
      sql: "UPDATE beat SET act = 0 WHERE id = 'beat-1'",
    },
    {
      name: 'chapter_outline.position',
      sql: "UPDATE chapter_outline SET position = 0 WHERE id = 'outline-1'",
    },
    {
      name: 'chapter_outline_revision.revision_number',
      sql: "UPDATE chapter_outline_revision SET revision_number = 0 WHERE id = 'outline-revision-1'",
    },
    {
      name: 'chapter_revision.revision_number',
      sql: "UPDATE chapter_revision SET revision_number = 0 WHERE id = 'revision-1'",
    },
    {
      name: 'chapter_revision.word_count',
      sql: "UPDATE chapter_revision SET word_count = -1 WHERE id = 'revision-1'",
    },
    {
      name: 'story_state_revision.sequence',
      sql: "UPDATE story_state_revision SET sequence = 0 WHERE id = 'state-1'",
    },
    {
      name: 'job.word_count',
      sql: "UPDATE job SET word_count = -1 WHERE id = 'job-1'",
    },
    {
      name: 'job.last_outline_position',
      sql: "UPDATE job SET last_outline_position = -1 WHERE id = 'job-1'",
    },
  ];

  for (const invalidUpdate of invalidUpdates) {
    assert.throws(
      () => testDb.db.prepare(invalidUpdate.sql).run(),
      /CHECK constraint failed/,
      invalidUpdate.name,
    );
  }
});

it('enforces every phase-A foreign key', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  seedCompleteSchema(testDb.db);
  const invalidUpdates: ReadonlyArray<{ name: string; sql: string }> = [
    {
      name: 'project.active_bible_revision_id',
      sql: "UPDATE project SET active_bible_revision_id = 'missing' WHERE id = 'project-1'",
    },
    {
      name: 'story_bible_revision.project_id',
      sql: "UPDATE story_bible_revision SET project_id = 'missing' WHERE id = 'bible-1'",
    },
    {
      name: 'beat.project_id',
      sql: "UPDATE beat SET project_id = 'missing' WHERE id = 'beat-1'",
    },
    {
      name: 'beat.bible_revision_id',
      sql: "UPDATE beat SET bible_revision_id = 'missing' WHERE id = 'beat-1'",
    },
    {
      name: 'chapter_outline.project_id',
      sql: "UPDATE chapter_outline SET project_id = 'missing' WHERE id = 'outline-1'",
    },
    {
      name: 'chapter_outline.active_revision_id',
      sql: "UPDATE chapter_outline SET active_revision_id = 'missing' WHERE id = 'outline-1'",
    },
    {
      name: 'chapter_outline_revision.outline_id',
      sql: "UPDATE chapter_outline_revision SET outline_id = 'missing' WHERE id = 'outline-revision-1'",
    },
    {
      name: 'chapter.project_id',
      sql: "UPDATE chapter SET project_id = 'missing' WHERE id = 'chapter-1'",
    },
    {
      name: 'chapter.outline_id',
      sql: "UPDATE chapter SET outline_id = 'missing' WHERE id = 'chapter-1'",
    },
    {
      name: 'chapter.active_revision_id',
      sql: "UPDATE chapter SET active_revision_id = 'missing' WHERE id = 'chapter-1'",
    },
    {
      name: 'chapter_revision.chapter_id',
      sql: "UPDATE chapter_revision SET chapter_id = 'missing' WHERE id = 'revision-1'",
    },
    {
      name: 'chapter_revision.parent_revision_id',
      sql: "UPDATE chapter_revision SET parent_revision_id = 'missing' WHERE id = 'revision-2'",
    },
    {
      name: 'story_state_revision.project_id',
      sql: "UPDATE story_state_revision SET project_id = 'missing' WHERE id = 'state-1'",
    },
    {
      name: 'story_state_revision.chapter_id',
      sql: "UPDATE story_state_revision SET chapter_id = 'missing' WHERE id = 'state-1'",
    },
    {
      name: 'story_state_revision.chapter_revision_id',
      sql: "UPDATE story_state_revision SET chapter_revision_id = 'missing' WHERE id = 'state-1'",
    },
    {
      name: 'story_state_revision.previous_state_revision_id',
      sql: "UPDATE story_state_revision SET previous_state_revision_id = 'missing' WHERE id = 'state-2'",
    },
    {
      name: 'job.project_id',
      sql: "UPDATE job SET project_id = 'missing' WHERE id = 'job-1'",
    },
    {
      name: 'project_write_lease.project_id',
      sql: "UPDATE project_write_lease SET project_id = 'missing' WHERE id = 'lease-1'",
    },
    {
      name: 'project_write_lease.job_id',
      sql: "UPDATE project_write_lease SET job_id = 'missing' WHERE id = 'lease-1'",
    },
  ];

  for (const invalidUpdate of invalidUpdates) {
    assert.throws(
      () => testDb.db.prepare(invalidUpdate.sql).run(),
      /FOREIGN KEY constraint failed/,
      invalidUpdate.name,
    );
  }
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

it('enforces remaining phase-A domain uniqueness', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  seedCompleteSchema(testDb.db);

  assert.throws(
    () => insertBibleRevision(testDb.db, {
      id: 'bible-2',
      projectId: 'project-1',
      revisionNumber: 1,
    }),
    /UNIQUE constraint failed/,
    'story_bible_revision project and revision number',
  );
  assert.throws(
    () => insertBeat(testDb.db, {
      id: 'beat-2',
      projectId: 'project-1',
      bibleRevisionId: 'bible-1',
      position: 1,
    }),
    /UNIQUE constraint failed/,
    'beat project and position',
  );
  assert.throws(
    () => insertChapter(testDb.db, {
      id: 'chapter-2',
      projectId: 'project-1',
      outlineId: 'outline-1',
    }),
    /UNIQUE constraint failed/,
    'chapter outline identity',
  );
  insertStoryState(testDb.db, {
    id: 'state-3',
    projectId: 'project-1',
    chapterId: 'chapter-1',
    chapterRevisionId: 'revision-1',
    sequence: 3,
    status: 'stale',
  });

  insertProject(testDb.db, 'project-2');
  insertJob(testDb.db, { id: 'job-2', projectId: 'project-2' });
  assert.throws(
    () => insertLease(testDb.db, {
      id: 'lease-1',
      projectId: 'project-2',
      jobId: 'job-2',
    }),
    /UNIQUE constraint failed/,
    'lease identity',
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
