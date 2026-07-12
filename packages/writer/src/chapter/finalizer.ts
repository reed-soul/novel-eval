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

const FINALIZE_TEMPERATURE = 0.4;
const STEP_TIMEOUT_MS = 120_000;
const ARC_INTERVAL = 10;  // 每 10 章固化一份 arcSummary

// ─── summary 更新的 schema（输出 macroSummary + openForeshadows）────────

const SUMMARY_SCHEMA: SchemaSpec = {
  macroSummary: { type: 'string', min: 50, required: true },
  openForeshadows: {
    type: 'array', itemSpec: {
      type: 'object', fields: {
        description: { type: 'string', min: 5, required: true },
        setupChapter: { type: 'number', min: 1, integer: true, required: true },
        resolveChapter: { type: 'number', min: 0, integer: true },
      },
    },
  },
};

// ─── characterState 重写的 schema（复用 M1 结构）──────────────────

const STATE_ENTRY_SCHEMA = {
  type: 'object' as const, fields: {
    name: { type: 'string' as const, required: true },
    items: { type: 'array' as const, itemSpec: { type: 'string' as const } },
    abilities: { type: 'array' as const, itemSpec: { type: 'string' as const } },
    status: { type: 'string' as const, required: true },
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
        temperature: FINALIZE_TEMPERATURE, maxTokens: 3000, timeoutMs: STEP_TIMEOUT_MS,
        schema: SUMMARY_SCHEMA, maxAttempts: 3,
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
        temperature: FINALIZE_TEMPERATURE, maxTokens: 2500, timeoutMs: STEP_TIMEOUT_MS,
        schema: STATE_SCHEMA, maxAttempts: 3,
      },
    ),
  ]);

  // ─── 处理 macroSummary 结果 ──────────────────────────────────────
  let macroSummary = oldSummary;
  let openForeshadows: OpenForeshadow[] = oldNarrative?.openForeshadows ?? [];
  if (summaryRes.ok && summaryRes.data) {
    macroSummary = summaryRes.data.macroSummary;
    openForeshadows = summaryRes.data.openForeshadows.map((f) => ({
      description: f.description,
      setupChapter: f.setupChapter,
      resolveChapter: f.resolveChapter ?? null,
    }));
    addUsage(totalUsage, summaryRes.totalUsage);
  } else {
    onProgress?.(`finalize:${chapterNumber}`, `⚠ 宏观主线更新失败，保留旧值`);
  }

  // ─── 处理 characterState 结果 ────────────────────────────────────
  if (stateRes.ok && stateRes.data) {
    const newState: CharacterState = { characters: stateRes.data.characters };
    updateCharacterState(db, projectId, newState);
    addUsage(totalUsage, stateRes.totalUsage);
  } else {
    onProgress?.(`finalize:${chapterNumber}`, `⚠ 角色状态更新失败，保留旧值`);
  }

  // ─── arcSummary 固化（每 ARC_INTERVAL 章一份）──────────────────
  const arcSummaries: ArcSummary[] = oldNarrative?.arcSummaries ?? [];
  if (chapterNumber > 0 && chapterNumber % ARC_INTERVAL === 0) {
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
