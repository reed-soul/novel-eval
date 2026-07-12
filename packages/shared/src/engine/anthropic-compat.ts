/**
 * AnthropicCompatAdapter — Anthropic 兼容端点的共享基类
 *
 * 智谱 GLM（open.bigmodel.cn/api/anthropic）和 DeepSeek（api.deepseek.com/anthropic）
 * 都提供 Anthropic /v1/messages 兼容端点，请求/响应格式一致，只在以下几处不同：
 *   - baseUrl
 *   - 认证用的环境变量名（API key 来源）
 *   - 定价（元/百万 token）
 *
 * 子类只需提供这三项 + name，其余 HTTP/解析/usage 逻辑全部复用本基类。
 *
 * 裸 fetch（无 SDK），便于看清兼容层行为。
 * spike 验证：兼容端点工作正常，但 output_schema 不强制约束输出，
 * 须配合 parseJSONRobust + schema 校验 + 重试三重保险（见 json-validator.ts）。
 */
import type { TokenUsage } from '../types.ts';
import type { AIAgentAdapter, CallResult, RunOptions } from './interface.ts';

export interface AnthropicCompatOptions {
  /** 引擎名，如 'bigmodel' / 'deepseek' */
  name: string;
  /** Anthropic 兼容端点 baseUrl，不含 /v1/messages 后缀 */
  baseUrl: string;
  /** API key（运行时由子类从环境变量解析）*/
  apiKey: string;
  /** 默认模型 */
  model: string;
  /** 定价：元/百万 token（保守估）*/
  pricing: { inputPerM: number; outputPerM: number };
  /** 找不到 key 时的提示语 */
  missingKeyHint: string;
}

export abstract class AnthropicCompatAdapter implements AIAgentAdapter {
  abstract readonly name: string;
  protected readonly opts: AnthropicCompatOptions;

  constructor(opts: AnthropicCompatOptions) {
    this.opts = opts;
  }

  protected get apiKey(): string {
    return this.opts.apiKey;
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async run(userPrompt: string, options: RunOptions): Promise<CallResult> {
    if (!this.apiKey) {
      throw new Error(this.opts.missingKeyHint);
    }

    const model = options.model ?? this.opts.model;
    const notes: string[] = [];
    const startedAt = Date.now();
    const systemPrompt = options.systemPrompt ?? '';

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 8192,
      // 兼容端点要求 temperature 小数点后不超过 2 位，防御性 round
      // （避免浮点精度如 0.4-0.1=0.30000000000000004 触发端校验）
      temperature: Math.round((options.temperature ?? 0.3) * 100) / 100,
      system: options.enableCache
        ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
        : systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    };

    if (options.outputSchema) {
      body.output_schema = options.outputSchema;
      notes.push('sent output_schema（兼容层不强制，须后端校验）');
    }

    // 关闭推理过程（DeepSeek pro/flash 默认输出 thinking block，会占用 output token 预算；
    // 结构化输出场景需要关闭以保证 JSON 完整性。智谱端忽略此字段。）
    if (options.disableThinking) {
      body.thinking = { type: 'disabled' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000);

    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'authorization': `Bearer ${this.apiKey}`,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Date.now() - startedAt;

    if (!res.ok) {
      const errText = await res.text().catch(() => '<unreadable>');
      throw new Error(`${this.opts.name} API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { message?: string };
    };

    if (data.error?.message) {
      throw new Error(`LLM 返回错误: ${data.error.message}`);
    }

    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('');

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;

    const { inputPerM, outputPerM } = this.opts.pricing;
    const costRmb = (inputTokens / 1_000_000) * inputPerM + (outputTokens / 1_000_000) * outputPerM;

    const usage: TokenUsage = { inputTokens, outputTokens, costRmb, model, durationMs };

    if (inputTokens === 0 && outputTokens === 0) {
      notes.push('⚠️ usage 为 0');
    }

    return { text, usage, notes };
  }
}
