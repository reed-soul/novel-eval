/**
 * JSON Schema 校验 + 重试编排（对齐设计文档 v2.2 10.6/10.7）
 *
 * 流程：parseJSONRobust（容错解析）→ validate（schema 约束）→ 失败则重试
 * spike 验证：容错解析能修复中文未转义引号，重试很少被触发。
 *
 * eval（Map/Reduce 的结构化输出）和 writer（角色卡/大纲/章节生成）共用。
 */
import { parseJSONRobust } from './json-util.ts';
import type { AIAgentAdapter, RunOptions } from './interface.ts';
import type { TokenUsage } from '../types.ts';

export interface ValidateResult<T> {
  data: T | null;
  ok: boolean;
  errors: string[];
  attempts: number;
}

/** 简单 schema 校验：检查 required 字段存在 + 类型 + 范围。schema 用简化格式描述。 */
export type FieldSpec =
  | { type: 'string'; min?: number; max?: number; required?: boolean }
  | { type: 'number'; min?: number; max?: number; required?: boolean; integer?: boolean }
  | { type: 'boolean'; required?: boolean }
  | { type: 'array'; min?: number; max?: number; required?: boolean; itemSpec?: FieldSpec }
  | { type: 'object'; required?: boolean; fields?: Record<string, FieldSpec> };

export type SchemaSpec = Record<string, FieldSpec>;

export function validate(data: unknown, spec: SchemaSpec): string[] {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null) return ['输出不是对象'];
  const o = data as Record<string, unknown>;
  for (const [key, fieldSpec] of Object.entries(spec)) {
    const val = o[key];
    errors.push(...validateField(val, key, fieldSpec));
  }
  return errors;
}

function validateField(val: unknown, name: string, spec: FieldSpec): string[] {
  const errors: string[] = [];
  const required = (spec as { required?: boolean }).required ?? false;

  if (val === undefined || val === null) {
    if (required) errors.push(`${name} 缺失`);
    return errors;
  }

  switch (spec.type) {
    case 'string': {
      if (typeof val !== 'string') { errors.push(`${name} 不是字符串`); break; }
      if (spec.min !== undefined && val.length < spec.min) errors.push(`${name} 过短(${val.length}<${spec.min})`);
      if (spec.max !== undefined && val.length > spec.max) errors.push(`${name} 过长(${val.length}>${spec.max})`);
      break;
    }
    case 'number': {
      if (typeof val !== 'number') { errors.push(`${name} 不是数字`); break; }
      if (spec.integer && !Number.isInteger(val)) errors.push(`${name} 不是整数`);
      if (spec.min !== undefined && val < spec.min) errors.push(`${name} 越界(${val}<${spec.min})`);
      if (spec.max !== undefined && val > spec.max) errors.push(`${name} 越界(${val}>${spec.max})`);
      break;
    }
    case 'boolean': {
      if (typeof val !== 'boolean') errors.push(`${name} 不是布尔`);
      break;
    }
    case 'array': {
      if (!Array.isArray(val)) { errors.push(`${name} 不是数组`); break; }
      if (spec.min !== undefined && val.length < spec.min) errors.push(`${name} 过短(${val.length}<${spec.min})`);
      if (spec.max !== undefined && val.length > spec.max) errors.push(`${name} 过长(${val.length}>${spec.max})`);
      if (spec.itemSpec) {
        val.forEach((item, i) => {
          const sub = validateField(item, `${name}[${i}]`, spec.itemSpec!);
          errors.push(...sub);
        });
      }
      break;
    }
    case 'object': {
      if (typeof val !== 'object' || val === null) { errors.push(`${name} 不是对象`); break; }
      if (spec.fields) {
        for (const [k, fs] of Object.entries(spec.fields)) {
          errors.push(...validateField((val as Record<string, unknown>)[k], `${name}.${k}`, fs));
        }
      }
      break;
    }
  }
  return errors;
}

export interface CallWithValidationOptions extends RunOptions {
  schema: SchemaSpec;
  maxAttempts?: number;
  /** 重试时把错误拼回 prompt 的模板，默认在 userPrompt 末尾追加 */
  retryHint?: (errors: string[], attempt: number) => string;
}

/** 带容错解析 + schema 校验 + 重试的完整调用 */
export async function callWithValidation<T>(
  engine: AIAgentAdapter,
  userPrompt: string,
  options: CallWithValidationOptions,
): Promise<ValidateResult<T> & { lastUsage: TokenUsage; totalUsage: TokenUsage }> {
  const { parseJSONRobust } = await import('./json-util.ts');
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError = '';
  const zeroUsage = { inputTokens: 0, outputTokens: 0, costRmb: 0, model: '', durationMs: 0 };
  let totalUsage = { ...zeroUsage };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let prompt = userPrompt;
    if (attempt > 1 && lastError) {
      const hint = options.retryHint
        ? options.retryHint(lastError.split('; '), attempt)
        : `\n\n——\n⚠️ 你上次的输出有问题：${lastError}\n请修正后重新输出 JSON。`;
      prompt += hint;
    }

    const { text, usage } = await engine.run(prompt, {
      ...options,
      // 重试时降温；round 到 2 位小数避免浮点精度（如 0.4-0.1=0.30000000000000004）触发 GLM 端 temperature 校验
      temperature: attempt === 1 ? options.temperature : Math.round(Math.max(0.1, (options.temperature ?? 0.3) - 0.1) * 100) / 100,
    });

    totalUsage = {
      inputTokens: totalUsage.inputTokens + usage.inputTokens,
      outputTokens: totalUsage.outputTokens + usage.outputTokens,
      costRmb: totalUsage.costRmb + usage.costRmb,
      model: usage.model,
      durationMs: totalUsage.durationMs + usage.durationMs,
    };

    let parsed: unknown;
    let parseError: string | undefined;
    try {
      parsed = parseJSONRobust(text);
    } catch (e) {
      parsed = null;
      parseError = (e as Error).message;
    }

    if (parseError) {
      lastError = parseError;
      continue;
    }

    const errors = validate(parsed, options.schema);
    if (errors.length === 0) {
      return { data: parsed as T, ok: true, errors: [], attempts: attempt, lastUsage: usage, totalUsage };
    }
    lastError = errors.join('; ');
  }

  return { data: null, ok: false, errors: [lastError], attempts: maxAttempts, lastUsage: zeroUsage, totalUsage };
}

// 重新导出 parseJSONRobust（从实现文件）
export { parseJSONRobust } from './json-util.ts';
