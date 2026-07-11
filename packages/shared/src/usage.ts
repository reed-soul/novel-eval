/**
 * TokenUsage 累加工具（从 eval 的 reduce-phase 抽出，通用计费）
 */
import type { TokenUsage } from './types.ts';

export const zeroUsage: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costRmb: 0,
  model: '',
  durationMs: 0,
};

/** 把 add 的 token/费用累加进 total */
export function addUsage(total: TokenUsage, add: TokenUsage): void {
  total.inputTokens += add.inputTokens;
  total.outputTokens += add.outputTokens;
  total.costRmb += add.costRmb;
  total.model = add.model;
  total.durationMs += add.durationMs;
}
