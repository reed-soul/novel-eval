/**
 * AI 引擎抽象层接口（对齐设计文档 v2.2 第四章）
 *
 * 所有 adapter 实现同一接口，上层代码只依赖 AIAgentAdapter。
 */
import type { TokenUsage } from '../types.ts';

export interface RunOptions {
  systemPrompt?: string;
  model?: string;
  maxBudgetRmb?: number;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  outputSchema?: object;
  enableCache?: boolean;
}

export interface CallResult {
  text: string;
  usage: TokenUsage;
  notes: string[];
}

export interface AIAgentAdapter {
  readonly name: string;
  run(userPrompt: string, options: RunOptions): Promise<CallResult>;
  isAvailable(): Promise<boolean>;
}
