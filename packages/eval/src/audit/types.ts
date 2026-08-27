/**
 * 剧情逻辑审计（「推敲器」）类型契约 v1
 *
 * 方法论来源（见 2026-08 调研）：
 *   - 因果网络分析（Trabasso & van den Broek 1985）→ 事件节点 + 四类有向边
 *   - 脚本·计划·目标（Schank & Abelson 1977）→ enabling 边（知识/手段/机会）
 *   - 陪审员故事模型（Pennington & Hastie 1992）→ 合乎世情/罪罚/替代解释探针
 *   - 本格公平规则（Van Dine 1928 / Knox 1929）→ 线索台账与巧合禁令
 *   - LLM plot hole 基准（Finding Flawed Fictions 2025 / ConStory-Bench 2026）→ 错误分类法
 */
import type { TokenUsage } from '../types.ts';

// ─── 边类型（对齐因果网络分析的四类关系）────────────────────────────

export type CausalEdgeType = 'physical' | 'motivational' | 'enabling' | 'temporal';

export const CAUSAL_EDGE_LABELS: Record<CausalEdgeType, string> = {
  physical: '物理因果',
  motivational: '动机',
  enabling: '使能',
  temporal: '时序',
};

/** 参与因果支撑判定的边（时序不算因果支撑） */
export const CAUSAL_EDGE_TYPES: CausalEdgeType[] = ['physical', 'motivational', 'enabling'];

// ─── 11 类逻辑洞分类法 ─────────────────────────────────────────────

export type LogicHoleType =
  | 'causal-break'            // 因果断裂：关键事件缺前置，链条跳步
  | 'coincidence-driven'      // 巧合驱动：关键转折依赖「恰好/碰巧」
  | 'orphan-plot'             // 孤悬情节：写了但什么都不影响
  | 'timeline-contradiction'  // 时间线矛盾：同线年份倒错（如「二十年前」vs「十二年前」）
  | 'fact-contradiction'      // 事实矛盾：细节互相打架（重名双人、证据来源两说）
  | 'missing-motive'          // 动机缺失：人物行动无自洽理由
  | 'missing-enablement'      // 使能缺失：知道/拿到/做到某事的前置未交代
  | 'unfair-clue'             // 线索不公：关键证据未前置、取得无代价
  | 'punishment-mismatch'     // 罪罚错配：结局的代价与罪行不匹配
  | 'alternative-explanation' // 替代解释未封堵：存在更省事解释削弱揭示
  | 'hub-dependence';         // 单点依赖：剧情过度悬挂在单一人物/道具上

export const LOGIC_HOLE_LABELS: Record<LogicHoleType, string> = {
  'causal-break': '因果断裂',
  'coincidence-driven': '巧合驱动',
  'orphan-plot': '孤悬情节',
  'timeline-contradiction': '时间线矛盾',
  'fact-contradiction': '事实矛盾',
  'missing-motive': '动机缺失',
  'missing-enablement': '使能缺失',
  'unfair-clue': '线索不公',
  'punishment-mismatch': '罪罚错配',
  'alternative-explanation': '替代解释未封堵',
  'hub-dependence': '单点依赖',
};

export const LOGIC_HOLE_TYPES = Object.keys(LOGIC_HOLE_LABELS) as LogicHoleType[];

export type HoleSeverity = 'P0' | 'P1' | 'P2';
export type HoleFixCost = 'surgical' | 'rewrite';

// ─── 抽取阶段（章级）──────────────────────────────────────────────

export interface AuditEvent {
  /** 章内局部 id（e1, e2…）；全局 id = `${chapterId}:${localId}` */
  localId: string;
  /** 一句话事件（主谓宾，含结果） */
  description: string;
  participants: string[];
  /** 故事线标签：多时间线书按线归类（如「1998线」/「2010线」），单线书「主线」 */
  storyline: string;
  /** 文本能断定的绝对年份数字；断不出为 null */
  yearHint: number | null;
  /** 原文时间短语（「十二年前」「2010年3月」…） */
  timeMarker: string;
  location: string;
  /** 事件成立是否依赖偶然（恰好/碰巧/刚好） */
  isCoincidence: boolean;
  /** 是否为获得/发现/交出关键证据的事件 */
  isEvidence: boolean;
  /** 逐字摘自原文 10-80 字 */
  quote: string;
}

export interface AuditEdgeSpec {
  fromLocalId: string;
  toLocalId: string;
  type: CausalEdgeType;
  explanation: string;
}

export interface ChapterExtraction {
  events: AuditEvent[];
  edges: AuditEdgeSpec[];
  characters: string[];
}

// ─── 建链阶段（全局，LLM 补跨章边）─────────────────────────────────

export interface CrossEdge {
  fromGlobalId: string;
  toGlobalId: string;
  type: CausalEdgeType;
  explanation: string;
}

export type SuspicionKind = 'missing-antecedent' | 'convenience' | 'unclear';

export interface LinkSuspicion {
  globalEventId: string;
  kind: SuspicionKind;
  note: string;
}

export interface LinkResult {
  edges: CrossEdge[];
  suspicions: LinkSuspicion[];
}

// ─── 全局图（纯数据，供确定性分析）────────────────────────────────

export interface GraphNode {
  globalId: string;
  chapterId: string;
  chapterIndex: number;
  event: AuditEvent;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: CausalEdgeType;
  explanation: string;
  /** intra=章内抽取，cross=建链阶段补 */
  origin: 'intra' | 'cross';
}

export interface GraphAnalysisOptions {
  /** 高潮章（1-based 章号）；缺省 = 最后一章 */
  climaxChapterIndex?: number;
}

export interface TimelineConflict {
  storyline: string;
  earlier: GraphNode;
  later: GraphNode;
}

export interface HubReport {
  character: string;
  /** 该人物参与的主链事件占比 0-1 */
  share: number;
  mainEvents: number;
}

export interface GraphAnalysisResult {
  /** 反向可达高潮的事件全集（含高潮本身） */
  mainChain: Set<string>;
  /** 高潮章事件 id 集 */
  climaxNodeIds: Set<string>;
  /** 出度为 0 且不在主链 → 写了但不影响任何后续 */
  orphans: GraphNode[];
  /** 关键事件（高潮章或后半书证据事件）无非时序前置边 */
  chainBreaks: GraphNode[];
  /** 同故事线内年份随章序倒错 */
  timelineConflicts: TimelineConflict[];
  /** 落在主链上的巧合事件 */
  coincidenceEvents: GraphNode[];
  hubReport: HubReport | null;
}

// ─── 探针阶段（公平清单 / 合乎世情）───────────────────────────────

export interface ClueLedgerItem {
  name: string;
  plantedAt: string;
  retrievedAt: string;
  costPaid: string;
  fair: boolean;
  note: string;
}

export interface FairPlayResult {
  clues: ClueLedgerItem[];
  antagonistFirstMention: string | null;
  antagonistFirstMeaningfulRole: string | null;
  coincidenceAudit: { count: number; note: string };
  holes: ProbeHole[];
}

export interface ReaderQuestionProbe {
  eventRef: string;
  readerQuestion: string;
  answered: boolean;
  whereNote: string;
}

export interface PlausibilityResult {
  probes: ReaderQuestionProbe[];
  endingCheck: {
    punishmentFits: boolean;
    note: string;
    alternativeExplanation: string | null;
  };
  holes: ProbeHole[];
}

// ─── 逻辑洞（各阶段统一形态）──────────────────────────────────────

/** LLM 探针/红队产出的洞（无 id/source，聚合时补齐） */
export interface ProbeHole {
  type: LogicHoleType;
  severity: HoleSeverity;
  title: string;
  detail: string;
  evidenceChapterIds: string[];
  evidenceQuote: string;
  suggestedFix: string;
  fixCost: HoleFixCost;
}

export interface LogicHole extends ProbeHole {
  id: string;
  source: 'graph' | 'link' | 'fairplay' | 'plausibility' | 'redteam';
  evidence: Array<{ chapterId: string; quote: string; note?: string }>;
}

// ─── 最终报告 ─────────────────────────────────────────────────────

export interface PlotAuditReport {
  schemaVersion: '1.0.0';
  novel: {
    title: string;
    totalChapters: number;
    wordCount: number;
    genre?: string;
    storylines: string[];
  };
  graphStats: {
    events: number;
    edges: number;
    edgesByType: Record<CausalEdgeType, number>;
    mainChainEvents: number;
    orphanEventIds: string[];
  };
  holes: LogicHole[];
  summary: {
    p0: number;
    p1: number;
    p2: number;
    byType: Partial<Record<LogicHoleType, number>>;
  };
  coverage: {
    extractedChapters: number;
    totalChapters: number;
    failedChapterIds: string[];
    droppedTitlePage: boolean;
  };
  usage: TokenUsage;
  task: {
    id: string;
    engine: string;
    climaxChapter: number;
    cost: { inputTokens: number; outputTokens: number; totalRmb: number };
    createdAt: string;
    completedAt: string;
  };
}
