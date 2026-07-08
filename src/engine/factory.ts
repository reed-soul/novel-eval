/**
 * 引擎工厂（对齐设计文档 v2.2 第四章）
 */
import { BigModelAdapter } from './bigmodel.ts';
import type { AIAgentAdapter } from './interface.ts';
import type { EngineConfig } from '../types.ts';

export function createEngine(config: EngineConfig): AIAgentAdapter {
  // 目前只实现 BigModelAdapter；AnthropicAPIAdapter/ClaudeCodeAdapter 留待 v2
  return new BigModelAdapter({ baseUrl: config.baseUrl, model: config.model });
}
