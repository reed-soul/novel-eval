/**
 * 章节状态提取器 — 从正文推导 story state / delta，不写数据库。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AIAgentAdapter, TokenUsage } from '@novel-eval/shared';
import {
  callWithValidation,
  loadPrompt,
  addUsage,
  zeroUsage,
  type SchemaSpec,
} from '@novel-eval/shared';

import type { ChapterRevisionId } from '../domain/ids.ts';
import {
  applyStoryStateDelta,
  type StoryState,
  type StoryStateDelta,
} from '../domain/story-state.ts';
import { getRuntimeConfig } from '../runtime-config.ts';
import { InvalidPersistenceDataError } from '../domain/errors.ts';
import {
  persistedRecord,
  stringField,
  oneOf,
} from '../repositories/validation.ts';
import {
  chapterRevisionId,
  characterId,
  foreshadowId,
} from '../domain/ids.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

const DELTA_SCHEMA: SchemaSpec = {
  summary: { type: 'string', min: 1, required: true },
  characterChanges: { type: 'array' },
  factChanges: { type: 'array' },
  foreshadowChanges: { type: 'array' },
  timelineEvents: { type: 'array' },
};

export interface ExtractStoryStateOptions {
  engine: AIAgentAdapter;
  previousState: StoryState | null;
  chapterTitle: string;
  chapterContent: string;
  chapterRevisionId: ChapterRevisionId;
  outlinePosition: number;
  promptVersion?: string;
  onProgress?: (step: string, msg: string) => void;
}

export interface ExtractStoryStateResult {
  state: StoryState;
  delta: StoryStateDelta;
  usage: TokenUsage;
  model: string;
  promptVersion: string;
}

function emptyState(): StoryState {
  return {
    characters: [],
    facts: [],
    foreshadows: [],
    timeline: [],
    summary: '',
  };
}

function parseStringArray(value: unknown, entity: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new InvalidPersistenceDataError(entity, 'expected an array of strings');
  }
  return value;
}

function parseDelta(
  value: unknown,
  chapterRevision: ChapterRevisionId,
): StoryStateDelta {
  const entity = 'story state delta extraction';
  const record = persistedRecord(value, entity);
  const characterChangesValue = record.characterChanges;
  const factChangesValue = record.factChanges;
  const foreshadowChangesValue = record.foreshadowChanges;
  const timelineEventsValue = record.timelineEvents;
  if (
    !Array.isArray(characterChangesValue)
    || !Array.isArray(factChangesValue)
    || !Array.isArray(foreshadowChangesValue)
    || !Array.isArray(timelineEventsValue)
  ) {
    throw new InvalidPersistenceDataError(entity, 'delta arrays are required');
  }

  const characterChanges = characterChangesValue.map((changeValue) => {
    const change = persistedRecord(changeValue, `${entity} character change`);
    const kind = oneOf(
      stringField(change, 'kind', `${entity} character change`),
      ['add', 'update', 'remove'] as const,
      `${entity} character change`,
    );
    switch (kind) {
      case 'add': {
        const character = persistedRecord(change.character, `${entity} character`);
        return {
          kind,
          character: {
            id: characterId(stringField(character, 'id', `${entity} character`)),
            name: stringField(character, 'name', `${entity} character`),
            status: oneOf(
              stringField(character, 'status', `${entity} character`),
              ['alive', 'injured', 'missing', 'dead'] as const,
              `${entity} character`,
            ),
            facts: parseStringArray(character.facts, `${entity} character facts`),
          },
        };
      }
      case 'update': {
        const patch = persistedRecord(change.patch, `${entity} character patch`);
        const patchKind = oneOf(
          stringField(patch, 'kind', `${entity} character patch`),
          ['set-name', 'set-status', 'replace-facts'] as const,
          `${entity} character patch`,
        );
        switch (patchKind) {
          case 'set-name':
            return {
              kind,
              characterId: characterId(stringField(change, 'characterId', `${entity} character change`)),
              patch: { kind: patchKind, name: stringField(patch, 'name', `${entity} character patch`) },
            };
          case 'set-status':
            return {
              kind,
              characterId: characterId(stringField(change, 'characterId', `${entity} character change`)),
              patch: {
                kind: patchKind,
                status: oneOf(
                  stringField(patch, 'status', `${entity} character patch`),
                  ['alive', 'injured', 'missing', 'dead'] as const,
                  `${entity} character patch`,
                ),
              },
            };
          case 'replace-facts':
            return {
              kind,
              characterId: characterId(stringField(change, 'characterId', `${entity} character change`)),
              patch: {
                kind: patchKind,
                facts: parseStringArray(patch.facts, `${entity} character patch facts`),
              },
            };
          default: {
            const exhaustive: never = patchKind;
            return exhaustive;
          }
        }
      }
      case 'remove':
        return {
          kind,
          characterId: characterId(stringField(change, 'characterId', `${entity} character change`)),
          reason: stringField(change, 'reason', `${entity} character change`),
        };
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  });

  const factChanges = factChangesValue.map((changeValue) => {
    const change = persistedRecord(changeValue, `${entity} fact change`);
    const kind = oneOf(
      stringField(change, 'kind', `${entity} fact change`),
      ['add', 'remove'] as const,
      `${entity} fact change`,
    );
    switch (kind) {
      case 'add':
        return {
          kind,
          fact: stringField(change, 'fact', `${entity} fact change`),
          sourceChapterRevisionId: chapterRevisionId(
            typeof change.sourceChapterRevisionId === 'string'
              ? change.sourceChapterRevisionId
              : chapterRevision,
          ),
        };
      case 'remove':
        return {
          kind,
          fact: stringField(change, 'fact', `${entity} fact change`),
          reason: stringField(change, 'reason', `${entity} fact change`),
        };
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  });

  const foreshadowChanges = foreshadowChangesValue.map((changeValue) => {
    const change = persistedRecord(changeValue, `${entity} foreshadow change`);
    const kind = oneOf(
      stringField(change, 'kind', `${entity} foreshadow change`),
      ['open', 'resolve'] as const,
      `${entity} foreshadow change`,
    );
    switch (kind) {
      case 'open': {
        const foreshadow = persistedRecord(change.foreshadow, `${entity} foreshadow`);
        return {
          kind,
          foreshadow: {
            id: foreshadowId(stringField(foreshadow, 'id', `${entity} foreshadow`)),
            description: stringField(foreshadow, 'description', `${entity} foreshadow`),
            openedAtChapterRevisionId: chapterRevisionId(
              typeof foreshadow.openedAtChapterRevisionId === 'string'
                ? foreshadow.openedAtChapterRevisionId
                : chapterRevision,
            ),
            status: 'open' as const,
          },
        };
      }
      case 'resolve':
        return {
          kind,
          foreshadowId: foreshadowId(
            stringField(change, 'foreshadowId', `${entity} foreshadow change`),
          ),
          chapterRevisionId: chapterRevisionId(
            typeof change.chapterRevisionId === 'string'
              ? change.chapterRevisionId
              : chapterRevision,
          ),
        };
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  });

  const timelineEvents = timelineEventsValue.map((eventValue) => {
    const event = persistedRecord(eventValue, `${entity} timeline event`);
    return {
      event: stringField(event, 'event', `${entity} timeline event`),
      chapterRevisionId: chapterRevisionId(
        typeof event.chapterRevisionId === 'string'
          ? event.chapterRevisionId
          : chapterRevision,
      ),
    };
  });

  return {
    characterChanges,
    factChanges,
    foreshadowChanges,
    timelineEvents,
    summary: stringField(record, 'summary', entity),
  };
}

/** 纯提取：返回 state/delta，不写 DB。 */
export async function extractStoryState(
  opts: ExtractStoryStateOptions,
): Promise<ExtractStoryStateResult> {
  const {
    engine,
    previousState,
    chapterTitle,
    chapterContent,
    chapterRevisionId,
    outlinePosition,
    onProgress,
  } = opts;
  const promptVersion = opts.promptVersion ?? 'state-v1';
  const totalUsage = { ...zeroUsage };
  const baseline = previousState ?? emptyState();

  onProgress?.(`extract:${outlinePosition}`, '提取章节状态 delta...');

  const result = await callWithValidation<Record<string, unknown>>(
    engine,
    loadPrompt('state-update', PROMPTS_DIR)
      .replace('{OLD_STATE}', JSON.stringify(baseline))
      .replace(
        '{CHAPTER_TEXT}',
        `第${outlinePosition}章《${chapterTitle}》\n${chapterContent.slice(0, 8000)}`,
      ),
    {
      systemPrompt: '你是小说连贯性编辑。只输出 JSON story state delta。',
      temperature: getRuntimeConfig().generation.temperatures.finalize,
      maxTokens: 3000,
      timeoutMs: getRuntimeConfig().generation.timeouts.finalizeMs,
      schema: DELTA_SCHEMA,
      maxAttempts: 3,
      enableCache: true,
    },
  );

  if (!result.ok || !result.data) {
    throw new Error(`state extraction failed: ${result.errors.join('; ')}`);
  }

  addUsage(totalUsage, result.totalUsage);
  const delta = parseDelta(result.data, chapterRevisionId);
  const state = applyStoryStateDelta(baseline, delta);
  return {
    state,
    delta,
    usage: totalUsage,
    model: totalUsage.model || engine.name,
    promptVersion,
  };
}

/** @deprecated 旧名称；请使用 extractStoryState。保留别名便于过渡。 */
export const finalizeChapter = extractStoryState;
