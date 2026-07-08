/**
 * Reduce 阶段：全局分析 Pipeline（对齐设计文档 v2.2 第三章）
 *
 * R1 人物归一化 → R2 五维评分 → R3 情绪曲线 → R4 改进建议
 * 每个子调用独立 prompt、独立 schema、独立重试。
 */
import type { AIAgentAdapter } from '../engine/interface.ts';
import { callWithValidation, type SchemaSpec } from '../engine/json-validator.ts';
import { loadPrompt } from '../engine/bigmodel.ts';
import type {
  Chapter, Character, DimensionKey, DimensionScore, EmotionalPoint,
  Excerpt, Suggestion, TokenUsage, DimensionKey as DK,
} from '../types.ts';
import { DIMENSION_KEYS } from '../types.ts';

export interface ReducePhaseResult {
  dimensions: Record<DimensionKey, DimensionScore>;
  characters: Character[];
  emotionalCurve: EmotionalPoint[];
  suggestions: Suggestion[];
  usage: TokenUsage;
  failures: string[];  // 非致命失败的子调用
}

export interface ReduceProgressCallback {
  (step: 'r1' | 'r2' | 'r3' | 'r4', status: 'ok' | 'failed'): void;
}

const zeroUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, costRmb: 0, model: '', durationMs: 0 };

export async function runReducePhase(
  engine: AIAgentAdapter,
  chapters: Chapter[],
  weights: Record<DimensionKey, number>,
  profileName: string,
  onProgress?: ReduceProgressCallback,
): Promise<ReducePhaseResult> {
  const totalUsage: TokenUsage = { ...zeroUsage };
  const failures: string[] = [];

  // 构造各章摘要块（R1/R2/R4 共用）
  const chaptersBlock = chapters.map((c) =>
    `【${c.id} ${c.title}】张力=${c.emotionalTension}\n  摘要: ${c.summary}\n  事件: ${c.keyEvents.map((e, i) => `${i + 1}.${e}`).join(' ')}\n  角色: ${c.characters.join('、')}`,
  ).join('\n\n');

  // 构造 excerpts 清单（R2/R4 用，带 index 供指针引用）
  const excerptsBlock = chapters.flatMap((c) =>
    c.excerpts.map((e, i) =>
      `[${c.id}#${i}] dim=${e.dimension} | ${e.text}（${e.reason}）`,
    ),
  ).join('\n');

  // ─── R1 人物归一化 ───────────────────────────────────────
  const r1CharactersBlock = chapters.map((c) =>
    `${c.id}: ${c.characters.join('、')}`,
  ).join('\n');
  const r1Prompt = loadPrompt('reduce-r1').replace('{CHAPTERS}', r1CharactersBlock);
  const r1Schema: SchemaSpec = {
    characters: {
      type: 'array', required: true,
      itemSpec: {
        type: 'object', fields: {
          name: { type: 'string', required: true },
          role: { type: 'string', required: true },
          aliases: { type: 'array', itemSpec: { type: 'string' } },
          arc: { type: 'string' },
          firstAppearance: { type: 'string' },
          keyChapters: { type: 'array', itemSpec: { type: 'string' } },
        },
      },
    },
  };
  const r1 = await callWithValidation<{ characters: Character[] }>(engine, r1Prompt, {
    systemPrompt: '你是人物谱系编辑。只输出 JSON。',
    outputSchema: { type: 'object' },
    temperature: 0.3, maxTokens: 3000, timeoutMs: 120_000,
    schema: r1Schema, maxAttempts: 3,
  });
  addUsage(totalUsage, r1.totalUsage);
  const characters = r1.ok && r1.data ? r1.data.characters : [];
  if (!r1.ok) failures.push('R1 人物归一化失败');
  onProgress?.('r1', r1.ok ? 'ok' : 'failed');

  // 构造人物列表块（R2/R4 用）
  const charactersBlock = characters.map((c) =>
    `${c.name}（${c.role}）${c.aliases?.length ? `别名:${c.aliases.join('/')}` : ''}`,
  ).join('、');

  // ─── R2 五维评分（价值核心，致命）────────────────────────
  const weightsBlock = Object.entries(weights).map(([k, v]) => `${k}: ${v}`).join('  ');
  const r2Prompt = loadPrompt('reduce-r2')
    .replace('{CHAPTERS}', chaptersBlock)
    .replace('{EXCERPTS}', excerptsBlock)
    .replace('{CHARACTERS}', charactersBlock)
    .replace('{PROFILE}', profileName)
    .replace('{WEIGHTS}', weightsBlock);
  const r2Schema: SchemaSpec = {
    dimensions: {
      type: 'object', required: true, fields: Object.fromEntries(
        DIMENSION_KEYS.map((k) => [k, {
          type: 'object', required: true, fields: {
            score: { type: 'number', min: 0, max: 100, integer: true, required: true },
            analysis: { type: 'string', min: 50, required: true },
            subscores: { type: 'object' },
          },
        }]),
      ),
    },
  };
  const r2 = await callWithValidation<{ dimensions: Record<DimensionKey, DimensionScore> }>(engine, r2Prompt, {
    systemPrompt: '你是资深小说总编，做全局五维评判。只输出 JSON。analysis 里用 [chapterId#excerptIndex] 指针引用证据。',
    outputSchema: { type: 'object' },
    temperature: 0.4, maxTokens: 8192, timeoutMs: 180_000,
    schema: r2Schema, maxAttempts: 3,
  });
  addUsage(totalUsage, r2.totalUsage);
  if (!r2.ok || !r2.data) {
    onProgress?.('r2', 'failed');
    throw new Error(`R2 五维评分失败（致命）：${r2.errors.join('; ')}`);
  }
  onProgress?.('r2', 'ok');
  const dimensions = r2.data.dimensions;

  // ─── R3 情绪曲线（与 R1 无依赖，但顺序执行简化）──────────
  const curveInput = chapters.map((c) => `${c.id}: ${c.emotionalTension}`).join('\n');
  const r3Prompt = loadPrompt('reduce-r3').replace('{CURVE}', curveInput);
  const r3Schema: SchemaSpec = {
    curve: {
      type: 'array', required: true,
      itemSpec: {
        type: 'object', fields: {
          chapterId: { type: 'string', required: true },
          tension: { type: 'number', min: 0, max: 100, integer: true, required: true },
          annotation: { type: 'string' },
        },
      },
    },
  };
  const r3 = await callWithValidation<{ curve: EmotionalPoint[] }>(engine, r3Prompt, {
    systemPrompt: '你是叙事节奏分析师。只输出 JSON。',
    outputSchema: { type: 'object' },
    temperature: 0.3, maxTokens: 2000, timeoutMs: 120_000,
    schema: r3Schema, maxAttempts: 3,
  });
  addUsage(totalUsage, r3.totalUsage);
  const emotionalCurve = r3.ok && r3.data ? r3.data.curve : chapters.map((c) => ({ chapterId: c.id, tension: c.emotionalTension }));
  if (!r3.ok) failures.push('R3 情绪曲线失败');
  onProgress?.('r3', r3.ok ? 'ok' : 'failed');

  // ─── R4 改进建议 ─────────────────────────────────────────
  const dimensionsBlock = DIMENSION_KEYS.map((k) => `${k}: ${dimensions[k]?.score}`).join('  ');
  const r4Prompt = loadPrompt('reduce-r4')
    .replace('{DIMENSIONS}', dimensionsBlock)
    .replace('{CHAPTERS}', chaptersBlock)
    .replace('{EXCERPTS}', excerptsBlock)
    .replace('{CHARACTERS}', charactersBlock);
  const r4Schema: SchemaSpec = {
    suggestions: {
      type: 'array', required: true,
      itemSpec: {
        type: 'object', fields: {
          dimension: { type: 'string', required: true },
          content: { type: 'string', min: 10, required: true },
          type: { type: 'string' },
          relatedChapters: { type: 'array', itemSpec: { type: 'string' } },
          excerptRef: { type: 'object' },
        },
      },
    },
  };
  const r4 = await callWithValidation<{ suggestions: Suggestion[] }>(engine, r4Prompt, {
    systemPrompt: '你是改稿指导，输出手术刀式可执行建议。只输出 JSON。',
    outputSchema: { type: 'object' },
    temperature: 0.4, maxTokens: 6000, timeoutMs: 150_000,
    schema: r4Schema, maxAttempts: 3,
  });
  addUsage(totalUsage, r4.totalUsage);
  const suggestions = r4.ok && r4.data ? r4.data.suggestions : [];
  if (!r4.ok) failures.push('R4 改进建议失败');
  onProgress?.('r4', r4.ok ? 'ok' : 'failed');

  return { dimensions, characters, emotionalCurve, suggestions, usage: totalUsage, failures };
}

function addUsage(total: TokenUsage, add: TokenUsage): void {
  total.inputTokens += add.inputTokens;
  total.outputTokens += add.outputTokens;
  total.costRmb += add.costRmb;
  total.model = add.model;
  total.durationMs += add.durationMs;
}
