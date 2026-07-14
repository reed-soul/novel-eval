/**
 * 章节定稿器 — 每章写完后更新叙事状态
 *
 * 两个 LLM 调用（可并行）：
 *   1. macroSummary 重写（含 openForeshadows 更新）
 *   2. characterState 重写
 *
 * 每 10 章固化一次 arcSummary（防宏观摘要反复重写丢失早期信息）。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIAgentAdapter } from '@novel-eval/shared';
import { callWithValidation, loadPrompt, addUsage, zeroUsage, type SchemaSpec } from '@novel-eval/shared';
import type { DB } from '../db.ts';
import type { CharacterState, CharacterStateEntry } from '../bible/types.ts';
import type { NarrativeState, ArcSummary, OpenForeshadow } from './types.ts';
import { getBibleForChapter, updateCharacterState, getNarrativeState, saveNarrativeState } from './store.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

import { getRuntimeConfig } from '../runtime-config.ts';

// ─── summary 更新的 schema（输出 macroSummary + openForeshadows）────────

const SUMMARY_SCHEMA: SchemaSpec = {
  macroSummary: { type: 'string', min: 20, max: 2000, required: true },
  openForeshadows: {
    type: 'array', itemSpec: {
      type: 'object', fields: {
        description: { type: 'string', min: 3, required: true },
        setupChapter: { type: 'number', min: 0, integer: true, required: true },
        // resolveChapter 可能为 null（未回收），schema 不强制校验它
      },
    },
  },
};

// ─── characterState 重写的 schema（复用 M1 结构，放宽容错）────────
// 注意：status 不设 required（LLM 偶尔省略未出场角色的 status）；
// 数组字段不设 required（LLM 偶尔输出 null 而非 []，validateField 对 null 非必填直接跳过）

const STATE_ENTRY_SCHEMA = {
  type: 'object' as const, fields: {
    name: { type: 'string' as const, required: true },
    items: { type: 'array' as const, itemSpec: { type: 'string' as const } },
    abilities: { type: 'array' as const, itemSpec: { type: 'string' as const } },
    status: { type: 'string' as const },
    relationships: { type: 'array' as const, itemSpec: { type: 'string' as const } },
    events: { type: 'array' as const, itemSpec: { type: 'string' as const } },
  },
};
const STATE_SCHEMA: SchemaSpec = {
  characters: { type: 'array', min: 1, required: true, itemSpec: STATE_ENTRY_SCHEMA },
};

// ─── 主入口 ──────────────────────────────────────────────────────

export interface FinalizeOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterContent: string;
  onProgress?: (step: string, msg: string) => void;
}

export interface FinalizeResult {
  usage: import('@novel-eval/shared').TokenUsage;
}

export async function finalizeChapter(opts: FinalizeOptions): Promise<FinalizeResult> {
  const { engine, db, projectId, chapterNumber, chapterTitle, chapterContent, onProgress } = opts;
  const totalUsage = { ...zeroUsage };
  const { fullText: _full, characterState: oldState } = getBibleForChapter(db, projectId);
  void _full;
  const oldNarrative = getNarrativeState(db, projectId);

  // ─── 并行：macroSummary 更新 + characterState 更新 ────────────────
  onProgress?.(`finalize:${chapterNumber}`, '更新宏观主线与角色状态...');

  const oldSummary = oldNarrative?.macroSummary ?? '（故事刚开始，尚无前情）';
  const openForeshadowsText = oldNarrative && oldNarrative.openForeshadows.length
    ? oldNarrative.openForeshadows.map((f) => `第${f.setupChapter}章埋设：${f.description}${f.resolveChapter ? '（已回收）' : ''}`).join('\n')
    : '（暂无）';

  const [summaryRes, stateRes] = await Promise.all([
    // 1. macroSummary 重写（含 openForeshadows 更新）
    callWithValidation<{ macroSummary: string; openForeshadows: Array<{ description: string; setupChapter: number; resolveChapter?: number }> }>(
      engine,
      loadPrompt('summary-update', PROMPTS_DIR)
        .replace('{OLD_SUMMARY}', oldSummary)
        .replace('{CHAPTER_TEXT}', `第${chapterNumber}章《${chapterTitle}》\n${chapterContent.slice(0, 8000)}`)
        .replace('{OPEN_FORESHADOWS}', openForeshadowsText),
      {
        systemPrompt: '你是小说连贯性编辑。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.finalize, maxTokens: 3000, timeoutMs: getRuntimeConfig().generation.timeouts.finalizeMs,
        schema: SUMMARY_SCHEMA, maxAttempts: 3,
        enableCache: true,
      },
    ),
    // 2. characterState 重写
    callWithValidation<{ characters: CharacterStateEntry[] }>(
      engine,
      loadPrompt('state-update', PROMPTS_DIR)
        .replace('{OLD_STATE}', JSON.stringify(oldState))
        .replace('{CHAPTER_TEXT}', `第${chapterNumber}章《${chapterTitle}》\n${chapterContent.slice(0, 8000)}`),
      {
        systemPrompt: '你是小说连贯性编辑。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.finalize, maxTokens: 2500, timeoutMs: getRuntimeConfig().generation.timeouts.finalizeMs,
        schema: STATE_SCHEMA, maxAttempts: 3,
        enableCache: true,
      },
    ),
  ]);

  // ─── 处理 macroSummary 结果 ──────────────────────────────────────
  let macroSummary = oldSummary;
  let openForeshadows: OpenForeshadow[] = oldNarrative?.openForeshadows ?? [];
  if (summaryRes.ok && summaryRes.data) {
    macroSummary = summaryRes.data.macroSummary;
    // 容错：openForeshadows 可能为 null/undefined（LLM 偶尔省略）
    const rawForeshadows = summaryRes.data.openForeshadows ?? [];
    openForeshadows = Array.isArray(rawForeshadows)
      ? rawForeshadows.map((f) => ({
          description: f.description,
          setupChapter: f.setupChapter,
          resolveChapter: f.resolveChapter ?? null,
        }))
      : oldNarrative?.openForeshadows ?? [];
    addUsage(totalUsage, summaryRes.totalUsage);
  } else {
    onProgress?.(`finalize:${chapterNumber}`, `⚠ 宏观主线更新失败，保留旧值（${summaryRes.errors.join('; ').slice(0, 120)}）`);
  }

  if (!summaryRes.ok && !stateRes.ok) {
    throw new Error(`严重错误：叙事状态与角色状态更新均失败，停止生成以防止状态损坏。错误信息：${summaryRes.errors[0]}`);
  }

  // ─── 处理 characterState 结果 ────────────────────────────────────
  if (stateRes.ok && stateRes.data) {
    // 容错：LLM 偶尔输出 null 而非 []，补成空数组
    const newState: CharacterState = {
      characters: stateRes.data.characters.map((c) => ({
        name: c.name,
        items: c.items ?? [],
        abilities: c.abilities ?? [],
        status: c.status ?? '未知',
        relationships: c.relationships ?? [],
        events: c.events ?? [],
      })),
    };
    updateCharacterState(db, projectId, newState);
    addUsage(totalUsage, stateRes.totalUsage);
  } else {
    onProgress?.(`finalize:${chapterNumber}`, `⚠ 角色状态更新失败，保留旧值（${stateRes.errors.join('; ').slice(0, 120)}）`);
  }

  // ─── arcSummary 固化（每 ARC_INTERVAL 章一份）──────────────────
  const arcSummaries: ArcSummary[] = oldNarrative?.arcSummaries ?? [];
  if (chapterNumber > 0 && chapterNumber % getRuntimeConfig().generation.arcInterval === 0) {
    arcSummaries.push({ upToChapter: chapterNumber, content: macroSummary.slice(0, 800) });
    onProgress?.(`finalize:${chapterNumber}`, `固化第${chapterNumber}章卷摘要`);
  }

  // ─── 持久化 narrative_state ──────────────────────────────────────
  const narrative: NarrativeState = {
    projectId,
    macroSummary,
    openForeshadows,
    arcSummaries,
    upToChapter: chapterNumber,
    updatedAt: new Date().toISOString(),
  };
  saveNarrativeState(db, narrative);

  onProgress?.(`finalize:${chapterNumber}`, `✓ 叙事状态已更新（伏笔：${openForeshadows.length} 个未回收）`);
  return { usage: totalUsage };
}
