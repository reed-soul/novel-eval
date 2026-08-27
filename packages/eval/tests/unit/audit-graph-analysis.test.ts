/**
 * Unit tests for audit graph-analysis (纯 TS 图算法).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGraph, graphStats, resolveClimaxIndex } from '../../src/audit/graph-analysis.ts';
import type { GraphEdge, GraphNode } from '../../src/audit/types.ts';

let eventSeq = 0;
function node(chapterIndex: number, overrides: Partial<GraphNode['event']> = {}): GraphNode {
  const id = `ch${String(chapterIndex).padStart(3, '0')}:e${++eventSeq}`;
  return {
    globalId: id,
    chapterId: `ch${String(chapterIndex).padStart(3, '0')}`,
    chapterIndex,
    event: {
      localId: id.split(':')[1],
      description: `事件${eventSeq}`,
      participants: [],
      storyline: '主线',
      yearHint: null,
      timeMarker: '',
      location: '',
      isCoincidence: false,
      isEvidence: false,
      quote: `事件${eventSeq}原文`,
      ...overrides,
    },
  };
}

function edge(from: GraphNode, to: GraphNode, type: GraphEdge['type'] = 'physical'): GraphEdge {
  return { from: from.globalId, to: to.globalId, type, explanation: 'test', origin: 'intra' };
}

describe('resolveClimaxIndex', () => {
  it('缺省取最后一个有事件的章', () => {
    const nodes = [node(1), node(2), node(5)];
    assert.equal(resolveClimaxIndex(nodes), 5);
  });

  it('显式指定且该章有事件时用指定值', () => {
    const nodes = [node(1), node(2), node(3), node(4)];
    assert.equal(resolveClimaxIndex(nodes, 3), 3);
  });

  it('显式指定但该章无事件时回退最后一章', () => {
    const nodes = [node(1), node(2)];
    assert.equal(resolveClimaxIndex(nodes, 9), 2);
  });
});

describe('analyzeGraph 主链与孤悬', () => {
  it('不可达高潮且零出度的事件是孤悬', () => {
    const a = node(1);
    const b = node(1);
    const climax = node(2);
    const edges = [edge(a, climax, 'motivational')];
    const result = analyzeGraph([a, b, climax], edges, { climaxChapterIndex: 2 });

    assert.ok(result.mainChain.has(a.globalId));
    assert.ok(result.mainChain.has(climax.globalId));
    assert.ok(!result.mainChain.has(b.globalId));
    assert.equal(result.orphans.length, 1);
    assert.equal(result.orphans[0].globalId, b.globalId);
  });

  it('有出边但不通向高潮的事件不算孤悬（可能是抽取噪声）', () => {
    const a = node(1);
    const b = node(1);
    const c = node(2); // b 指向 c，c 零出度且不通向高潮 → c 是孤悬，b 不是
    const climax = node(3);
    const nodes = [a, b, c, climax];
    const edges = [
      edge(a, climax, 'physical'),
      edge(b, c, 'enabling'),
    ];
    const result = analyzeGraph(nodes, edges, { climaxChapterIndex: 3 });
    const orphanIds = result.orphans.map((n) => n.globalId);
    assert.ok(!orphanIds.includes(b.globalId));
    assert.ok(orphanIds.includes(c.globalId));
  });
});

describe('analyzeGraph 断链', () => {
  it('高潮事件只有时序入边 → 断链', () => {
    const a = node(1);
    const climax = node(2);
    const edges = [edge(a, climax, 'temporal')];
    const result = analyzeGraph([a, climax], edges, { climaxChapterIndex: 2 });
    assert.equal(result.chainBreaks.length, 1);
    assert.equal(result.chainBreaks[0].globalId, climax.globalId);
  });

  it('有使能入边的高潮事件不断链', () => {
    const a = node(1);
    const climax = node(2);
    const edges = [edge(a, climax, 'enabling')];
    const result = analyzeGraph([a, climax], edges, { climaxChapterIndex: 2 });
    assert.equal(result.chainBreaks.length, 0);
  });

  it('后半书的证据事件无前置 → 断链；有因果前置的高潮事件不误报', () => {
    const early = node(1);
    const midEvidence = node(2, { isEvidence: true });
    const climax = node(4);
    const edges = [edge(early, climax, 'physical')]; // climax 有物理前置，不应误报
    const result = analyzeGraph([early, midEvidence, climax], edges, { climaxChapterIndex: 4 });
    assert.ok(result.chainBreaks.some((n) => n.globalId === midEvidence.globalId));
    assert.ok(!result.chainBreaks.some((n) => n.globalId === climax.globalId));
  });
});

describe('analyzeGraph 时间线矛盾', () => {
  it('同线年份随章序倒错被检出', () => {
    const n1 = node(1, { storyline: '2010线', yearHint: 2010, timeMarker: '2010年' });
    const n2 = node(3, { storyline: '2010线', yearHint: 1998, timeMarker: '十二年前' });
    const climax = node(4);
    const edges = [edge(n1, n2, 'physical'), edge(n2, climax, 'physical')];
    const result = analyzeGraph([n1, n2, climax], edges, { climaxChapterIndex: 4 });
    assert.equal(result.timelineConflicts.length, 1);
    assert.equal(result.timelineConflicts[0].storyline, '2010线');
  });

  it('双线各自递增不误报', () => {
    const a1 = node(1, { storyline: '1998线', yearHint: 1998 });
    const b1 = node(2, { storyline: '2010线', yearHint: 2010 });
    const a2 = node(3, { storyline: '1998线', yearHint: 1999 });
    const climax = node(4);
    const edges = [
      edge(a1, a2, 'physical'), edge(b1, climax, 'physical'), edge(a2, climax, 'physical'),
    ];
    const result = analyzeGraph([a1, b1, a2, climax], edges, { climaxChapterIndex: 4 });
    assert.equal(result.timelineConflicts.length, 0);
  });
});

describe('analyzeGraph 巧合与枢纽', () => {
  it('主链上的巧合被收集，主链外的不算', () => {
    const coinOn = node(1, { isCoincidence: true });
    const coinOff = node(1, { isCoincidence: true });
    const climax = node(2);
    const edges = [edge(coinOn, climax, 'physical')];
    const result = analyzeGraph([coinOn, coinOff, climax], edges, { climaxChapterIndex: 2 });
    const ids = result.coincidenceEvents.map((n) => n.globalId);
    assert.ok(ids.includes(coinOn.globalId));
    assert.ok(!ids.includes(coinOff.globalId));
  });

  it('单人物参与主链 >60% 且人物 ≥4 → 枢纽报告', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(node(1, { participants: i < 7 ? ['苏野'] : ['甲', '乙', '丙'] }));
    }
    const climax = node(2, { participants: ['苏野'] });
    nodes.push(climax);
    const edges = nodes.filter((n) => n !== climax).map((n) => edge(n, climax, 'physical'));
    const result = analyzeGraph(nodes, edges, { climaxChapterIndex: 2 });
    assert.ok(result.hubReport);
    assert.equal(result.hubReport!.character, '苏野');
    assert.ok(result.hubReport!.share > 0.6);
  });
});

describe('graphStats', () => {
  it('边分类计数与孤悬 id 输出', () => {
    const a = node(1);
    const orphan = node(1);
    const climax = node(2);
    const edges = [
      edge(a, climax, 'physical'),
      edge(a, climax, 'temporal'),
    ];
    const analysis = analyzeGraph([a, orphan, climax], edges, { climaxChapterIndex: 2 });
    const stats = graphStats([a, orphan, climax], edges, analysis);
    assert.equal(stats.events, 3);
    assert.equal(stats.edges, 2);
    assert.equal(stats.edgesByType.physical, 1);
    assert.equal(stats.edgesByType.temporal, 1);
    assert.deepEqual(stats.orphanEventIds, [orphan.globalId]);
    assert.equal(stats.mainChainEvents, 2);
  });
});
