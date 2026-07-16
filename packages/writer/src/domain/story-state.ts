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

export interface CharacterPatch {
  name?: string;
  status?: CharacterStatus;
  facts?: string[];
}

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
        characters[index] = {
          ...current,
          ...change.patch,
          facts: change.patch.facts ? [...change.patch.facts] : current.facts,
        };
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
