/**
 * 引擎工厂（对齐设计文档 v2.2 第四章）
 *
 * 根据 EngineConfig.provider 选择对应的 adapter。
 * 目前支持：bigmodel（智谱 GLM）、deepseek。
 */
import { BigModelAdapter } from './bigmodel.ts';
import { DeepSeekAdapter } from './deepseek.ts';
import type { AIAgentAdapter } from './interface.ts';
import type { EngineConfig } from '../types.ts';

export function createEngine(config: EngineConfig): AIAgentAdapter {
  switch (config.provider) {
    case 'deepseek':
      return new DeepSeekAdapter({ baseUrl: config.baseUrl, model: config.model });
    case 'bigmodel':
    default:
      return new BigModelAdapter({ baseUrl: config.baseUrl, model: config.model });
  }
}
