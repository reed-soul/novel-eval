/**
 * Missing delta arrays from LLM must not crash publish after schema "ok".
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validate } from '@novel-eval/shared';

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
});
