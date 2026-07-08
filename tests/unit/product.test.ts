import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateEvaluation } from '../../src/core/estimate.ts';
import { compareResults, formatCompareTerminal } from '../../src/core/compare.ts';
import { buildRelationGraph } from '../../src/report/charts/relation-graph.ts';
import { sliceHighlightedExcerpt } from '../../src/report/evidence-highlight.ts';
import { generateReport } from '../../src/report/html-generator.ts';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EvaluationResult } from '../../src/types.ts';

function mockResult(overrides: Partial<EvaluationResult> & { id: string; title: string; score: number }): EvaluationResult {
  const dims = {
    storyStructure: { score: overrides.score, analysis: 'a' },
    characterization: { score: 70, analysis: 'b' },
    writingQuality: { score: 70, analysis: 'c' },
    emotionalResonance: { score: 70, analysis: 'd' },
    marketPotential: { score: 60, analysis: 'e' },
  };
  return {
    schemaVersion: '1.1.0',
    novel: { title: overrides.title, author: '作者', totalChapters: 1, wordCount: 1000 },
    overall: { totalScore: overrides.score, grade: 'B' },
    dimensions: dims,
    chapters: [],
    characters: [],
    emotionalCurve: [],
    excerpts: [],
    suggestions: overrides.suggestions ?? [],
    task: {
      id: overrides.id,
      error: null,
      engine: 'bigmodel',
      configSnapshot: {},
      cost: { inputTokens: 0, outputTokens: 0, totalRmb: 0 },
      checkpoint: null,
      sourceWordCount: 1000,
      chapterCount: 1,
      createdAt: '2026-01-01',
      completedAt: '2026-01-02',
    },
  };
}

describe('estimateEvaluation', () => {
  it('章节越多费用与时间越长', () => {
    const small = estimateEvaluation(5);
    const large = estimateEvaluation(80);
    assert.ok(large.costMaxRmb > small.costMaxRmb);
    assert.ok(large.minutesMax >= small.minutesMax);
  });
});

describe('compareResults', () => {
  it('计算五维 delta 与总分变化', () => {
    const base = mockResult({ id: 'a', title: '初稿', score: 70, suggestions: [{ dimension: 'x', content: '建议A' }] });
    const curr = mockResult({
      id: 'b', title: '二稿', score: 76,
      suggestions: [{ dimension: 'x', content: '建议B' }],
    });
    curr.dimensions.storyStructure.score = 76;
    const r = compareResults(base, curr);
    assert.equal(r.overallDelta, 6);
    assert.equal(r.dimensionDeltas.storyStructure.delta, 6);
    assert.ok(r.suggestionsAdded.includes('建议B'));
    assert.ok(r.suggestionsRemoved.includes('建议A'));
  });

  it('终端输出包含维度标签', () => {
    const base = mockResult({ id: 'a', title: 'A', score: 70 });
    const curr = mockResult({ id: 'b', title: 'B', score: 72 });
    const text = formatCompareTerminal(compareResults(base, curr));
    assert.match(text, /故事架构/);
    assert.match(text, /总分变化/);
  });
});

describe('buildRelationGraph', () => {
  it('有足够关系时 hasGraph 为 true', () => {
    const g = buildRelationGraph([
      { name: '甲', role: '主角', relationships: [{ target: '乙', type: '对手', strength: 80 }] },
      { name: '乙', role: '反派', relationships: [{ target: '甲', type: '对手', strength: 80 }] },
    ]);
    assert.equal(g.hasGraph, true);
    assert.equal(g.links.length, 2);
  });

  it('无关系时 hasGraph 为 false', () => {
    const g = buildRelationGraph([{ name: '甲', role: '主角' }]);
    assert.equal(g.hasGraph, false);
  });
});

describe('sliceHighlightedExcerpt', () => {
  it('精确 offset 高亮', () => {
    const content = '前文内容。关键句在这里。后文。';
    const excerpt = {
      text: '关键句在这里',
      dimension: 'writingQuality' as const,
      reason: 'r',
      chapterId: 'ch001',
      offset: 5,
      matchedBy: 'exact' as const,
    };
    const slice = sliceHighlightedExcerpt(content, excerpt);
    assert.equal(slice.highlight, '关键句在这里');
    assert.ok(slice.before.includes('前文'));
  });
});

describe('generateReport', () => {
  it('HTML 含证据面板与核心区块', () => {
    const tmp = resolve('data', 'test-report-tmp');
    mkdirSync(tmp, { recursive: true });
    const result = mockResult({ id: 't1', title: '测试书', score: 75 });
    result.chapters = [{
      id: 'ch001', title: '第一章', content: '这是测试正文内容。',
      wordCount: 10, kind: 'main', summary: 's', emotionalTension: 50,
      keyEvents: ['事件'], characters: ['甲'],
      excerpts: [{ text: '测试正文', dimension: 'writingQuality', reason: 'r', chapterId: 'ch001', offset: 2, matchedBy: 'exact' }],
    }];
    const { htmlPath } = generateReport(result, tmp);
    const html = readFileSync(htmlPath, 'utf-8');
    assert.match(html, /evidence-panel/);
    assert.match(html, /改进建议/);
    assert.match(html, /情绪/);
    assert.match(html, /时间线/);
    rmSync(tmp, { recursive: true, force: true });
  });
});
