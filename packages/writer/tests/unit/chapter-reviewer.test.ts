/**
 * ChapterReviewerService unit tests — verdict mapping with injected assess.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AIAgentAdapter, TokenUsage } from '@novel-eval/shared';
import { zeroUsage } from '@novel-eval/shared';

import {
  ChapterReviewerService,
  mapQualityVerdict,
} from '../../src/services/chapter-reviewer-service.ts';
import type { QualityGateResult } from '../../src/chapter/quality-gate.ts';
import { createTestDb } from '../helpers/test-db.ts';

const usage: TokenUsage = { ...zeroUsage, costRmb: 0.01 };

function fakeEngine(): AIAgentAdapter {
  return {
    name: 'fake',
    async run() {
      return { text: '', usage };
    },
  } as unknown as AIAgentAdapter;
}

const chapter = {
  id: 'rev-1',
  projectId: 'proj-1',
  number: 1,
  outlineId: 'out-1',
  title: '开篇',
  content: '正文内容足够长用于评审。'.repeat(20),
  wordCount: 200,
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
};

describe('mapQualityVerdict', () => {
  it('maps pass/revise/block to accept/revise/reject', () => {
    assert.equal(mapQualityVerdict('pass'), 'accept');
    assert.equal(mapQualityVerdict('revise'), 'revise');
    assert.equal(mapQualityVerdict('block'), 'reject');
  });
});

describe('ChapterReviewerService', () => {
  it('returns accept with evidence from gate result', async () => {
    const db = createTestDb();
    const reviewer = new ChapterReviewerService(db);
    const gate: QualityGateResult & { usage: TokenUsage } = {
      verdict: 'pass',
      reason: '等级 A（88 分），各维度达标',
      reasons: ['等级 A（88 分），各维度达标'],
      score: 88,
      grade: 'A',
      evidence: [
        {
          chapterId: 'rev-1',
          excerptIndex: 0,
          text: '证据句',
          dimension: 'writingQuality',
          reason: '文笔',
          matchedBy: 'exact',
          offset: 1,
        },
      ],
      usage,
    };

    const result = await reviewer.reviewChapter({
      engine: fakeEngine(),
      db,
      projectId: 'proj-1',
      chapter,
      metadata: { genre: '科幻', targetAudience: '青年' },
      assess: async () => gate,
    });

    assert.equal(result.verdict, 'accept');
    assert.equal(result.score, 88);
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].text, '证据句');
  });

  it('returns revise with feedback and reasons', async () => {
    const db = createTestDb();
    const reviewer = new ChapterReviewerService(db);
    const result = await reviewer.reviewChapter({
      engine: fakeEngine(),
      db,
      projectId: 'proj-1',
      chapter,
      metadata: { genre: '科幻', targetAudience: '青年' },
      assess: async () => ({
        verdict: 'revise',
        reason: '总分偏低',
        reasons: ['总分 70 低于 75', '低分维度：文笔质量（60）'],
        score: 70,
        grade: 'B',
        feedback: '【改进建议】\n  - 加强开篇冲突',
        evidence: [],
        usage,
      }),
    });

    assert.equal(result.verdict, 'revise');
    assert.ok(result.feedback?.includes('改进建议'));
    assert.equal(result.reasons.length, 2);
  });

  it('returns reject for block verdict', async () => {
    const db = createTestDb();
    const reviewer = new ChapterReviewerService(db);
    const result = await reviewer.reviewChapter({
      engine: fakeEngine(),
      db,
      projectId: 'proj-1',
      chapter,
      metadata: { genre: '科幻', targetAudience: '青年' },
      assess: async () => ({
        verdict: 'block',
        reason: '等级 D',
        reasons: ['等级 D（40 分）低于 D 线'],
        score: 40,
        grade: 'D',
        evidence: [],
        usage,
      }),
    });

    assert.equal(result.verdict, 'reject');
  });
});
