/**
 * 剧情逻辑审计主流程（「推敲器」）
 *
 * 编排：切章(去标题页) → 抽取(章级,5并发) → 建链(全局) → 图分析(纯TS)
 *       → 探针(公平清单 ‖ 世情探针) → 红队(对抗) → 聚合去重 → audit.json
 */
import { randomUUID } from 'node:crypto';
import { createEngine, type AIAgentAdapter } from '@novel-eval/shared';
import { splitChaptersWithMeta, parseTxt, countChars } from '@novel-eval/shared';
import type { ChapterInput } from '@novel-eval/shared';
import { zeroUsage } from '@novel-eval/shared';
import { loadConfig } from '../config.ts';
import type { TokenUsage } from '../types.ts';
import { runExtractPhase } from './extract-phase.ts';
import { runLinkPhase } from './link-phase.ts';
import { analyzeGraph, graphStats } from './graph-analysis.ts';
import { runProbePhase, runRedTeam } from './probe-phase.ts';
import { aggregateHoles, holesFromGraph, holesFromSuspicions } from './aggregate.ts';
import type { GraphEdge, GraphNode, PlotAuditReport, ProbeHole } from './types.ts';
import { CAUSAL_EDGE_LABELS } from './types.ts';

export interface AuditOptions {
  filePath: string;
  title?: string;
  genre?: string;
  /** 高潮章（1-based 章号）；缺省取最后一章 */
  climaxChapter?: number;
  onProgress?: (msg: string) => void;
  /** 注入引擎（测试用）；缺省 createEngine(loadConfig().engine) */
  engine?: AIAgentAdapter;
  /** 红队引擎；缺省复用主引擎。AUDIT_REDTEAM_MODEL 环境变量可指定不同模型 */
  redteamEngine?: AIAgentAdapter;
}

export interface AuditOutcome {
  report: PlotAuditReport;
}

function addUsageInto(total: TokenUsage, add: TokenUsage): void {
  total.inputTokens += add.inputTokens;
  total.outputTokens += add.outputTokens;
  total.costRmb += add.costRmb;
  total.durationMs += add.durationMs;
  if (add.model) total.model = add.model;
}

/**
 * 碎片段防护：导出 md 常见双层标题（`## 第N章（字数）`元信息头 + `# 第N章`正文章头），
 * 切分器会把两行都识别为章头，产出只有一行字的碎片段（抽取必失败）。
 * 丢弃字数 <300 的切分单元；这也是全书评 slice 0 = 书名页误报的源头。
 */
function dropFragments(chapters: ChapterInput[]): {
  chapters: ChapterInput[];
  droppedTitles: string[];
} {
  const MIN_CHAPTER_CHARS = 300;
  const kept = chapters.filter((c) => countChars(c.content) >= MIN_CHAPTER_CHARS);
  const droppedTitles = chapters
    .filter((c) => countChars(c.content) < MIN_CHAPTER_CHARS)
    .map((c) => c.title);
  if (kept.length === 0) return { chapters, droppedTitles: [] };
  // 重编号：过滤后 ch001..chNN 与正文第 1..N 章对齐（原 id 带空洞会误导报告）
  const renumbered = kept.map((c, i) => ({ ...c, id: `ch${String(i + 1).padStart(3, '0')}` }));
  return { chapters: renumbered, droppedTitles };
}

export async function auditPlot(opts: AuditOptions): Promise<AuditOutcome> {
  const config = loadConfig('default');
  const engine = opts.engine ?? createEngine(config.engine);

  // 红队引擎：AUDIT_REDTEAM_MODEL 指定时构造不同模型实例（多模型交叉位，暂默认同引擎换角色）
  let redteamEngine = opts.redteamEngine ?? engine;
  const redteamModel = process.env.AUDIT_REDTEAM_MODEL?.trim();
  if (!opts.redteamEngine && redteamModel) {
    try {
      redteamEngine = createEngine({ ...config.engine, model: redteamModel });
    } catch {
      opts.onProgress?.(`红队模型 ${redteamModel} 不可用，回退主引擎`);
    }
  }

  const taskId = randomUUID();
  const createdAt = new Date();
  const usage: TokenUsage = { ...zeroUsage };

  opts.onProgress?.('解析文档...');
  const doc = parseTxt(opts.filePath);
  const wordCount = countChars(doc.text);

  opts.onProgress?.('分章...');
  const heuristic = splitChaptersWithMeta(doc.text);
  const { chapters, droppedTitles } = dropFragments(heuristic.chapters);
  if (droppedTitles.length) {
    opts.onProgress?.(`剔除 ${droppedTitles.length} 个碎片段（书名页/双层标题元信息）——章号已对齐正文`);
  }
  opts.onProgress?.(`识别到 ${chapters.length} 章`);

  // ── 1. 抽取 ──
  opts.onProgress?.(`抽取阶段：逐章抽事件-因果图（${chapters.length} 章，5 并发）...`);
  const extract = await runExtractPhase(engine, chapters, (done, total, chId, status) => {
    opts.onProgress?.(`抽取 [${done}/${total}] ${chId} ${status}`);
  });
  addUsageInto(usage, extract.usage);
  if (extract.extractions.size === 0) {
    throw new Error('全部章节抽取失败，无法审计');
  }
  if (extract.failedChapterIds.length) {
    opts.onProgress?.(`⚠ ${extract.failedChapterIds.length} 章抽取失败，图中缺这些章的事件`);
  }

  // ── 全局图装配 ──
  const nodes: GraphNode[] = [];
  const intraEdges: GraphEdge[] = [];
  const chapterIndexById = new Map(chapters.map((c, i) => [c.id, i + 1]));
  for (const chapter of chapters) {
    const ext = extract.extractions.get(chapter.id);
    if (!ext) continue;
    const chapterIndex = chapterIndexById.get(chapter.id) ?? 0;
    for (const ev of ext.events) {
      nodes.push({
        globalId: `${chapter.id}:${ev.localId}`,
        chapterId: chapter.id,
        chapterIndex,
        event: ev,
      });
    }
    for (const e of ext.edges) {
      intraEdges.push({
        from: `${chapter.id}:${e.fromLocalId}`,
        to: `${chapter.id}:${e.toLocalId}`,
        type: e.type,
        explanation: e.explanation,
        origin: 'intra',
      });
    }
  }
  const nodesById = new Map(nodes.map((n) => [n.globalId, n]));
  opts.onProgress?.(`图装配：${nodes.length} 事件 / ${intraEdges.length} 章内边`);

  // ── 2. 建链 ──
  opts.onProgress?.('建链阶段：补跨章边 + 前置嫌疑...');
  const link = await runLinkPhase(engine, nodes);
  addUsageInto(usage, link.usage);
  const edges: GraphEdge[] = [...intraEdges, ...link.edges];
  opts.onProgress?.(`建链完成：+${link.edges.length} 跨章边，${link.suspicions.length} 条前置嫌疑`);

  // ── 3. 图分析（确定性）──
  const climaxChapterIndex = opts.climaxChapter ?? chapters.length;
  const analysis = analyzeGraph(nodes, edges, {
    climaxChapterIndex: Math.min(opts.climaxChapter ?? chapters.length, chapters.length),
  });
  const stats = graphStats(nodes, edges, analysis);
  opts.onProgress?.(
    `图分析：主链 ${stats.mainChainEvents}/${stats.events} 事件，孤悬 ${analysis.orphans.length}，`
    + `断链 ${analysis.chainBreaks.length}，时间线冲突 ${analysis.timelineConflicts.length}`,
  );

  // ── 4. 探针（公平清单 ‖ 世情）──
  opts.onProgress?.('探针阶段：公平清单 ‖ 世情探针...');
  const probe = await runProbePhase(engine, {
    nodes,
    mainChainIds: analysis.mainChain,
    climaxChapterIndex,
    genre: opts.genre,
  });
  addUsageInto(usage, probe.usage);
  for (const f of probe.failures) opts.onProgress?.(`⚠ ${f}`);

  // ── 5. 红队（对抗式，吃图+探针结果）──
  const graphHoles = holesFromGraph(analysis, nodesById);
  const linkHoles = holesFromSuspicions(link.suspicions, nodesById);
  const preRedTeam: ProbeHole[] = [
    ...graphHoles,
    ...linkHoles,
    ...(probe.fairplay?.holes ?? []),
    ...(probe.plausibility?.holes ?? []),
  ];
  const graphSummary = [
    `事件 ${stats.events}，边 ${stats.edges}（${Object.entries(stats.edgesByType).map(([k, v]) => `${CAUSAL_EDGE_LABELS[k as keyof typeof CAUSAL_EDGE_LABELS]} ${v}`).join(' / ')}）`,
    `主因果链 ${stats.mainChainEvents} 事件；孤悬 ${analysis.orphans.length}；断链 ${analysis.chainBreaks.length}；时间线冲突 ${analysis.timelineConflicts.length}；主链巧合 ${analysis.coincidenceEvents.length}`,
    `故事线：${[...new Set(nodes.map((n) => n.event.storyline))].join('、')}`,
  ].join('\n');

  opts.onProgress?.('红队阶段：对抗式找茬...');
  const redteam = await runRedTeam(redteamEngine, {
    nodes,
    graphSummary,
    foundHoles: preRedTeam,
    genre: opts.genre,
  });
  addUsageInto(usage, redteam.usage);
  if (!redteam.ok) opts.onProgress?.('⚠ 红队调用失败（非致命）');

  // ── 6. 聚合 ──
  const holes = aggregateHoles(
    graphHoles,
    linkHoles,
    probe.fairplay?.holes ?? [],
    probe.plausibility?.holes ?? [],
    redteam.holes,
  );
  const byType: Partial<Record<string, number>> = {};
  for (const h of holes) byType[h.type] = (byType[h.type] ?? 0) + 1;
  const storylines = [...new Set(nodes.map((n) => n.event.storyline))];

  const report: PlotAuditReport = {
    schemaVersion: '1.0.0',
    novel: {
      title: opts.title ?? doc.title ?? opts.filePath.split('/').pop() ?? '未命名',
      totalChapters: chapters.length,
      wordCount,
      genre: opts.genre,
      storylines,
    },
    graphStats: stats,
    holes,
    summary: {
      p0: holes.filter((h) => h.severity === 'P0').length,
      p1: holes.filter((h) => h.severity === 'P1').length,
      p2: holes.filter((h) => h.severity === 'P2').length,
      byType,
    },
    coverage: {
      extractedChapters: extract.extractions.size,
      totalChapters: chapters.length,
      failedChapterIds: extract.failedChapterIds,
      droppedTitlePage: droppedTitles.length > 0,
    },
    usage,
    task: {
      id: taskId,
      engine: engine.name,
      climaxChapter: climaxChapterIndex,
      cost: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalRmb: usage.costRmb,
      },
      createdAt: createdAt.toISOString(),
      completedAt: new Date().toISOString(),
    },
  };

  opts.onProgress?.(
    `✓ 审计完成：P0 ×${report.summary.p0} P1 ×${report.summary.p1} P2 ×${report.summary.p2}，费用 ¥${usage.costRmb.toFixed(4)}`,
  );

  return { report };
}
