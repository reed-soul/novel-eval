import { InvalidStoryStateDeltaError } from './errors.ts';
import type {
  ChapterRevisionId,
  CharacterId,
  ForeshadowId,
} from './ids.ts';

export type CharacterStatus = 'alive' | 'injured' | 'missing' | 'dead';

export interface CharacterState {
  id: CharacterId;
  name: string;
  status: CharacterStatus;
  facts: string[];
}

export type CharacterPatch =
  | { kind: 'set-name'; name: string }
  | { kind: 'set-status'; status: CharacterStatus }
  | { kind: 'replace-facts'; facts: string[] };

export type CharacterChange =
  | { kind: 'add'; character: CharacterState }
  | { kind: 'update'; characterId: CharacterId; patch: CharacterPatch }
  | { kind: 'remove'; characterId: CharacterId; reason: string };

export interface StoryFact {
  fact: string;
  sourceChapterRevisionId: ChapterRevisionId;
}

export type FactChange =
  | { kind: 'add'; fact: string; sourceChapterRevisionId: ChapterRevisionId }
  | { kind: 'remove'; fact: string; reason: string };

export interface OpenForeshadow {
  id: ForeshadowId;
  description: string;
  openedAtChapterRevisionId: ChapterRevisionId;
  status: 'open';
}

export interface ResolvedForeshadow {
  id: ForeshadowId;
  description: string;
  openedAtChapterRevisionId: ChapterRevisionId;
  status: 'resolved';
  resolvedAtChapterRevisionId: ChapterRevisionId;
}

export type ForeshadowState = OpenForeshadow | ResolvedForeshadow;

export type ForeshadowChange =
  | { kind: 'open'; foreshadow: OpenForeshadow }
  | {
      kind: 'resolve';
      foreshadowId: ForeshadowId;
      chapterRevisionId: ChapterRevisionId;
    };

export interface TimelineEvent {
  event: string;
  chapterRevisionId: ChapterRevisionId;
}

export interface StoryState {
  characters: CharacterState[];
  facts: StoryFact[];
  foreshadows: ForeshadowState[];
  timeline: TimelineEvent[];
  summary: string;
}

export interface StoryStateDelta {
  characterChanges: CharacterChange[];
  factChanges: FactChange[];
  foreshadowChanges: ForeshadowChange[];
  timelineEvents: TimelineEvent[];
  summary: string;
}

function invalid(detail: string): never {
  throw new InvalidStoryStateDeltaError(detail);
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) invalid(`${field} must not be empty`);
}

function cloneCharacter(character: CharacterState): CharacterState {
  return { ...character, facts: [...character.facts] };
}

function validateDeltaShape(delta: StoryStateDelta): void {
  if (
    !Array.isArray(delta.characterChanges)
    || !Array.isArray(delta.factChanges)
    || !Array.isArray(delta.foreshadowChanges)
    || !Array.isArray(delta.timelineEvents)
    || typeof delta.summary !== 'string'
  ) {
    invalid('delta has an invalid shape');
  }
}

function applyCharacterChanges(
  previous: CharacterState[],
  changes: CharacterChange[],
): CharacterState[] {
  const characters = previous.map(cloneCharacter);
  for (const change of changes) {
    switch (change.kind) {
      case 'add': {
        if (characters.some((character) => character.id === change.character.id)) {
          invalid(`character ${change.character.id} already exists`);
        }
        characters.push(cloneCharacter(change.character));
        break;
      }
      case 'update': {
        const index = characters.findIndex((character) => character.id === change.characterId);
        if (index < 0) invalid(`character ${change.characterId} does not exist`);
        const current = characters[index];
        if (!current) invalid(`character ${change.characterId} does not exist`);
        switch (change.patch.kind) {
          case 'set-name':
            characters[index] = { ...current, name: change.patch.name };
            break;
          case 'set-status':
            characters[index] = { ...current, status: change.patch.status };
            break;
          case 'replace-facts':
            characters[index] = { ...current, facts: [...change.patch.facts] };
            break;
          default: {
            const exhaustive: never = change.patch;
            invalid(`unsupported character patch: ${String(exhaustive)}`);
          }
        }
        break;
      }
      case 'remove': {
        requireNonEmpty(change.reason, 'character removal reason');
        const index = characters.findIndex((character) => character.id === change.characterId);
        if (index < 0) invalid(`character ${change.characterId} does not exist`);
        characters.splice(index, 1);
        break;
      }
      default: {
        const exhaustive: never = change;
        invalid(`unsupported character change: ${String(exhaustive)}`);
      }
    }
  }
  return characters;
}

function applyFactChanges(previous: StoryFact[], changes: FactChange[]): StoryFact[] {
  const facts = previous.map((fact) => ({ ...fact }));
  for (const change of changes) {
    switch (change.kind) {
      case 'add':
        requireNonEmpty(change.fact, 'fact');
        facts.push({
          fact: change.fact,
          sourceChapterRevisionId: change.sourceChapterRevisionId,
        });
        break;
      case 'remove': {
        requireNonEmpty(change.reason, 'fact removal reason');
        const index = facts.findIndex((fact) => fact.fact === change.fact);
        if (index < 0) invalid(`fact does not exist: ${change.fact}`);
        facts.splice(index, 1);
        break;
      }
      default: {
        const exhaustive: never = change;
        invalid(`unsupported fact change: ${String(exhaustive)}`);
      }
    }
  }
  return facts;
}

function applyForeshadowChanges(
  previous: ForeshadowState[],
  changes: ForeshadowChange[],
): ForeshadowState[] {
  const foreshadows = previous.map((foreshadow) => ({ ...foreshadow }));
  for (const change of changes) {
    switch (change.kind) {
      case 'open':
        if (foreshadows.some((foreshadow) => foreshadow.id === change.foreshadow.id)) {
          invalid(`foreshadow ${change.foreshadow.id} already exists`);
        }
        foreshadows.push({ ...change.foreshadow });
        break;
      case 'resolve': {
        const index = foreshadows.findIndex(
          (foreshadow) => foreshadow.id === change.foreshadowId,
        );
        const current = foreshadows[index];
        if (!current) invalid(`foreshadow ${change.foreshadowId} does not exist`);
        if (current.status !== 'open') {
          invalid(`foreshadow ${change.foreshadowId} is already resolved`);
        }
        foreshadows[index] = {
          ...current,
          status: 'resolved',
          resolvedAtChapterRevisionId: change.chapterRevisionId,
        };
        break;
      }
      default: {
        const exhaustive: never = change;
        invalid(`unsupported foreshadow change: ${String(exhaustive)}`);
      }
    }
  }
  return foreshadows;
}

export function applyStoryStateDelta(
  previous: StoryState,
  delta: StoryStateDelta,
): StoryState {
  validateDeltaShape(delta);
  return {
    characters: applyCharacterChanges(previous.characters, delta.characterChanges),
    facts: applyFactChanges(previous.facts, delta.factChanges),
    foreshadows: applyForeshadowChanges(previous.foreshadows, delta.foreshadowChanges),
    timeline: [
      ...previous.timeline.map((event) => ({ ...event })),
      ...delta.timelineEvents.map((event) => ({ ...event })),
    ],
    summary: delta.summary,
  };
}

/**
 * 格式化故事状态为自然语言强约束时空与事实断言板。
 * 供大模型提示词直接消费，替代扁平 JSON 倾倒。
 */
export function formatStoryStateDirectives(state: StoryState | null): string {
  if (!state) {
    return '（第一章：故事开篇，无前情状态约束）';
  }

  const sections: string[] = [];

  if (state.summary && state.summary.trim().length > 0) {
    sections.push(`【前情主线梗概】\n${state.summary.trim()}`);
  }

  if (state.characters && state.characters.length > 0) {
    const statusMap: Record<CharacterStatus, string> = {
      alive: '存活/在世',
      injured: '负伤/行动受限',
      missing: '失踪/下落不明',
      dead: '已死亡/已故（严禁复活出现）',
    };
    const charLines = state.characters.map((c) => {
      const st = statusMap[c.status] ?? c.status;
      const factsStr = c.facts && c.facts.length > 0 ? `；既定特征与状态：${c.facts.join('，')}` : '';
      return `- ${c.name} [${st}]${factsStr}`;
    });
    sections.push(`【角色状态看板（严禁违反生存状态与既有身份）】\n${charLines.join('\n')}`);
  }

  if (state.facts && state.facts.length > 0) {
    const factLines = state.facts.map((f, i) => `${i + 1}. ${f.fact}`);
    sections.push(`【既成不可违背事实与物证（严禁发生物理矛盾或重复发现）】\n${factLines.join('\n')}`);
  }

  const openForeshadows = (state.foreshadows || []).filter((f) => f.status === 'open');
  if (openForeshadows.length > 0) {
    const fsLines = openForeshadows.map((f, i) => `${i + 1}. [待回收] ${f.description}`);
    sections.push(`【未回收的伏笔与悬念（本章适度推进或回收）】\n${fsLines.join('\n')}`);
  }

  if (state.timeline && state.timeline.length > 0) {
    // 保留最近 5 条时间线事件，避免 token 爆炸同时保证最近时空锚点连续
    const recentTimeline = state.timeline.slice(-5);
    const tlLines = recentTimeline.map((t) => `- ${t.event}`);
    sections.push(`【近期物理时间线（严格承接时间锚点，严禁昼夜与时序颠倒）】\n${tlLines.join('\n')}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : '（暂无前情具体状态变化）';
}
