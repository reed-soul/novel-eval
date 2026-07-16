import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  applyStoryStateDelta,
  type StoryState,
  type StoryStateDelta,
} from '../../src/domain/story-state.ts';
import {
  chapterRevisionId,
  characterId,
  foreshadowId,
} from '../../src/domain/ids.ts';
import { InvalidStoryStateDeltaError } from '../../src/domain/errors.ts';

function storyState(overrides: Partial<StoryState> = {}): StoryState {
  return {
    characters: [],
    facts: [],
    foreshadows: [],
    timeline: [],
    summary: '',
    ...overrides,
  };
}

it('keeps characters that are absent from a delta', () => {
  const previous = storyState({
    characters: [{
      id: characterId('lin'),
      name: '林晚',
      status: 'alive',
      facts: ['左手受伤'],
    }],
  });

  const next = applyStoryStateDelta(previous, {
    characterChanges: [],
    factChanges: [{
      kind: 'add',
      fact: '林晚到达北站',
      sourceChapterRevisionId: chapterRevisionId('rev-2'),
    }],
    foreshadowChanges: [],
    timelineEvents: [],
    summary: '林晚抵达北站。',
  });

  assert.deepEqual(next.characters, previous.characters);
  assert.notStrictEqual(next, previous);
});

it('requires an explicit remove event before deleting a character', () => {
  const previous = storyState({
    characters: [{
      id: characterId('lin'),
      name: '林晚',
      status: 'alive',
      facts: [],
    }],
  });
  const invalidImplicitDeletion: unknown = {
    characterChanges: [{ kind: 'replace', characters: [] }],
    factChanges: [],
    foreshadowChanges: [],
    timelineEvents: [],
    summary: '林晚消失。',
  };

  assert.throws(
    () => Reflect.apply(applyStoryStateDelta, undefined, [previous, invalidImplicitDeletion]),
    InvalidStoryStateDeltaError,
  );
});

it('applies every explicit change without mutating the previous state', () => {
  const lin = characterId('lin');
  const oldRevision = chapterRevisionId('rev-1');
  const newRevision = chapterRevisionId('rev-2');
  const clue = foreshadowId('clue');
  const previous = storyState({
    characters: [{ id: lin, name: '林晚', status: 'alive', facts: ['左手受伤'] }],
    facts: [{ fact: '旧事实', sourceChapterRevisionId: oldRevision }],
    foreshadows: [{
      id: clue,
      description: '失踪的车票',
      openedAtChapterRevisionId: oldRevision,
      status: 'open',
    }],
    timeline: [{ event: '林晚离家', chapterRevisionId: oldRevision }],
    summary: '旧摘要',
  });
  const delta: StoryStateDelta = {
    characterChanges: [{
      kind: 'update',
      characterId: lin,
      patch: { kind: 'set-status', status: 'injured' },
    }, {
      kind: 'update',
      characterId: lin,
      patch: { kind: 'replace-facts', facts: ['左手受伤', '失去车票'] },
    }, {
      kind: 'add',
      character: {
        id: characterId('zhou'),
        name: '周岑',
        status: 'alive',
        facts: [],
      },
    }],
    factChanges: [
      { kind: 'remove', fact: '旧事实', reason: '已被推翻' },
      { kind: 'add', fact: '林晚到达北站', sourceChapterRevisionId: newRevision },
    ],
    foreshadowChanges: [{
      kind: 'resolve',
      foreshadowId: clue,
      chapterRevisionId: newRevision,
    }],
    timelineEvents: [{ event: '林晚抵达北站', chapterRevisionId: newRevision }],
    summary: '新摘要',
  };

  const next = applyStoryStateDelta(previous, delta);

  assert.deepEqual(next, {
    characters: [
      { id: lin, name: '林晚', status: 'injured', facts: ['左手受伤', '失去车票'] },
      { id: characterId('zhou'), name: '周岑', status: 'alive', facts: [] },
    ],
    facts: [{ fact: '林晚到达北站', sourceChapterRevisionId: newRevision }],
    foreshadows: [{
      id: clue,
      description: '失踪的车票',
      openedAtChapterRevisionId: oldRevision,
      status: 'resolved',
      resolvedAtChapterRevisionId: newRevision,
    }],
    timeline: [
      { event: '林晚离家', chapterRevisionId: oldRevision },
      { event: '林晚抵达北站', chapterRevisionId: newRevision },
    ],
    summary: '新摘要',
  });
  assert.deepEqual(previous.characters[0], {
    id: lin,
    name: '林晚',
    status: 'alive',
    facts: ['左手受伤'],
  });
  assert.equal(previous.foreshadows[0]?.status, 'open');
});

it('rejects an empty character update patch', () => {
  const previous = storyState({
    characters: [{
      id: characterId('lin'),
      name: '林晚',
      status: 'alive',
      facts: [],
    }],
  });
  const invalidDelta: unknown = {
    characterChanges: [{
      kind: 'update',
      characterId: characterId('lin'),
      patch: {},
    }],
    factChanges: [],
    foreshadowChanges: [],
    timelineEvents: [],
    summary: '摘要',
  };

  assert.throws(
    () => Reflect.apply(applyStoryStateDelta, undefined, [previous, invalidDelta]),
    InvalidStoryStateDeltaError,
  );
});
