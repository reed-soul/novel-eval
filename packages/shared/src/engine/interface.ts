/**
 * AI 引擎抽象层接口（对齐设计文档 v2.2 第四章）
 *
 * 所有 adapter 实现同一接口，上层代码只依赖 AIAgentAdapter。
 * eval 和 writer 包共用此接口。
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
  /** 关闭模型推理过程（thinking）。结构化输出（JSON）场景建议开启，
   *  避免推理 token 干扰输出预算和 JSON 解析。DeepSeek 支持，智谱忽略此字段。*/
  disableThinking?: boolean;
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
