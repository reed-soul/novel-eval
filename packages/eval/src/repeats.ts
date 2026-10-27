/**
 * 三局统计化（final-plan P1-3）：--repeats N --require M 的纯统计逻辑。
 *
 * 背景：实测 19 部单引擎评分均值 86.1、σ 2.3——两局之差在噪声内，
 * "三局两胜"人肉判定等价于任取一局。本模块把判定变成显式统计：
 *   单局过门 = 投稿门不 block 且 总分 ≥ minOverall(85) 且 市场分 ≥ minMarket(80)
 *   局数极差 > rangeThreshold(6) 时自动加跑，至上限 maxRuns
 *   最终过门 = passCount ≥ require
 *
 * 纯函数、零 IO——编排（循环调 evaluate）在 CLI 层，便于单测。
 */

export interface RunOutcome {
  runIndex: number;
  engineName: string;
  totalScore: number;
  marketScore: number;
  platformGatePass: boolean;
  taskId: string;
  costRmb: number;
}

export interface RepeatsConfig {
  /** 基准局数（默认 3） */
  repeats: number;
  /** 过门所需局数（默认 floor(repeats/2)+1，即多数） */
  require: number;
  /** 单局总分线（夜跑口径 85） */
  minOverall: number;
  /** 单局市场分线（夜跑口径 80，市场分 <80 一律不得交付） */
  minMarket: number;
  /** 总分/市场分极差超过该值触发加跑（默认 6） */
  rangeThreshold: number;
  /** 加跑后的总局数上限（默认 min(repeats+2, 5)） */
  maxRuns: number;
}

export interface RepeatsSummary {
  runs: RunOutcome[];
  passCount: number;
  require: number;
  /** passCount ≥ require */
  verdictPass: boolean;
  totalRange: number;
  marketRange: number;
  medianOverall: number;
  /** 是否触发过加跑（基准局数后仍有 range 超限） */
  extended: boolean;
  config: RepeatsConfig;
  totalCostRmb: number;
  engineNames: string[];
}

export const DEFAULT_MIN_OVERALL = 85;
export const DEFAULT_MIN_MARKET = 80;
export const DEFAULT_RANGE_THRESHOLD = 6;

export function resolveRepeatsConfig(partial: Partial<RepeatsConfig> = {}): RepeatsConfig {
  const repeats = partial.repeats ?? 3;
  const require = partial.require ?? Math.floor(repeats / 2) + 1;
  const cfg: RepeatsConfig = {
    repeats,
    require,
    minOverall: partial.minOverall ?? DEFAULT_MIN_OVERALL,
    minMarket: partial.minMarket ?? DEFAULT_MIN_MARKET,
    rangeThreshold: partial.rangeThreshold ?? DEFAULT_RANGE_THRESHOLD,
    maxRuns: partial.maxRuns ?? Math.min(repeats + 2, 5),
  };
  if (!Number.isInteger(cfg.repeats) || cfg.repeats < 1) {
    throw new Error(`--repeats 必须 ≥1，收到 ${cfg.repeats}`);
  }
  if (!Number.isInteger(cfg.require) || cfg.require < 1 || cfg.require > cfg.repeats) {
    throw new Error(`--require 必须在 1..repeats(${cfg.repeats}) 内，收到 ${cfg.require}`);
  }
  if (cfg.maxRuns < cfg.repeats) {
    throw new Error(`maxRuns(${cfg.maxRuns}) 不得小于 repeats(${cfg.repeats})`);
  }
  return cfg;
}

/** 单局过门：投稿门不 block + 总分 ≥ 线 + 市场分 ≥ 线 */
export function isRunPass(o: Pick<RunOutcome, 'totalScore' | 'marketScore' | 'platformGatePass'>,
                          cfg: RepeatsConfig): boolean {
  return o.platformGatePass && o.totalScore >= cfg.minOverall && o.marketScore >= cfg.minMarket;
}

export function rangeOf(scores: number[]): number {
  if (scores.length === 0) return 0;
  return Math.max(...scores) - Math.min(...scores);
}

export function medianOf(scores: number[]): number {
  if (scores.length === 0) return 0;
  const s = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * 是否应再加跑一局：未达基准局数必须跑；基准局数已满后，
 * 总分极差或市场分极差任一 > 阈值且未到上限 → 加跑。
 */
export function shouldExtend(outcomes: RunOutcome[], cfg: RepeatsConfig): boolean {
  if (outcomes.length < cfg.repeats) return true;
  if (outcomes.length >= cfg.maxRuns) return false;
  const totals = outcomes.map((o) => o.totalScore);
  const markets = outcomes.map((o) => o.marketScore);
  return rangeOf(totals) > cfg.rangeThreshold || rangeOf(markets) > cfg.rangeThreshold;
}

export function summarize(outcomes: RunOutcome[], cfg: RepeatsConfig): RepeatsSummary {
  const passCount = outcomes.filter((o) => isRunPass(o, cfg)).length;
  return {
    runs: outcomes,
    passCount,
    require: cfg.require,
    verdictPass: passCount >= cfg.require,
    totalRange: rangeOf(outcomes.map((o) => o.totalScore)),
    marketRange: rangeOf(outcomes.map((o) => o.marketScore)),
    medianOverall: medianOf(outcomes.map((o) => o.totalScore)),
    extended: outcomes.length > cfg.repeats,
    config: cfg,
    totalCostRmb: outcomes.reduce((s, o) => s + o.costRmb, 0),
    engineNames: [...new Set(outcomes.map((o) => o.engineName))],
  };
}
