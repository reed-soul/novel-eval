/**
 * Missing delta arrays from LLM must not crash publish after schema "ok".
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validate } from '@novel-eval/shared';
import { parseDelta } from '../../src/chapter/finalizer.ts';
import { chapterRevisionId, characterId, foreshadowId } from '../../src/domain/ids.ts';
import type { StoryState } from '../../src/domain/story-state.ts';

const DELTA_SCHEMA = {
  summary: { type: 'string' as const, min: 1, required: true },
  characterChanges: { type: 'array' as const },
  factChanges: { type: 'array' as const },
  foreshadowChanges: { type: 'array' as const },
  timelineEvents: { type: 'array' as const },
};

function normalizeDeltaArrays(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ...data,
    characterChanges: Array.isArray(data.characterChanges) ? data.characterChanges : [],
    factChanges: Array.isArray(data.factChanges) ? data.factChanges : [],
    foreshadowChanges: Array.isArray(data.foreshadowChanges) ? data.foreshadowChanges : [],
    timelineEvents: Array.isArray(data.timelineEvents) ? data.timelineEvents : [],
  };
}

describe('state extraction delta normalization', () => {
  it('schema accepts summary-only payload (arrays omitted)', () => {
    const errors = validate({ summary: '本章推进主线' }, DELTA_SCHEMA);
    assert.deepEqual(errors, []);
  });

  it('normalize fills missing arrays with empty lists', () => {
    const normalized = normalizeDeltaArrays({ summary: '本章推进主线' });
    assert.deepEqual(normalized.characterChanges, []);
    assert.deepEqual(normalized.factChanges, []);
    assert.deepEqual(normalized.foreshadowChanges, []);
    assert.deepEqual(normalized.timelineEvents, []);
    assert.equal(normalized.summary, '本章推进主线');
  });

  it('parseDelta parses full rich delta and normalizes status and IDs', () => {
    const revId = chapterRevisionId('rev-ch1-1');
    const raw = {
      summary: '苏野进入老候车室，发现东墙有异常',
      characterChanges: [
        {
          kind: 'add',
          character: {
            name: '苏野',
            status: '正常',
            facts: ['主角', '刑警'],
          },
        },
      ],
      factChanges: [
        {
          kind: 'add',
          fact: '老候车室东墙内存在夹层',
        },
      ],
      foreshadowChanges: [
        {
          kind: 'open',
          foreshadow: {
            description: '调度令时间有刮改痕迹',
          },
        },
      ],
      timelineEvents: [
        {
          event: '1998年12月15日上午08:07，到达候车室',
        },
      ],
    };

    const delta = parseDelta(raw, revId);
    assert.equal(delta.summary, '苏野进入老候车室，发现东墙有异常');
    assert.equal(delta.characterChanges.length, 1);
    const addedChar = delta.characterChanges[0];
    assert.equal(addedChar.kind, 'add');
    if (addedChar.kind === 'add') {
      assert.equal(addedChar.character.name, '苏野');
      assert.equal(addedChar.character.status, 'alive'); // '正常' normalized to 'alive'
      assert.deepEqual(addedChar.character.facts, ['主角', '刑警']);
      assert.ok(addedChar.character.id.length > 0);
    }

    assert.equal(delta.factChanges.length, 1);
    assert.equal(delta.factChanges[0].kind, 'add');
    assert.equal(delta.factChanges[0].fact, '老候车室东墙内存在夹层');

    assert.equal(delta.foreshadowChanges.length, 1);
    assert.equal(delta.foreshadowChanges[0].kind, 'open');
    if (delta.foreshadowChanges[0].kind === 'open') {
      assert.equal(delta.foreshadowChanges[0].foreshadow.description, '调度令时间有刮改痕迹');
      assert.ok(delta.foreshadowChanges[0].foreshadow.id.length > 0);
    }

    assert.equal(delta.timelineEvents.length, 1);
    assert.equal(delta.timelineEvents[0].event, '1998年12月15日上午08:07，到达候车室');
  });

  it('parseDelta resolves character name to id in update against baseline', () => {
    const revId = chapterRevisionId('rev-ch2-1');
    const baseline: StoryState = {
      characters: [
        {
          id: characterId('char-suye'),
          name: '苏野',
          status: 'alive',
          facts: ['主角'],
        },
      ],
      facts: [],
      foreshadows: [],
      timeline: [],
      summary: '',
    };

    const raw = {
      summary: '苏野在调查中负伤',
      characterChanges: [
        {
          kind: 'update',
          characterId: '苏野', // model gave name instead of char-suye
          patch: {
            kind: 'set-status',
            status: '负伤', // model gave Chinese status
          },
        },
      ],
      factChanges: [],
      foreshadowChanges: [],
      timelineEvents: [],
    };

    const delta = parseDelta(raw, revId, baseline);
    const update = delta.characterChanges[0];
    assert.equal(update.kind, 'update');
    if (update.kind === 'update') {
      assert.equal(update.characterId, characterId('char-suye'));
      assert.equal(update.patch.kind, 'set-status');
      if (update.patch.kind === 'set-status') {
        assert.equal(update.patch.status, 'injured');
      }
    }
  });
});
