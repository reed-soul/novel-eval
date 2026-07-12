/**
 * BigModelAdapter — 智谱 GLM 引擎（对齐设计文档 v2.2 第四章）
 *
 * 通过智谱 BigModel 的 Anthropic 兼容端点调用 glm-5.2。
 * 裸 fetch（无 SDK），便于看清兼容层行为。
 *
 * 认证：ANTHROPIC_AUTH_TOKEN（Claude Code 用的同一 token）或 ZHIPUAI_API_KEY。
 * base_url：https://open.bigmodel.cn/api/anthropic
 *
 * spike 验证：兼容端点工作正常，但 output_schema 不强制约束输出，
 * 须配合 parseJSONRobust + schema 校验 + 重试三重保险（见设计文档 10.6）。
 */
import type { TokenUsage } from '../types.ts';
import type { AIAgentAdapter, CallResult, RunOptions } from './interface.ts';

// glm-5.2 定价估算（元/百万 token，保守估；订阅用户走套餐额度）
const PRICE_INPUT_PER_M = 10;
const PRICE_OUTPUT_PER_M = 10;

export class BigModelAdapter implements AIAgentAdapter {
  readonly name = 'bigmodel';
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(opts: { baseUrl: string; model: string }) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ZHIPUAI_API_KEY ?? '';
    this.model = opts.model;
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async run(userPrompt: string, options: RunOptions): Promise<CallResult> {
    if (!this.apiKey) {
      throw new Error('未找到 API token。请设置 ANTHROPIC_AUTH_TOKEN 或 ZHIPUAI_API_KEY。');
    }

    const model = options.model ?? this.model;
    const notes: string[] = [];
    const startedAt = Date.now();
    const systemPrompt = options.systemPrompt ?? '';

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 8192,
      // GLM 端要求 temperature 小数点后不超过 2 位，防御性 round（避免浮点精度如 0.30000000000000004）
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/messages`, {
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
      throw new Error(`BigModel API ${res.status}: ${errText.slice(0, 500)}`);
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

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      costRmb: estimateCostRmb(inputTokens, outputTokens),
      model,
      durationMs,
    };

    if (inputTokens === 0 && outputTokens === 0) {
      notes.push('⚠️ usage 为 0');
    }

    return { text, usage, notes };
  }
}

function estimateCostRmb(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * PRICE_INPUT_PER_M
    + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;
}
