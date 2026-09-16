import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  applyStoryStateDelta,
  formatStoryStateDirectives,
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

it('formatStoryStateDirectives formats state into readable directives', () => {
  const emptyOutput = formatStoryStateDirectives(null);
  assert.ok(emptyOutput.includes('第一章'));

  const state = storyState({
    summary: '苏野到达红旗林业局',
    characters: [
      {
        id: characterId('char-suye'),
        name: '苏野',
        status: 'alive',
        facts: ['刑警队长', '右手负伤'],
      },
      {
        id: characterId('char-suwenyuan'),
        name: '苏文远',
        status: 'dead',
        facts: ['遇害者'],
      },
    ],
    facts: [
      {
        fact: '候车室东墙内起获铁盒',
        sourceChapterRevisionId: chapterRevisionId('rev-1'),
      },
    ],
    foreshadows: [
      {
        id: foreshadowId('fs-schedule'),
        description: '调度令时间被涂改',
        openedAtChapterRevisionId: chapterRevisionId('rev-1'),
        status: 'open',
      },
      {
        id: foreshadowId('fs-old'),
        description: '已查清的事实',
        openedAtChapterRevisionId: chapterRevisionId('rev-1'),
        status: 'resolved',
        resolvedAtChapterRevisionId: chapterRevisionId('rev-2'),
      },
    ],
    timeline: [
      {
        event: '1998年12月15日上午08:07火灾',
        chapterRevisionId: chapterRevisionId('rev-1'),
      },
    ],
  });

  const output = formatStoryStateDirectives(state);
  assert.ok(output.includes('苏野到达红旗林业局'));
  assert.ok(output.includes('苏野 [存活/在世]'));
  assert.ok(output.includes('苏文远 [已死亡/已故（严禁复活出现）]'));
  assert.ok(output.includes('候车室东墙内起获铁盒'));
  assert.ok(output.includes('调度令时间被涂改'));
  assert.equal(output.includes('已查清的事实'), false); // resolved foreshadows excluded
  assert.ok(output.includes('1998年12月15日上午08:07火灾'));
});

// ── 抽取自愈语义（2026-09-16 夜跑死锁类：write auto 三连败的根因）──

it('double-resolve of a foreshadow is idempotent, not fatal', () => {
  const clue = foreshadowId('clue');
  const rev1 = chapterRevisionId('rev-1');
  const rev2 = chapterRevisionId('rev-2');
  const previous = storyState({
    foreshadows: [{
      id: clue,
      description: '失踪的车票',
      openedAtChapterRevisionId: rev1,
      status: 'resolved',
      resolvedAtChapterRevisionId: rev1,
    } as StoryState['foreshadows'][number]],
  });

  const next = applyStoryStateDelta(previous, {
    characterChanges: [],
    factChanges: [],
    foreshadowChanges: [{ kind: 'resolve', foreshadowId: clue, chapterRevisionId: rev2 }],
    timelineEvents: [],
    summary: '后章再次回收（蓝图拍点与前章抽取重叠）。',
  });

  const again = next.foreshadows[0]!;
  assert.equal(again.status, 'resolved');
  assert.equal((again as { resolvedAtChapterRevisionId: string }).resolvedAtChapterRevisionId, rev1);
});

it('resolving an unregistered foreshadow self-heals a resolved entry', () => {
  const ghost = foreshadowId('ghost');
  const next = applyStoryStateDelta(storyState(), {
    characterChanges: [],
    factChanges: [],
    foreshadowChanges: [{ kind: 'resolve', foreshadowId: ghost, chapterRevisionId: chapterRevisionId('rev-9') }],
    timelineEvents: [],
    summary: '跨章 cliffhanger 直接回收未建档伏笔。',
  });
  assert.equal(next.foreshadows.length, 1);
  assert.equal(next.foreshadows[0]!.status, 'resolved');
});

it('updating an unregistered character auto-creates the entity from the patch', () => {
  const villain = characterId('char-hemingzhang');
  const next = applyStoryStateDelta(storyState(), {
    characterChanges: [
      { kind: 'update', characterId: villain, patch: { kind: 'set-name', name: '贺明章' } },
      { kind: 'update', characterId: villain, patch: { kind: 'replace-facts', facts: ['副校长', '调包案嫌疑人'] } },
    ],
    factChanges: [],
    foreshadowChanges: [],
    timelineEvents: [],
    summary: '正文提及但从未建档的反派登场。',
  });
  assert.equal(next.characters.length, 1);
  assert.equal(next.characters[0]!.name, '贺明章');
  assert.deepEqual(next.characters[0]!.facts, ['副校长', '调包案嫌疑人']);
});

it('re-adding an existing character merges instead of failing', () => {
  const lin = characterId('lin');
  const previous = storyState({
    characters: [{ id: lin, name: '林晚', status: 'alive', facts: ['旧事实'] }],
  });
  const next = applyStoryStateDelta(previous, {
    characterChanges: [{
      kind: 'add',
      character: { id: lin, name: '林晚', status: 'injured', facts: ['新事实'] },
    }],
    factChanges: [],
    foreshadowChanges: [],
    timelineEvents: [],
    summary: '跨章重复 add 同一角色。',
  });
  assert.equal(next.characters.length, 1);
  assert.equal(next.characters[0]!.status, 'injured');
  assert.deepEqual(next.characters[0]!.facts, ['新事实']);
});

it('removing an absent fact is idempotent', () => {
  const next = applyStoryStateDelta(storyState(), {
    characterChanges: [],
    factChanges: [{ kind: 'remove', fact: '从未存在的事实', reason: '已被推翻' }],
    foreshadowChanges: [],
    timelineEvents: [],
    summary: '移除不存在的事实。',
  });
  assert.equal(next.facts.length, 0);
});
