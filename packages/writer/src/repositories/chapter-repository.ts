import type { DB } from '../db.ts';
import type {
  Chapter,
  ChapterCandidate,
  ChapterRevision,
  SaveChapterCandidateInput,
} from '../domain/chapter.ts';
import {
  chapterId,
  chapterRevisionId,
  outlineId,
  projectId,
  type ChapterId,
  type ChapterRevisionId,
  type ProjectId,
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

  getRevision(id: ChapterRevisionId): ChapterCandidate | null {
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

  getActiveRevision(id: ChapterId): ChapterRevision | null {
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
      FROM chapter c
      JOIN chapter_revision r ON r.id = c.active_revision_id
      WHERE c.id = ?
    `).get(id);
    return row === undefined ? null : readCandidate(row).revision;
  }

  publishRevision(id: ChapterRevisionId): ChapterRevision {
    const updated = this.db.prepare(`
      UPDATE chapter_revision
      SET status = 'published'
      WHERE id = ? AND status = 'draft'
    `).run(id);
    if (updated.changes !== 1) {
      throw new Error(`Chapter revision ${id} is not a draft candidate`);
    }

    const activated = this.db.prepare(`
      UPDATE chapter
      SET active_revision_id = ?
      WHERE id = (SELECT chapter_id FROM chapter_revision WHERE id = ?)
    `).run(id, id);
    if (activated.changes !== 1) {
      throw new Error(`Chapter revision ${id} has no chapter`);
    }

    const candidate = this.getRevision(id);
    if (!candidate) throw new Error(`Chapter revision ${id} was not published`);
    return candidate.revision;
  }

  listRevisions(id: ChapterId): ChapterRevision[] {
    const rows: unknown[] = this.db.prepare(`
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
      WHERE r.chapter_id = ?
      ORDER BY r.revision_number ASC
    `).all(id);
    return rows.map((row) => readCandidate(row).revision);
  }

  getByOutlinePosition(project: ProjectId, position: number): Chapter | null {
    const row: unknown = this.db.prepare(`
      SELECT c.id, c.project_id, c.outline_id, c.active_revision_id, c.created_at
      FROM chapter c
      JOIN chapter_outline o ON o.id = c.outline_id
      WHERE c.project_id = ? AND o.position = ?
    `).get(project, position);
    if (row === undefined) return null;
    return readChapter(row);
  }

  getChapter(id: ChapterId): Chapter | null {
    const row: unknown = this.db.prepare(
      'SELECT id, project_id, outline_id, active_revision_id, created_at FROM chapter WHERE id = ?',
    ).get(id);
    return row === undefined ? null : readChapter(row);
  }

  listRecentActiveRevisions(
    project: ProjectId,
    beforePosition: number,
    limit: number,
  ): Array<{
    position: number;
    revisionId: ChapterRevisionId;
    title: string;
    content: string;
  }> {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new TypeError('limit must be a non-negative integer');
    }
    const rows: unknown[] = this.db.prepare(`
      SELECT
        o.position AS position,
        r.id AS revision_id,
        r.title AS title,
        r.content AS content
      FROM chapter c
      JOIN chapter_outline o ON o.id = c.outline_id
      JOIN chapter_revision r ON r.id = c.active_revision_id
      WHERE c.project_id = ?
        AND o.position < ?
      ORDER BY o.position DESC
      LIMIT ?
    `).all(project, beforePosition, limit);
    return rows.map((value) => {
      const entity = 'recent active chapter revision';
      const row = persistedRecord(value, entity);
      return {
        position: numberField(row, 'position', entity),
        revisionId: chapterRevisionId(stringField(row, 'revision_id', entity)),
        title: stringField(row, 'title', entity),
        content: stringField(row, 'content', entity),
      };
    }).reverse();
  }

  nextRevisionNumber(id: ChapterId): number {
    const row: unknown = this.db.prepare(`
      SELECT COALESCE(MAX(revision_number), 0) AS max_revision
      FROM chapter_revision
      WHERE chapter_id = ?
    `).get(id);
    const entity = 'chapter revision number';
    return numberField(persistedRecord(row, entity), 'max_revision', entity) + 1;
  }

  appendCandidate(input: {
    chapterId: ChapterId;
    revision: Omit<ChapterRevision, 'chapterId'>;
  }): ChapterCandidate {
    this.db.prepare(`
      INSERT INTO chapter_revision (
        id, chapter_id, revision_number, source, parent_revision_id, title, content,
        word_count, status, generation_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.revision.id,
      input.chapterId,
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
    const candidate = this.getRevision(input.revision.id);
    if (!candidate) throw new Error(`Chapter revision ${input.revision.id} was not persisted`);
    return candidate;
  }
}

function readChapter(value: unknown): Chapter {
  const entity = 'chapter';
  const row = persistedRecord(value, entity);
  const activeRevision = nullableStringField(row, 'active_revision_id', entity);
  return {
    id: chapterId(stringField(row, 'id', entity)),
    projectId: projectId(stringField(row, 'project_id', entity)),
    outlineId: outlineId(stringField(row, 'outline_id', entity)),
    activeRevisionId: activeRevision === null ? null : chapterRevisionId(activeRevision),
    createdAt: stringField(row, 'created_at', entity),
  };
}
