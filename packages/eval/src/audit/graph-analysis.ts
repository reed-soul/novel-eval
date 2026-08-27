/**
 * Audit 图分析：纯 TypeScript 确定性算法（零 LLM）
 *
 * 对齐因果网络分析（Trabasso）的图度量：
 *   - 主因果链 = 反向可达高潮集的事件（结构相关性）
 *   - 孤悬事件 = 出度 0 且不在主链（写了但不影响任何后续）
 *   - 断链点   = 关键事件无非时序前置边（因果支撑缺失）
 *   - 时间线矛盾 = 同故事线内绝对年份随章序倒错
 *   - 巧合/枢纽 = 主链上的巧合事件计数 / 单人物参与占比
 */
import type {
  CausalEdgeType,
  GraphAnalysisOptions,
  GraphAnalysisResult,
  GraphEdge,
  GraphNode,
  TimelineConflict,
} from './types.ts';

const CAUSAL_TYPES = new Set<CausalEdgeType>(['physical', 'motivational', 'enabling']);

/** 高潮判定：显式指定的章，缺省取最后一个有事件的章 */
export function resolveClimaxIndex(nodes: GraphNode[], climaxChapterIndex?: number): number {
  if (climaxChapterIndex !== undefined) {
    const inChapter = nodes.filter((n) => n.chapterIndex === climaxChapterIndex);
    if (inChapter.length > 0) return climaxChapterIndex;
  }
  let last = 0;
  for (const n of nodes) if (n.chapterIndex > last) last = n.chapterIndex;
  return last;
}

/** 反向可达：从种子集沿入边（任意类型）能回到的全部节点（含种子） */
function backwardReachable(seedIds: Set<string>, edges: GraphEdge[]): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const list = incoming.get(e.to) ?? [];
    list.push(e.from);
    incoming.set(e.to, list);
  }
  const seen = new Set<string>(seedIds);
  const queue = [...seedIds];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const prev of incoming.get(cur) ?? []) {
      if (!seen.has(prev)) {
        seen.add(prev);
        queue.push(prev);
      }
    }
  }
  return seen;
}

function hasCausalAntecedent(id: string, edges: GraphEdge[]): boolean {
  return edges.some((e) => e.to === id && CAUSAL_TYPES.has(e.type));
}

export function analyzeGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: GraphAnalysisOptions = {},
): GraphAnalysisResult {
  const climaxIndex = resolveClimaxIndex(nodes, opts.climaxChapterIndex);
  const climaxNodeIds = new Set(
    nodes.filter((n) => n.chapterIndex === climaxIndex).map((n) => n.globalId),
  );

  const mainChain = backwardReachable(climaxNodeIds, edges);

  // ── 孤悬：出度 0 且不在主链（首章设定事件若真有作用，应有出边或入主链）──
  const outDegree = new Map<string, number>();
  for (const e of edges) outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
  const orphans = nodes.filter(
    (n) => (outDegree.get(n.globalId) ?? 0) === 0 && !climaxNodeIds.has(n.globalId),
  );

  // ── 断链：关键事件（高潮章 or 后半书的证据事件）无非时序前置边 ──
  const midChapter = Math.floor(nodes.length ? (climaxIndex + nodes[0].chapterIndex) / 2 : 0);
  const chainBreaks = nodes.filter((n) => {
    const isKey = climaxNodeIds.has(n.globalId)
      || (n.event.isEvidence && n.chapterIndex >= midChapter);
    return isKey && !hasCausalAntecedent(n.globalId, edges);
  });

  // ── 时间线：同故事线内，绝对年份随章序非递减；倒错即矛盾 ──
  const timelineConflicts: TimelineConflict[] = [];
  const byStoryline = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const list = byStoryline.get(n.event.storyline) ?? [];
    list.push(n);
    byStoryline.set(n.event.storyline, list);
  }
  for (const [, group] of byStoryline) {
    group.sort((a, b) => a.chapterIndex - b.chapterIndex || a.globalId.localeCompare(b.globalId));
    let high: GraphNode | null = null;
    for (const n of group) {
      const y = n.event.yearHint;
      if (y === null || y === undefined) continue;
      if (high && high.event.yearHint !== null && y < high.event.yearHint) {
        timelineConflicts.push({ storyline: n.event.storyline, earlier: high, later: n });
      } else {
        high = n;
      }
    }
  }

  // ── 巧合：落在主链上的巧合事件 ──
  const coincidenceEvents = nodes.filter(
    (n) => n.event.isCoincidence && mainChain.has(n.globalId),
  );

  // ── 枢纽：单人物参与主链事件的占比 ──
  let hubReport: GraphAnalysisResult['hubReport'] = null;
  const mainNodes = nodes.filter((n) => mainChain.has(n.globalId));
  if (mainNodes.length >= 10) {
    const allCharacters = new Set<string>();
    const participation = new Map<string, number>();
    for (const n of mainNodes) {
      for (const p of n.event.participants) {
        allCharacters.add(p);
        participation.set(p, (participation.get(p) ?? 0) + 1);
      }
    }
    if (allCharacters.size >= 4) {
      let topChar = '';
      let topCount = 0;
      for (const [c, count] of participation) {
        if (count > topCount) { topChar = c; topCount = count; }
      }
      const share = topCount / mainNodes.length;
      if (topChar && share > 0.6) {
        hubReport = { character: topChar, share, mainEvents: topCount };
      }
    }
  }

  return {
    mainChain,
    climaxNodeIds,
    orphans,
    chainBreaks,
    timelineConflicts,
    coincidenceEvents,
    hubReport,
  };
}

// ─── 图 → 报告统计 ─────────────────────────────────────────────────

export function graphStats(
  nodes: GraphNode[],
  edges: GraphEdge[],
  analysis: GraphAnalysisResult,
): {
  events: number;
  edges: number;
  edgesByType: Record<CausalEdgeType, number>;
  mainChainEvents: number;
  orphanEventIds: string[];
} {
  const edgesByType: Record<CausalEdgeType, number> = {
    physical: 0, motivational: 0, enabling: 0, temporal: 0,
  };
  for (const e of edges) edgesByType[e.type] += 1;
  return {
    events: nodes.length,
    edges: edges.length,
    edgesByType,
    mainChainEvents: analysis.mainChain.size,
    orphanEventIds: analysis.orphans.map((n) => n.globalId),
  };
}
