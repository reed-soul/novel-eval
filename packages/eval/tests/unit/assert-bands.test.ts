/**
 * Unit tests for golden score-band assertions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertScoreBands } from '../../src/golden/assert-bands.ts';
import type { GoldenExpect } from '../../src/golden/types.ts';
import type { DimensionKey, EvaluationResult } from '../../src/types.ts';
import { DIMENSION_KEYS } from '../../src/types.ts';

function fakeResult(scores: Partial<Record<DimensionKey, number>>, overall = 70, grade = 'B') {
  const dimensions = Object.fromEntries(
    DIMENSION_KEYS.map((k) => [
      k,
      { score: scores[k] ?? 70, analysis: '' },
    ]),
  ) as EvaluationResult['dimensions'];
  return {
    overall: { totalScore: overall, grade },
    dimensions,
  };
}

const baseExpect: GoldenExpect = {
  status: 'active',
  overall: { min: 60, max: 90 },
  gradeAllowlist: ['A', 'B', 'C'],
  dimensions: {
    writingQuality: { min: 65, max: 95 },
    marketPotential: { min: null, max: null },
  },
};

describe('assertScoreBands', () => {
  it('passes when scores are inside bands', () => {
    const result = assertScoreBands(
      fakeResult({ writingQuality: 80 }),
      baseExpect,
    );
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(result.violations.length, 0);
  });

  it('fails when a dimension is below min', () => {
    const result = assertScoreBands(
      fakeResult({ writingQuality: 50 }),
      baseExpect,
    );
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.field.includes('writingQuality')));
  });

  it('fails when overall is above max', () => {
    const result = assertScoreBands(
      fakeResult({}, 95, 'A'),
      baseExpect,
    );
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.field === 'overall.totalScore'));
  });

  it('skips pending_annotation unless forceAssert', () => {
    const pending: GoldenExpect = { ...baseExpect, status: 'pending_annotation' };
    const skipped = assertScoreBands(fakeResult({ writingQuality: 10 }), pending);
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);

    const forced = assertScoreBands(fakeResult({ writingQuality: 10 }), pending, {
      forceAssert: true,
    });
    assert.equal(forced.ok, false);
    assert.equal(forced.skipped, false);
  });

  it('ignores null band edges', () => {
    const expect: GoldenExpect = {
      status: 'active',
      overall: { min: null, max: null },
      gradeAllowlist: [],
      dimensions: {
        writingQuality: { min: null, max: null },
      },
    };
    const result = assertScoreBands(fakeResult({ writingQuality: 1 }, 1, 'D'), expect);
    assert.equal(result.ok, true);
  });
});
