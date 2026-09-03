/**
 * 章节状态提取器 — 从正文推导 story state / delta，不写数据库。
 */
import { randomUUID } from 'node:crypto';
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
  // Arrays are optional in schema: models often omit empty lists.
  // extractStoryState normalizes missing keys to [] before parseDelta.
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
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
      .filter((s) => s.length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}

function normalizeStatus(raw: unknown): 'alive' | 'injured' | 'missing' | 'dead' {
  if (typeof raw !== 'string') return 'alive';
  const s = raw.trim().toLowerCase();
  if (s === 'alive' || s === '正常' || s === '健康' || s === '在世' || s === '存活') return 'alive';
  if (s === 'injured' || s === '受伤' || s === '负伤' || s === '重伤' || s === '轻伤' || s === '残疾') return 'injured';
  if (s === 'missing' || s === '失踪' || s === '失联' || s === '下落不明') return 'missing';
  if (s === 'dead' || s === '死亡' || s === '遇害' || s === '牺牲' || s === '身亡' || s === '毙命') return 'dead';
  return 'alive';
}

export function parseDelta(
  value: unknown,
  chapterRevision: ChapterRevisionId,
  baseline?: StoryState | null,
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
        const rawName = stringField(character, 'name', `${entity} character`);
        const rawId = typeof character.id === 'string' && character.id.trim().length > 0
          ? character.id.trim()
          : `char-${rawName.trim().replace(/[\s\W]+/g, '-') || randomUUID().slice(0, 8)}`;
        return {
          kind,
          character: {
            id: characterId(rawId),
            name: rawName,
            status: normalizeStatus(character.status),
            facts: parseStringArray(character.facts, `${entity} character facts`),
          },
        };
      }
      case 'update': {
        const rawCharId = stringField(change, 'characterId', `${entity} character change`);
        let resolvedCharId = rawCharId;
        if (baseline?.characters) {
          const match = baseline.characters.find(c => c.id === rawCharId || c.name === rawCharId);
          if (match) resolvedCharId = match.id;
        }

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
              characterId: characterId(resolvedCharId),
              patch: { kind: patchKind, name: stringField(patch, 'name', `${entity} character patch`) },
            };
          case 'set-status':
            return {
              kind,
              characterId: characterId(resolvedCharId),
              patch: {
                kind: patchKind,
                status: normalizeStatus(patch.status),
              },
            };
          case 'replace-facts':
            return {
              kind,
              characterId: characterId(resolvedCharId),
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
      case 'remove': {
        const rawCharId = stringField(change, 'characterId', `${entity} character change`);
        let resolvedCharId = rawCharId;
        if (baseline?.characters) {
          const match = baseline.characters.find(c => c.id === rawCharId || c.name === rawCharId);
          if (match) resolvedCharId = match.id;
        }
        return {
          kind,
          characterId: characterId(resolvedCharId),
          reason: stringField(change, 'reason', `${entity} character change`),
        };
      }
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

  const foreshadowChanges = foreshadowChangesValue.map((changeValue, idx) => {
    const change = persistedRecord(changeValue, `${entity} foreshadow change`);
    const kind = oneOf(
      stringField(change, 'kind', `${entity} foreshadow change`),
      ['open', 'resolve'] as const,
      `${entity} foreshadow change`,
    );
    switch (kind) {
      case 'open': {
        const foreshadow = persistedRecord(change.foreshadow, `${entity} foreshadow`);
        const rawFsId = typeof foreshadow.id === 'string' && foreshadow.id.trim().length > 0
          ? foreshadow.id.trim()
          : `fs-${idx + 1}-${randomUUID().slice(0, 6)}`;
        return {
          kind,
          foreshadow: {
            id: foreshadowId(rawFsId),
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
      case 'resolve': {
        const rawFsId = stringField(change, 'foreshadowId', `${entity} foreshadow change`);
        let resolvedFsId = rawFsId;
        if (baseline?.foreshadows) {
          const match = baseline.foreshadows.find(f => f.id === rawFsId || f.description.includes(rawFsId));
          if (match) resolvedFsId = match.id;
        }
        return {
          kind,
          foreshadowId: foreshadowId(resolvedFsId),
          chapterRevisionId: chapterRevisionId(
            typeof change.chapterRevisionId === 'string'
              ? change.chapterRevisionId
              : chapterRevision,
          ),
        };
      }
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
  // Coerce absent arrays only if a caller bypasses schema; required arrays are enforced above.
  const normalized = {
    ...result.data,
    characterChanges: Array.isArray(result.data.characterChanges) ? result.data.characterChanges : [],
    factChanges: Array.isArray(result.data.factChanges) ? result.data.factChanges : [],
    foreshadowChanges: Array.isArray(result.data.foreshadowChanges) ? result.data.foreshadowChanges : [],
    timelineEvents: Array.isArray(result.data.timelineEvents) ? result.data.timelineEvents : [],
  };
  const delta = parseDelta(normalized, chapterRevisionId, baseline);
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
