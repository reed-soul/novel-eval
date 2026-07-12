/**
 * BigModelAdapter — 智谱 GLM 引擎（对齐设计文档 v2.2 第四章）
 *
 * 通过智谱 BigModel 的 Anthropic 兼容端点调用 glm-5.2。
 * 认证：ANTHROPIC_AUTH_TOKEN（Claude Code 用的同一 token）或 ZHIPUAI_API_KEY。
 * base_url：https://open.bigmodel.cn/api/anthropic
 *
 * HTTP/解析/usage 逻辑继承自 AnthropicCompatAdapter（与 DeepSeek 共享）。
 */
import { AnthropicCompatAdapter } from './anthropic-compat.ts';

// glm-5.2 定价估算（元/百万 token，保守估；订阅用户走套餐额度）
const PRICE_INPUT_PER_M = 10;
const PRICE_OUTPUT_PER_M = 10;

export class BigModelAdapter extends AnthropicCompatAdapter {
  readonly name = 'bigmodel';

  constructor(opts: { baseUrl: string; model: string }) {
    super({
      name: 'bigmodel',
      baseUrl: opts.baseUrl,
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ZHIPUAI_API_KEY ?? '',
      model: opts.model,
      pricing: { inputPerM: PRICE_INPUT_PER_M, outputPerM: PRICE_OUTPUT_PER_M },
      missingKeyHint: '未找到 API token。请设置 ANTHROPIC_AUTH_TOKEN 或 ZHIPUAI_API_KEY。',
    });
  }
}
