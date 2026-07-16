import type { DB } from '../db.ts';
import { InvalidPersistenceDataError } from '../domain/errors.ts';
import { outlineId, projectId, type OutlineId, type ProjectId } from '../domain/ids.ts';
import {
  numberField,
  oneOf,
  parseJson,
  parseJsonObject,
  parseJsonValue,
  persistedRecord,
  stringField,
  type JsonValue,
} from './validation.ts';

export type RevisionStatus = 'draft' | 'approved' | 'superseded';
export type OutlineStatus = 'draft' | 'approved' | 'writing' | 'written' | 'stale';
export type BibleDocument = { [key: string]: JsonValue };

export interface BibleRevision {
  id: string;
  projectId: ProjectId;
  revisionNumber: number;
  status: RevisionStatus;
  bible: BibleDocument;
  compiledText: string;
  createdAt: string;
}

export interface BeatRecord {
  id: string;
  projectId: ProjectId;
  bibleRevisionId: string;
  position: number;
  act: number;
  content: BibleDocument;
  createdAt: string;
}

export interface OutlineContent {
  summary: string;
  beats: string[];
}

export interface ApprovedOutline {
  outline: {
    id: OutlineId;
    projectId: ProjectId;
    position: number;
    status: 'approved';
    activeRevisionId: string;
    createdAt: string;
    updatedAt: string;
  };
  revision: {
    id: string;
    outlineId: OutlineId;
    revisionNumber: number;
    status: 'approved';
    title: string;
    content: OutlineContent;
    createdAt: string;
  };
}

export interface SaveApprovedOutlineInput {
  outline: {
    id: OutlineId;
    projectId: ProjectId;
    position: number;
    createdAt: string;
    updatedAt: string;
  };
  revision: {
    id: string;
    revisionNumber: number;
    title: string;
    content: OutlineContent;
    createdAt: string;
  };
}

const revisionStatuses = ['draft', 'approved', 'superseded'] as const;

function parseOutlineContent(text: string): OutlineContent {
  const entity = 'chapter outline revision content';
  const value = persistedRecord(parseJson(text, entity), entity);
  const beatsValue = value.beats;
  if (!Array.isArray(beatsValue) || !beatsValue.every((beat) => typeof beat === 'string')) {
    throw new InvalidPersistenceDataError(entity, 'beats must be an array of strings');
  }
  return {
    summary: stringField(value, 'summary', entity),
    beats: beatsValue.map((beat) => {
      if (typeof beat !== 'string') {
        throw new InvalidPersistenceDataError(entity, 'beat must be a string');
      }
      return beat;
    }),
  };
}

function readBible(value: unknown): BibleRevision {
  const entity = 'story bible revision';
  const row = persistedRecord(value, entity);
  return {
    id: stringField(row, 'id', entity),
    projectId: projectId(stringField(row, 'project_id', entity)),
    revisionNumber: numberField(row, 'revision_number', entity),
    status: oneOf(stringField(row, 'status', entity), revisionStatuses, entity),
    bible: parseJsonObject(stringField(row, 'bible_json', entity), `${entity} bible`),
    compiledText: stringField(row, 'compiled_text', entity),
    createdAt: stringField(row, 'created_at', entity),
  };
}

function readBeat(value: unknown): BeatRecord {
  const entity = 'beat';
  const row = persistedRecord(value, entity);
  return {
    id: stringField(row, 'id', entity),
    projectId: projectId(stringField(row, 'project_id', entity)),
    bibleRevisionId: stringField(row, 'bible_revision_id', entity),
    position: numberField(row, 'position', entity),
    act: numberField(row, 'act', entity),
    content: parseJsonObject(stringField(row, 'content_json', entity), `${entity} content`),
    createdAt: stringField(row, 'created_at', entity),
  };
}

function readApprovedOutline(value: unknown): ApprovedOutline {
  const entity = 'approved chapter outline';
  const row = persistedRecord(value, entity);
  const parsedOutlineId = outlineId(stringField(row, 'outline_id', entity));
  const outlineStatus = oneOf(
    stringField(row, 'outline_status', entity),
    ['draft', 'approved', 'writing', 'written', 'stale'] as const,
    entity,
  );
  const revisionStatus = oneOf(
    stringField(row, 'revision_status', entity),
    revisionStatuses,
    entity,
  );
  if (outlineStatus !== 'approved' || revisionStatus !== 'approved') {
    throw new Error(`Outline ${parsedOutlineId} is not approved`);
  }
  return {
    outline: {
      id: parsedOutlineId,
      projectId: projectId(stringField(row, 'project_id', entity)),
      position: numberField(row, 'position', entity),
      status: outlineStatus,
      activeRevisionId: stringField(row, 'active_revision_id', entity),
      createdAt: stringField(row, 'outline_created_at', entity),
      updatedAt: stringField(row, 'updated_at', entity),
    },
    revision: {
      id: stringField(row, 'revision_id', entity),
      outlineId: parsedOutlineId,
      revisionNumber: numberField(row, 'revision_number', entity),
      status: revisionStatus,
      title: stringField(row, 'title', entity),
      content: parseOutlineContent(stringField(row, 'content_json', entity)),
      createdAt: stringField(row, 'revision_created_at', entity),
    },
  };
}

export class PlanningRepository {
  constructor(private readonly db: DB) {}

  saveBibleRevision(revision: BibleRevision): BibleRevision {
    const bible = parseJsonValue(revision.bible, 'story bible revision bible');
    this.db.prepare(`
      INSERT INTO story_bible_revision (
        id, project_id, revision_number, status, bible_json, compiled_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.id,
      revision.projectId,
      revision.revisionNumber,
      revision.status,
      JSON.stringify(bible),
      revision.compiledText,
      revision.createdAt,
    );
    const persisted = this.getBibleRevision(revision.id);
    if (!persisted) throw new Error(`Bible revision ${revision.id} was not persisted`);
    return persisted;
  }

  getBibleRevision(id: string): BibleRevision | null {
    const row: unknown = this.db.prepare(
      'SELECT * FROM story_bible_revision WHERE id = ?',
    ).get(id);
    return row === undefined ? null : readBible(row);
  }

  saveBeats(beats: BeatRecord[]): void {
    const statement = this.db.prepare(`
      INSERT INTO beat (
        id, project_id, bible_revision_id, position, act, content_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const persist = this.db.transaction((records: BeatRecord[]) => {
      for (const beat of records) {
        statement.run(
          beat.id,
          beat.projectId,
          beat.bibleRevisionId,
          beat.position,
          beat.act,
          JSON.stringify(parseJsonValue(beat.content, 'beat content')),
          beat.createdAt,
        );
      }
    });
    persist(beats);
  }

  listBeats(id: ProjectId): BeatRecord[] {
    const rows: unknown[] = this.db.prepare(
      'SELECT * FROM beat WHERE project_id = ? ORDER BY position',
    ).all(id);
    return rows.map(readBeat);
  }

  saveApprovedOutline(input: SaveApprovedOutlineInput): ApprovedOutline {
    const content = parseJsonValue(
      input.revision.content,
      'chapter outline revision content',
    );
    const persist = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO chapter_outline (
          id, project_id, position, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'approved', ?, ?)
      `).run(
        input.outline.id,
        input.outline.projectId,
        input.outline.position,
        input.outline.createdAt,
        input.outline.updatedAt,
      );
      this.db.prepare(`
        INSERT INTO chapter_outline_revision (
          id, outline_id, revision_number, status, title, content_json, created_at
        ) VALUES (?, ?, ?, 'approved', ?, ?, ?)
      `).run(
        input.revision.id,
        input.outline.id,
        input.revision.revisionNumber,
        input.revision.title,
        JSON.stringify(content),
        input.revision.createdAt,
      );
      this.db.prepare(
        'UPDATE chapter_outline SET active_revision_id = ? WHERE id = ?',
      ).run(input.revision.id, input.outline.id);
    });
    persist();
    const saved = this.getApprovedOutline(input.outline.id);
    if (!saved) throw new Error(`Outline ${input.outline.id} was not persisted`);
    return saved;
  }

  getApprovedOutline(id: OutlineId): ApprovedOutline | null {
    const row: unknown = this.db.prepare(`
      SELECT
        o.id AS outline_id,
        o.project_id,
        o.position,
        o.status AS outline_status,
        o.active_revision_id,
        o.created_at AS outline_created_at,
        o.updated_at,
        r.id AS revision_id,
        r.revision_number,
        r.status AS revision_status,
        r.title,
        r.content_json,
        r.created_at AS revision_created_at
      FROM chapter_outline o
      JOIN chapter_outline_revision r ON r.id = o.active_revision_id
      WHERE o.id = ? AND o.status = 'approved' AND r.status = 'approved'
    `).get(id);
    return row === undefined ? null : readApprovedOutline(row);
  }
}
