/**
 * DeepSeekAdapter — DeepSeek 引擎
 *
 * DeepSeek 同时提供 OpenAI 兼容端点和 Anthropic 兼容端点。
 * 这里走 Anthropic 兼容端点（https://api.deepseek.com/anthropic），
 * 与 BigModelAdapter 共享同一套 HTTP/解析逻辑。
 *
 * 认证：DEEPSEEK_API_KEY。
 * 模型：deepseek-v4-pro（最强，用于 bible/蓝图/章节生成）、deepseek-v4-flash（快，用于校对/摘要）。
 *
 * 定价估算（元/百万 token，保守估；以 DeepSeek 官网为准）
 *   v4-pro:  输入 ¥8 / 输出 ¥24（含缓存命中优惠）
 *   v4-flash: 输入 ¥2 / 输出 ¥8
 *   这里用通用中位价估算，实际可能更低（DeepSeek 有上下文缓存折扣）。
 */
import { AnthropicCompatAdapter } from './anthropic-compat.ts';

export class DeepSeekAdapter extends AnthropicCompatAdapter {
  readonly name = 'deepseek';

  constructor(opts: { baseUrl: string; model: string }) {
    super({
      name: 'deepseek',
      baseUrl: opts.baseUrl,
      apiKey: process.env.DEEPSEEK_API_KEY ?? '',
      model: opts.model,
      pricing: { inputPerM: 8, outputPerM: 24 },
      missingKeyHint: '未找到 DEEPSEEK_API_KEY。请在 Web 端模型配置页填写，或设置环境变量。',
    });
  }
}
