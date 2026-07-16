import type { DB } from '../db.ts';
import { InvalidPersistenceDataError } from '../domain/errors.ts';
import {
  chapterId,
  chapterRevisionId,
  characterId,
  foreshadowId,
  projectId,
  storyStateRevisionId,
  type ProjectId,
  type StoryStateRevisionId,
} from '../domain/ids.ts';
import type {
  CharacterChange,
  CharacterPatch,
  CharacterState,
  FactChange,
  ForeshadowChange,
  ForeshadowState,
  StoryFact,
  StoryState,
  StoryStateDelta,
  TimelineEvent,
} from '../domain/story-state.ts';
import {
  nullableStringField,
  numberField,
  oneOf,
  parseJson,
  persistedRecord,
  stringField,
} from './validation.ts';

export type StoryStateRevisionStatus = 'current' | 'stale' | 'failed';

export interface StoryStateRevision {
  id: StoryStateRevisionId;
  projectId: ReturnType<typeof projectId>;
  chapterId: ReturnType<typeof chapterId>;
  chapterRevisionId: ReturnType<typeof chapterRevisionId>;
  previousStateRevisionId: StoryStateRevisionId | null;
  sequence: number;
  status: StoryStateRevisionStatus;
  state: StoryState;
  delta: StoryStateDelta;
  summary: string;
  model: string;
  promptVersion: string;
  createdAt: string;
}

function arrayValue(
  record: Record<string, unknown>,
  field: string,
  entity: string,
): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new InvalidPersistenceDataError(entity, `${field} must be an array`);
  }
  return value;
}

function stringArray(value: unknown, entity: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new InvalidPersistenceDataError(entity, 'expected an array of strings');
  }
  return value.map((item) => {
    if (typeof item !== 'string') {
      throw new InvalidPersistenceDataError(entity, 'expected a string');
    }
    return item;
  });
}

function parseCharacter(value: unknown): CharacterState {
  const entity = 'story state character';
  const record = persistedRecord(value, entity);
  return {
    id: characterId(stringField(record, 'id', entity)),
    name: stringField(record, 'name', entity),
    status: oneOf(
      stringField(record, 'status', entity),
      ['alive', 'injured', 'missing', 'dead'] as const,
      entity,
    ),
    facts: stringArray(record.facts, `${entity} facts`),
  };
}

function parseFact(value: unknown): StoryFact {
  const entity = 'story fact';
  const record = persistedRecord(value, entity);
  return {
    fact: stringField(record, 'fact', entity),
    sourceChapterRevisionId: chapterRevisionId(
      stringField(record, 'sourceChapterRevisionId', entity),
    ),
  };
}

function parseForeshadow(value: unknown): ForeshadowState {
  const entity = 'story foreshadow';
  const record = persistedRecord(value, entity);
  const status = oneOf(
    stringField(record, 'status', entity),
    ['open', 'resolved'] as const,
    entity,
  );
  const base = {
    id: foreshadowId(stringField(record, 'id', entity)),
    description: stringField(record, 'description', entity),
    openedAtChapterRevisionId: chapterRevisionId(
      stringField(record, 'openedAtChapterRevisionId', entity),
    ),
  };
  switch (status) {
    case 'open':
      return { ...base, status };
    case 'resolved':
      return {
        ...base,
        status,
        resolvedAtChapterRevisionId: chapterRevisionId(
          stringField(record, 'resolvedAtChapterRevisionId', entity),
        ),
      };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function parseTimelineEvent(value: unknown): TimelineEvent {
  const entity = 'timeline event';
  const record = persistedRecord(value, entity);
  return {
    event: stringField(record, 'event', entity),
    chapterRevisionId: chapterRevisionId(
      stringField(record, 'chapterRevisionId', entity),
    ),
  };
}

function parseStoryState(text: string): StoryState {
  const entity = 'story state';
  const record = persistedRecord(parseJson(text, entity), entity);
  return {
    characters: arrayValue(record, 'characters', entity).map(parseCharacter),
    facts: arrayValue(record, 'facts', entity).map(parseFact),
    foreshadows: arrayValue(record, 'foreshadows', entity).map(parseForeshadow),
    timeline: arrayValue(record, 'timeline', entity).map(parseTimelineEvent),
    summary: stringField(record, 'summary', entity),
  };
}

function parseCharacterPatch(value: unknown): CharacterPatch {
  const entity = 'character patch';
  const record = persistedRecord(value, entity);
  const patch: CharacterPatch = {};
  if ('name' in record) patch.name = stringField(record, 'name', entity);
  if ('status' in record) {
    patch.status = oneOf(
      stringField(record, 'status', entity),
      ['alive', 'injured', 'missing', 'dead'] as const,
      entity,
    );
  }
  if ('facts' in record) patch.facts = stringArray(record.facts, `${entity} facts`);
  return patch;
}

function parseCharacterChange(value: unknown): CharacterChange {
  const entity = 'character change';
  const record = persistedRecord(value, entity);
  const kind = oneOf(
    stringField(record, 'kind', entity),
    ['add', 'update', 'remove'] as const,
    entity,
  );
  switch (kind) {
    case 'add':
      return { kind, character: parseCharacter(record.character) };
    case 'update':
      return {
        kind,
        characterId: characterId(stringField(record, 'characterId', entity)),
        patch: parseCharacterPatch(record.patch),
      };
    case 'remove':
      return {
        kind,
        characterId: characterId(stringField(record, 'characterId', entity)),
        reason: stringField(record, 'reason', entity),
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function parseFactChange(value: unknown): FactChange {
  const entity = 'fact change';
  const record = persistedRecord(value, entity);
  const kind = oneOf(
    stringField(record, 'kind', entity),
    ['add', 'remove'] as const,
    entity,
  );
  switch (kind) {
    case 'add':
      return {
        kind,
        fact: stringField(record, 'fact', entity),
        sourceChapterRevisionId: chapterRevisionId(
          stringField(record, 'sourceChapterRevisionId', entity),
        ),
      };
    case 'remove':
      return {
        kind,
        fact: stringField(record, 'fact', entity),
        reason: stringField(record, 'reason', entity),
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function parseForeshadowChange(value: unknown): ForeshadowChange {
  const entity = 'foreshadow change';
  const record = persistedRecord(value, entity);
  const kind = oneOf(
    stringField(record, 'kind', entity),
    ['open', 'resolve'] as const,
    entity,
  );
  switch (kind) {
    case 'open': {
      const foreshadow = parseForeshadow(record.foreshadow);
      if (foreshadow.status !== 'open') {
        throw new InvalidPersistenceDataError(entity, 'opened foreshadow must be open');
      }
      return { kind, foreshadow };
    }
    case 'resolve':
      return {
        kind,
        foreshadowId: foreshadowId(stringField(record, 'foreshadowId', entity)),
        chapterRevisionId: chapterRevisionId(
          stringField(record, 'chapterRevisionId', entity),
        ),
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function parseStoryStateDelta(text: string): StoryStateDelta {
  const entity = 'story state delta';
  const record = persistedRecord(parseJson(text, entity), entity);
  return {
    characterChanges: arrayValue(record, 'characterChanges', entity).map(
      parseCharacterChange,
    ),
    factChanges: arrayValue(record, 'factChanges', entity).map(parseFactChange),
    foreshadowChanges: arrayValue(record, 'foreshadowChanges', entity).map(
      parseForeshadowChange,
    ),
    timelineEvents: arrayValue(record, 'timelineEvents', entity).map(
      parseTimelineEvent,
    ),
    summary: stringField(record, 'summary', entity),
  };
}

function readRevision(value: unknown): StoryStateRevision {
  const entity = 'story state revision';
  const row = persistedRecord(value, entity);
  const previous = nullableStringField(row, 'previous_state_revision_id', entity);
  return {
    id: storyStateRevisionId(stringField(row, 'id', entity)),
    projectId: projectId(stringField(row, 'project_id', entity)),
    chapterId: chapterId(stringField(row, 'chapter_id', entity)),
    chapterRevisionId: chapterRevisionId(
      stringField(row, 'chapter_revision_id', entity),
    ),
    previousStateRevisionId: previous === null ? null : storyStateRevisionId(previous),
    sequence: numberField(row, 'sequence', entity),
    status: oneOf(
      stringField(row, 'status', entity),
      ['current', 'stale', 'failed'] as const,
      entity,
    ),
    state: parseStoryState(stringField(row, 'state_json', entity)),
    delta: parseStoryStateDelta(stringField(row, 'delta_json', entity)),
    summary: stringField(row, 'summary', entity),
    model: stringField(row, 'model', entity),
    promptVersion: stringField(row, 'prompt_version', entity),
    createdAt: stringField(row, 'created_at', entity),
  };
}

export class StoryStateRepository {
  constructor(private readonly db: DB) {}

  save(revision: StoryStateRevision): StoryStateRevision {
    this.db.prepare(`
      INSERT INTO story_state_revision (
        id, project_id, chapter_id, chapter_revision_id, previous_state_revision_id,
        sequence, status, state_json, delta_json, summary, model, prompt_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.id,
      revision.projectId,
      revision.chapterId,
      revision.chapterRevisionId,
      revision.previousStateRevisionId,
      revision.sequence,
      revision.status,
      JSON.stringify(revision.state),
      JSON.stringify(revision.delta),
      revision.summary,
      revision.model,
      revision.promptVersion,
      revision.createdAt,
    );
    const saved = this.get(revision.id);
    if (!saved) throw new Error(`Story state revision ${revision.id} was not persisted`);
    return saved;
  }

  get(id: StoryStateRevisionId): StoryStateRevision | null {
    const row: unknown = this.db.prepare(
      'SELECT * FROM story_state_revision WHERE id = ?',
    ).get(id);
    return row === undefined ? null : readRevision(row);
  }

  getCurrent(id: ProjectId): StoryStateRevision | null {
    const row: unknown = this.db.prepare(`
      SELECT *
      FROM story_state_revision
      WHERE project_id = ? AND status = 'current'
      ORDER BY sequence DESC
      LIMIT 1
    `).get(id);
    return row === undefined ? null : readRevision(row);
  }
}
