import type { DB } from '../db.ts';
import type {
  ChapterCandidate,
  SaveChapterCandidateInput,
} from '../domain/chapter.ts';
import {
  chapterId,
  chapterRevisionId,
  outlineId,
  projectId,
} from '../domain/ids.ts';
import {
  nullableStringField,
  numberField,
  oneOf,
  persistedRecord,
  stringField,
} from './validation.ts';

const sources = ['generated', 'manual', 'correction', 'import'] as const;
const statuses = ['draft', 'published', 'rejected'] as const;

function readCandidate(value: unknown): ChapterCandidate {
  const entity = 'chapter candidate';
  const row = persistedRecord(value, entity);
  const activeRevision = nullableStringField(row, 'active_revision_id', entity);
  const parentRevision = nullableStringField(row, 'parent_revision_id', entity);
  return {
    chapter: {
      id: chapterId(stringField(row, 'chapter_id', entity)),
      projectId: projectId(stringField(row, 'project_id', entity)),
      outlineId: outlineId(stringField(row, 'outline_id', entity)),
      activeRevisionId: activeRevision === null ? null : chapterRevisionId(activeRevision),
      createdAt: stringField(row, 'chapter_created_at', entity),
    },
    revision: {
      id: chapterRevisionId(stringField(row, 'revision_id', entity)),
      chapterId: chapterId(stringField(row, 'chapter_id', entity)),
      revisionNumber: numberField(row, 'revision_number', entity),
      source: oneOf(stringField(row, 'source', entity), sources, entity),
      parentRevisionId: parentRevision === null ? null : chapterRevisionId(parentRevision),
      title: stringField(row, 'title', entity),
      content: stringField(row, 'content', entity),
      wordCount: numberField(row, 'word_count', entity),
      status: oneOf(stringField(row, 'revision_status', entity), statuses, entity),
      generationRunId: nullableStringField(row, 'generation_run_id', entity),
      createdAt: stringField(row, 'revision_created_at', entity),
    },
  };
}

export class ChapterRepository {
  constructor(private readonly db: DB) {}

  saveCandidate(input: SaveChapterCandidateInput): ChapterCandidate {
    const persist = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO chapter (id, project_id, outline_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(
        input.chapter.id,
        input.chapter.projectId,
        input.chapter.outlineId,
        input.chapter.createdAt,
      );
      this.db.prepare(`
        INSERT INTO chapter_revision (
          id, chapter_id, revision_number, source, parent_revision_id, title, content,
          word_count, status, generation_run_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.revision.id,
        input.chapter.id,
        input.revision.revisionNumber,
        input.revision.source,
        input.revision.parentRevisionId,
        input.revision.title,
        input.revision.content,
        input.revision.wordCount,
        input.revision.status,
        input.revision.generationRunId,
        input.revision.createdAt,
      );
    });
    persist();
    const candidate = this.getRevision(input.revision.id);
    if (!candidate) throw new Error(`Chapter revision ${input.revision.id} was not persisted`);
    return candidate;
  }

  getRevision(id: ReturnType<typeof chapterRevisionId>): ChapterCandidate | null {
    const row: unknown = this.db.prepare(`
      SELECT
        c.id AS chapter_id,
        c.project_id,
        c.outline_id,
        c.active_revision_id,
        c.created_at AS chapter_created_at,
        r.id AS revision_id,
        r.revision_number,
        r.source,
        r.parent_revision_id,
        r.title,
        r.content,
        r.word_count,
        r.status AS revision_status,
        r.generation_run_id,
        r.created_at AS revision_created_at
      FROM chapter_revision r
      JOIN chapter c ON c.id = r.chapter_id
      WHERE r.id = ?
    `).get(id);
    return row === undefined ? null : readCandidate(row);
  }
}
