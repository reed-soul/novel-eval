/**
 * platformGate 必须在 toEvaluationReportResponse DTO 往返中存活
 * （web 落盘 JSON → GET /result 再解析，字段被剥掉则报告页看不到投稿门）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toEvaluationReportResponse,
  type EvaluationReportResponse,
} from '../../src/dto/evaluation.ts';

function minimalReport(): Record<string, unknown> {
  const dims: Record<string, { score: number; analysis: string }> = {};
  for (const key of [
    'storyStructure', 'characterization', 'writingQuality', 'emotionalResonance',
    'marketPotential', 'thematicDepth', 'originality', 'pacingRetention',
  ]) {
    dims[key] = { score: 80, analysis: 'x'.repeat(20) };
  }
  return {
    novel: { title: 't', author: 'a', totalChapters: 1, wordCount: 100 },
    overall: { totalScore: 80, grade: 'A' },
    dimensions: dims,
    characters: [],
    emotionalCurve: [],
    suggestions: [],
    excerpts: [],
  };
}

describe('platformGate DTO round-trip', () => {
  it('platformGate 完整保留（block 场景）', () => {
    const raw = minimalReport();
    raw.platformGate = {
      platform: 'fanqie',
      displayName: '番茄小说',
      verdict: 'block',
      checks: [
        { dimension: 'marketPotential', min: 80, actual: 72, passed: false },
        { dimension: 'pacingRetention', min: 80, actual: 85, passed: true },
      ],
      reasons: ['marketPotential 72 分低于 番茄小说 投稿红线 80'],
      lowestDimension: { dimension: 'marketPotential', score: 72 },
    };

    const round1 = toEvaluationReportResponse(raw);
    // 模拟落盘→再读
    const round2 = toEvaluationReportResponse(JSON.parse(JSON.stringify(round1)));

    for (const report of [round1, round2] as EvaluationReportResponse[]) {
      assert.equal(report.platformGate?.platform, 'fanqie');
      assert.equal(report.platformGate?.verdict, 'block');
      assert.equal(report.platformGate?.checks.length, 2);
      assert.equal(report.platformGate?.checks[0]?.passed, false);
      assert.equal(report.platformGate?.reasons[0], 'marketPotential 72 分低于 番茄小说 投稿红线 80');
      assert.equal(report.platformGate?.lowestDimension?.dimension, 'marketPotential');
    }
  });

  it('platformGate 缺失/null 时报告仍可解析且字段为空', () => {
    const without = toEvaluationReportResponse(minimalReport());
    assert.equal(without.platformGate, undefined);

    const nulled = toEvaluationReportResponse({ ...minimalReport(), platformGate: null });
    assert.equal(nulled.platformGate, null);
  });

  it('畸形 platformGate 归一为 null 而不是报错（对齐 marketBenchmark 行为）', () => {
    const broken = toEvaluationReportResponse({
      ...minimalReport(),
      platformGate: { platform: 123 },
    });
    assert.equal(broken.platformGate, null);
  });
});
