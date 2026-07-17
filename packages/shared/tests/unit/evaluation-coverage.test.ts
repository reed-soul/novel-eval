/**
 * Unit tests for Stage C2 evaluation coverage gates.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVALUATION_DIMENSION_KEYS,
  evaluationCoverageFor,
  isExcerptLinked,
  type EvaluationDimensionDto,
  type EvaluationExcerptDto,
} from '../../src/dto/evaluation.ts';

function dims(keys: readonly string[] = EVALUATION_DIMENSION_KEYS): Record<string, EvaluationDimensionDto> {
  return Object.fromEntries(keys.map((k, i) => [k, { score: 70 + i, analysis: k }]));
}

function excerpt(
  partial: Partial<EvaluationExcerptDto> & Pick<EvaluationExcerptDto, 'matchedBy'>,
): EvaluationExcerptDto {
  return {
    text: '证据',
    dimension: 'writingQuality',
    reason: 'test',
    chapterId: 'ch001',
    ...partial,
  };
}

describe('isExcerptLinked', () => {
  it('treats exact/fuzzy as linked and none as unlinked', () => {
    assert.equal(isExcerptLinked(excerpt({ matchedBy: 'exact', offset: 1 })), true);
    assert.equal(isExcerptLinked(excerpt({ matchedBy: 'fuzzy', offset: 1 })), true);
    assert.equal(isExcerptLinked(excerpt({ matchedBy: 'none', offset: null })), false);
  });
});

describe('evaluationCoverageFor', () => {
  it('is complete for full dimensions and strong link rate', () => {
    const coverage = evaluationCoverageFor({
      dimensions: dims(),
      excerpts: [
        excerpt({ matchedBy: 'exact', offset: 0 }),
        excerpt({ matchedBy: 'fuzzy', offset: 10 }),
      ],
      task: { chapterCount: 2 },
      skippedChapterIds: [],
    });
    assert.equal(coverage.complete, true);
    assert.equal(coverage.evidenceLinkRate, 1);
    assert.deepEqual(coverage.incompleteReasons, []);
  });

  it('flags missing dimensions', () => {
    const coverage = evaluationCoverageFor({
      dimensions: dims(EVALUATION_DIMENSION_KEYS.slice(0, 5)),
      excerpts: [excerpt({ matchedBy: 'exact', offset: 0 })],
      task: { chapterCount: 1 },
    });
    assert.equal(coverage.complete, false);
    assert.ok(coverage.incompleteReasons?.some((r) => r.includes('missing dimensions')));
  });

  it('flags low evidence link rate', () => {
    const coverage = evaluationCoverageFor({
      dimensions: dims(),
      excerpts: [
        excerpt({ matchedBy: 'exact', offset: 0 }),
        excerpt({ matchedBy: 'none', offset: null }),
        excerpt({ matchedBy: 'none', offset: null }),
        excerpt({ matchedBy: 'none', offset: null }),
      ],
      task: { chapterCount: 2 },
    });
    assert.equal(coverage.complete, false);
    assert.ok(coverage.evidenceLinkRate !== undefined && coverage.evidenceLinkRate < 0.5);
    assert.ok(coverage.incompleteReasons?.some((r) => r.includes('evidence link rate')));
  });

  it('flags high chapter skip rate', () => {
    const coverage = evaluationCoverageFor({
      dimensions: dims(),
      excerpts: [excerpt({ matchedBy: 'exact', offset: 0 })],
      task: { chapterCount: 10 },
      skippedChapterIds: ['ch001', 'ch002', 'ch003', 'ch004'],
    });
    assert.equal(coverage.complete, false);
    assert.equal(coverage.chapterSkipRate, 0.4);
    assert.ok(coverage.incompleteReasons?.some((r) => r.includes('chapter skip rate')));
  });

  it('flags zero excerpts when chapters exist', () => {
    const coverage = evaluationCoverageFor({
      dimensions: dims(),
      excerpts: [],
      task: { chapterCount: 3 },
    });
    assert.equal(coverage.complete, false);
    assert.ok(coverage.incompleteReasons?.some((r) => r.includes('no evidence excerpts')));
  });
});
