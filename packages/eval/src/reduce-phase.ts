/**
 * Reduce 阶段：全局分析 Pipeline
 *
 * 依赖图（决定并行调度）：
 *   R1(人物) ─┐
 *              ├→ R2(五维) ─┬→ R4(建议，依赖 R2 dimensions + R1 characters)
 *   R3(曲线) ──┘            └→ R5(市场，依赖 R2 marketPotential)
 *
 * 调度：`(R1 ‖ R3) → R2 → (R4 ‖ R5)`，比纯串行省 2 层等待。
 *
 * mode:
 *   - 'full'（默认）：完整 5 步，供全书 evaluate() 使用。
 *   - 'lite'：跳过 R3/R5（单章质量门槛路径不消费情绪曲线/市场对标），
 *             emotionalCurve 降级为 chapters 直映，marketBenchmark 为 null。
 */
import type { AIAgentAdapter } from '@novel-eval/shared';
import { callWithValidation, type SchemaSpec, type FieldSpec } from '@novel-eval/shared';
import { loadPrompt, addUsage, zeroUsage } from '@novel-eval/shared';
import type {
  Chapter, Character, DimensionKey, DimensionScore, EmotionalPoint,
  MarketBenchmark, NovelMetadata, Suggestion, TokenUsage,
} from './types.ts';
import { DIMENSION_KEYS } from './types.ts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

const MARKET_DISCLAIMER =
  '本对标基于模型推断与公开认知，非实时市场数据，不构成投资建议。';

export interface ReducePhaseResult {
  dimensions: Record<DimensionKey, DimensionScore>;
  characters: Character[];
  emotionalCurve: EmotionalPoint[];
  suggestions: Suggestion[];
  marketBenchmark: MarketBenchmark | null;
  usage: TokenUsage;
  failures: string[];
}

export interface ReduceProgressCallback {
  (step: 'r1' | 'r2' | 'r3' | 'r4' | 'r5', status: 'ok' | 'failed'): void;
}

export type ReduceMode = 'full' | 'lite';

export async function runReducePhase(
  engine: AIAgentAdapter,
  chapters: Chapter[],
  weights: Record<DimensionKey, number>,
  profileName: string,
  metadata: NovelMetadata,
  onProgress?: ReduceProgressCallback,
  mode: ReduceMode = 'full',
): Promise<ReducePhaseResult> {
  const totalUsage: TokenUsage = { ...zeroUsage };
  const failures: string[] = [];

  const chaptersBlock = chapters.map((c) =>
    `【${c.id} ${c.title}】张力=${c.emotionalTension}\n  摘要: ${c.summary}\n  事件: ${c.keyEvents.map((e, i) => `${i + 1}.${e}`).join(' ')}\n  角色: ${c.characters.join('、')}`,
  ).join('\n\n');

  const excerptsBlock = chapters.flatMap((c) =>
    c.excerpts.map((e, i) =>
      `[${c.id}#${i}] dim=${e.dimension} | ${e.text}（${e.reason}）`,
    ),
  ).join('\n');

  // ─── R1 人物归一化 ‖ R3 情绪曲线（都只依赖输入 chapters，可并行）──
  // lite 模式跳过 R3
  const r1CharactersBlock = chapters.map((c) =>
    `${c.id}: ${c.characters.join('、')}`,
  ).join('\n');
  const r1Prompt = loadPrompt('reduce-r1', PROMPTS_DIR).replace('{CHAPTERS}', r1CharactersBlock);
  const relationshipItemSpec: FieldSpec = {
    type: 'object', fields: {
      target: { type: 'string', required: true },
      type: { type: 'string', required: true },
      strength: { type: 'number', min: 0, max: 100, integer: true, required: true },
    },
  };
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
          relationships: { type: 'array', itemSpec: relationshipItemSpec },
        },
      },
    },
  };
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
  const curveInput = chapters.map((c) => `${c.id}: ${c.emotionalTension}`).join('\n');
  const r3Prompt = loadPrompt('reduce-r3', PROMPTS_DIR).replace('{CURVE}', curveInput);

  // R1 始终执行；R3 仅 full 模式执行 → 用 Promise.all 并行（lite 时 R3 分支为 null）
  const [r1, r3] = await Promise.all([
    callWithValidation<{ characters: Character[] }>(engine, r1Prompt, {
      systemPrompt: '你是人物谱系编辑。只输出 JSON。',
      outputSchema: { type: 'object' },
      temperature: 0.3, maxTokens: 4000, timeoutMs: 120_000,
      schema: r1Schema, maxAttempts: 3,
    }),
    mode === 'full'
      ? callWithValidation<{ curve: EmotionalPoint[] }>(engine, r3Prompt, {
        systemPrompt: '你是叙事节奏分析师。只输出 JSON。',
        outputSchema: { type: 'object' },
        temperature: 0.3, maxTokens: 2000, timeoutMs: 120_000,
        schema: r3Schema, maxAttempts: 3,
      })
      : Promise.resolve(null),
  ]);
  addUsage(totalUsage, r1.totalUsage);
  const characters = r1.ok && r1.data ? r1.data.characters : [];
  if (!r1.ok) failures.push('R1 人物归一化失败');
  onProgress?.('r1', r1.ok ? 'ok' : 'failed');

  // R3 结果处理（lite 模式降级为 chapters 直映）
  let emotionalCurve: EmotionalPoint[];
  if (mode === 'full' && r3) {
    addUsage(totalUsage, r3.totalUsage);
    emotionalCurve = r3.ok && r3.data ? r3.data.curve : chapters.map((c) => ({ chapterId: c.id, tension: c.emotionalTension }));
    if (!r3.ok) failures.push('R3 情绪曲线失败');
    onProgress?.('r3', r3.ok ? 'ok' : 'failed');
  } else {
    emotionalCurve = chapters.map((c) => ({ chapterId: c.id, tension: c.emotionalTension }));
  }

  const charactersBlock = characters.map((c) =>
    `${c.name}（${c.role}）${c.aliases?.length ? `别名:${c.aliases.join('/')}` : ''}`,
  ).join('、');

  // ─── R2 五维评分（致命，依赖 R1 的 charactersBlock）────────────────────────────────
  const weightsBlock = Object.entries(weights).map(([k, v]) => `${k}: ${v}`).join('  ');
  const r2Prompt = loadPrompt('reduce-r2', PROMPTS_DIR)
    .replace('{CHAPTERS}', chaptersBlock)
    .replace('{EXCERPTS}', excerptsBlock)
    .replace('{CHARACTERS}', charactersBlock)
    .replace('{PROFILE}', profileName)
    .replace('{WEIGHTS}', weightsBlock)
    .replace('{GENRE}', metadata.genre)
    .replace('{AUDIENCE}', metadata.targetAudience)
    .replace('{PLATFORM}', metadata.platform ?? '未指定');
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

  // ─── R4 改进建议 ‖ R5 市场对标（都只依赖 R2，可并行）──────────────
  // lite 模式跳过 R5
  const dimensionsBlock = DIMENSION_KEYS.map((k) => `${k}: ${dimensions[k]?.score}`).join('  ');
  const r4Prompt = loadPrompt('reduce-r4', PROMPTS_DIR)
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
  const marketDim = dimensions.marketPotential;
  const r5Prompt = loadPrompt('reduce-r5', PROMPTS_DIR)
    .replace('{GENRE}', metadata.genre)
    .replace('{AUDIENCE}', metadata.targetAudience)
    .replace('{PLATFORM}', metadata.platform ?? '未指定')
    .replace('{MARKET_SCORE}', String(marketDim?.score ?? 0))
    .replace('{MARKET_ANALYSIS}', marketDim?.analysis ?? '')
    .replace('{CHAPTERS}', chaptersBlock.slice(0, 8000));
  const comparableItemSpec: FieldSpec = {
    type: 'object', fields: {
      title: { type: 'string', required: true },
      similarity: { type: 'number', min: 0, max: 100, integer: true, required: true },
      matchReason: { type: 'string', required: true },
      differentiation: { type: 'string', required: true },
      referenceNote: { type: 'string', required: true },
    },
  };
  const r5Schema: SchemaSpec = {
    positioning: { type: 'string', required: true },
    audienceFit: { type: 'number', min: 0, max: 100, integer: true, required: true },
    comparables: { type: 'array', min: 1, max: 5, required: true, itemSpec: comparableItemSpec },
    disclaimer: { type: 'string', required: true },
  };

  // R4 始终执行；R5 仅 full 模式执行 → 用 Promise.all 并行（lite 时 R5 分支为 null）
  const [r4, r5] = await Promise.all([
    callWithValidation<{ suggestions: Suggestion[] }>(engine, r4Prompt, {
      systemPrompt: '你是改稿指导，输出手术刀式可执行建议。只输出 JSON。',
      outputSchema: { type: 'object' },
      temperature: 0.4, maxTokens: 6000, timeoutMs: 150_000,
      schema: r4Schema, maxAttempts: 3,
    }),
    mode === 'full'
      ? callWithValidation<MarketBenchmark>(engine, r5Prompt, {
        systemPrompt: '你是出版市场分析师。只输出 JSON。禁止编造票房排名销量。',
        outputSchema: { type: 'object' },
        temperature: 0.4, maxTokens: 3000, timeoutMs: 120_000,
        schema: r5Schema, maxAttempts: 3,
      })
      : Promise.resolve(null),
  ]);
  addUsage(totalUsage, r4.totalUsage);
  const suggestions = r4.ok && r4.data ? r4.data.suggestions : [];
  if (!r4.ok) failures.push('R4 改进建议失败');
  onProgress?.('r4', r4.ok ? 'ok' : 'failed');

  let marketBenchmark: MarketBenchmark | null = null;
  if (mode === 'full' && r5) {
    addUsage(totalUsage, r5.totalUsage);
    if (r5.ok && r5.data) {
      marketBenchmark = { ...r5.data, disclaimer: r5.data.disclaimer || MARKET_DISCLAIMER };
    } else {
      failures.push('R5 市场对标失败');
    }
    onProgress?.('r5', r5.ok ? 'ok' : 'failed');
  }

  return { dimensions, characters, emotionalCurve, suggestions, marketBenchmark, usage: totalUsage, failures };
}
