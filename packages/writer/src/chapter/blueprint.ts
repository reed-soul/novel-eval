/**
 * 章节蓝图生成器 — 两层拆分（幕→段落→章节）
 *
 * 第一层：plotArchitecture 三幕 → 段落（beats）。3 次调用，每幕一次。
 *   beats 是节奏骨架（铺垫/推进/转折/高潮），强制结构严谨。
 * 第二层：每幕的 beats → 该幕的章节蓝图。3 次调用，每幕一次。
 *
 * 共 6 次 LLM 调用。JSON Schema 强约束 + callWithValidation。
 * Checkpoint：写入 chapter_outline 表，重跑时已有则跳过。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIAgentAdapter } from '@novel-eval/shared';
import { callWithValidation, loadPrompt, addUsage, zeroUsage, type SchemaSpec } from '@novel-eval/shared';
import type { DB } from '../db.ts';
import type { PlotArchitecture, CharacterDynamic } from '../bible/types.ts';
import type { Beat, ChapterOutline } from './legacy-types.ts';
import { saveOutlines, countOutlines, getOutline } from './store.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

import { getRuntimeConfig } from '../runtime-config.ts';

// ─── 第一层 schema：幕 → 段落 ────────────────────────────────────

const BEAT_SCHEMA: SchemaSpec = {
  beats: {
    type: 'array', min: 2, max: 4, required: true,
    itemSpec: {
      type: 'object', fields: {
        position: { type: 'string', required: true },
        goal: { type: 'string', min: 10, required: true },
        foreshadows: { type: 'array', itemSpec: { type: 'string' } },
        tension: { type: 'number', min: 0, max: 10, integer: true, required: true },
      },
    },
  },
};

// ─── 第二层 schema：段落 → 章节 ──────────────────────────────────

const CHAPTER_ITEM_SCHEMA = {
  type: 'object' as const, fields: {
    number: { type: 'number' as const, min: 1, integer: true, required: true },
    title: { type: 'string' as const, min: 2, max: 40, required: true },
    beat: { type: 'string' as const, required: true },
    role: { type: 'string' as const, min: 4, required: true },
    purpose: { type: 'string' as const, min: 10, required: true },
    suspense_level: { type: 'number' as const, min: 0, max: 10, integer: true, required: true },
    foreshadowing: { type: 'string' as const, required: true },
    twist_level: { type: 'number' as const, min: 0, max: 10, integer: true, required: true },
    summary: { type: 'string' as const, min: 30, max: 400, required: true },
  },
};
const CHAPTERS_SCHEMA: SchemaSpec = {
  chapters: { type: 'array', required: true, itemSpec: CHAPTER_ITEM_SCHEMA },
};

// ─── 主入口 ──────────────────────────────────────────────────────

export interface GenerateBlueprintOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  plot: PlotArchitecture;
  characters: CharacterDynamic[];
  totalChapters: number;
  onProgress?: (step: string, msg: string) => void;
}

export interface GenerateBlueprintResult {
  outlines: ChapterOutline[];
  beats: Record<1 | 2 | 3, Beat[]>;
  usage: import('@novel-eval/shared').TokenUsage;
}

/** 章数按 30%/50%/20% 分配到三幕，保证合计 = total */
function splitChaptersByAct(total: number): [number, number, number] {
  if (total <= 0) return [0, 0, 0];
  if (total === 1) return [1, 0, 0];
  if (total === 2) return [1, 1, 0];
  if (total === 3) return [1, 1, 1];

  let act1 = Math.round(total * 0.30);
  let act3 = Math.round(total * 0.20);
  
  if (act1 < 2) act1 = 2;
  if (act3 < 2) act3 = 2;
  
  let act2 = total - act1 - act3;
  if (act2 < 1) {
    act2 = 1;
    if (act1 >= act3) act1 = total - act2 - act3;
    else act3 = total - act1 - act2;
  }
  
  return [act1, act2, act3];
}

export async function generateBlueprint(opts: GenerateBlueprintOptions): Promise<GenerateBlueprintResult> {
  const { engine, db, projectId, plot, characters, totalChapters, onProgress } = opts;
  const totalUsage = { ...zeroUsage };

  // Checkpoint：仅当 outline 已达目标章数才整体跳过。
  // 若只是部分完成（如长任务中断后重跑），不跳过——进入下面的批次级续传，
  // 每批开头会检测该批起始章是否已落库并跳过，实现真正的断点续传。
  const existing = countOutlines(db, projectId);
  if (existing >= totalChapters) {
    onProgress?.('blueprint', `（已完成 ${existing} 章，跳过）`);
    const { getAllOutlines } = await import('./store.ts');
    return { outlines: getAllOutlines(db, projectId), beats: {} as Record<1 | 2 | 3, Beat[]>, usage: { ...zeroUsage } };
  }

  const [act1Count, act2Count, act3Count] = splitChaptersByAct(totalChapters);
  const actBudget = { 1: act1Count, 2: act2Count, 3: act3Count } as const;
  const acts = [plot.act1, plot.act2, plot.act3] as const;
  const beats: Record<1 | 2 | 3, Beat[]> = { 1: [], 2: [], 3: [] };

  // ─── 第一层：幕 → 段落 ──────────────────────────────────────────
  for (const actNum of [1, 2, 3] as const) {
    const act = acts[actNum - 1];
    const actForeshadows = plot.foreshadows
      .filter((f) => f.setupAct === actNum || f.resolveAct === actNum)
      .map((f) => `${f.setupAct === actNum ? '埋设' : ''}${f.resolveAct === actNum ? '回收' : ''}：${f.description}`)
      .filter((s) => s.length > 0);

    onProgress?.(`act${actNum}-beats`, `生成第${actNum}幕段落...`);
    const promptTpl = loadPrompt('blueprint-act', PROMPTS_DIR);
    const prompt = promptTpl
      .replace('{ACT}', String(actNum))
      .replace('{ACT_SETUP}', act.setup)
      .replace('{ACT_CONFLICTS}', act.conflicts.join('；'))
      .replace('{ACT_CLIMAX}', act.climax)
      .replace('{ACT_FORESHADOWS}', actForeshadows.length ? actForeshadows.join('\n') : '（本幕无显式伏笔）')
      .replace('{CHAPTER_BUDGET}', String(actBudget[actNum]));

    const res = await callWithValidation<{ beats: Beat[] }>(engine, prompt, {
      systemPrompt: '你是资深小说结构师。只输出 JSON。',
      temperature: getRuntimeConfig().generation.temperatures.blueprint, maxTokens: 2000, timeoutMs: getRuntimeConfig().generation.timeouts.blueprintMs,
      schema: BEAT_SCHEMA, maxAttempts: 3,
    });
    if (!res.ok || !res.data) throw new Error(`第${actNum}幕段落生成失败：${res.errors.join('; ')}`);
    addUsage(totalUsage, res.totalUsage);
    beats[actNum] = res.data.beats;
    onProgress?.(`act${actNum}-beats`, `✓ ${beats[actNum].length} 个段落`);
  }

  // ─── 第二层：段落 → 章节（大幕自动分批，避免单次调用超时/截断）─────
  // 一幕章数 > BATCH_SIZE 时，按 beats 均分到多批，每批单独调用 LLM。
  // 实测智谱 GLM-5.2 生成 17 章 JSON 仍会 abort，BATCH_SIZE 收紧到 12，
  // 配合更宽的超时（每章 ~6 秒），保证单批稳稳落在超时区内。
  const CHAPTER_BATCH_SIZE = 12;
  const allOutlines: Omit<ChapterOutline, 'id' | 'projectId' | 'status'>[] = [];
  let startNumber = 1;
  for (const actNum of [1, 2, 3] as const) {
    const budget = actBudget[actNum];
    const actBeats = beats[actNum];
    const charList = characters.map((c) => `${c.name}（${c.role}）`).join('、');
    const actForeshadows = plot.foreshadows
      .filter((f) => f.setupAct === actNum || f.resolveAct === actNum)
      .map((f) => `${f.description}（${f.setupAct === actNum ? '本幕埋设' : ''}${f.resolveAct === actNum ? '本幕回收' : ''}）`)
      .join('\n') || '（无）';

    // 计算本幕需要几批
    const batchCount = Math.max(1, Math.ceil(budget / CHAPTER_BATCH_SIZE));
    const chaptersPerBatch = Math.ceil(budget / batchCount);
    const promptTpl = loadPrompt('blueprint-chapters', PROMPTS_DIR);

    for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
      const batchStart = startNumber + batchIdx * chaptersPerBatch;
      const remaining = budget - batchIdx * chaptersPerBatch;
      const batchBudget = Math.min(chaptersPerBatch, remaining);
      const batchEnd = batchStart + batchBudget - 1;

      // 断点续传：若该批起始章已落库，说明上一轮已生成，跳过本批
      if (getOutline(db, projectId, batchStart)) {
        onProgress?.(`act${actNum}-chapters`, `（第${actNum}幕 ${batchStart}-${batchEnd} 已存在，跳过）`);
        continue;
      }

      // 本批覆盖的 beats：按批次比例切分（保持叙事连续）
      const beatStartIdx = Math.floor((batchIdx / batchCount) * actBeats.length);
      const beatEndIdx = Math.floor(((batchIdx + 1) / batchCount) * actBeats.length);
      const batchBeats = actBeats.slice(beatStartIdx, Math.max(beatEndIdx, beatStartIdx + 1));
      const beatsBlock = batchBeats.map((b, i) =>
        `段落${beatStartIdx + i + 1}【${b.position}】目标：${b.goal}（张力${b.tension}）伏笔：${b.foreshadows.join('、') || '无'}`,
      ).join('\n');

      onProgress?.(`act${actNum}-chapters`, `生成第${actNum}幕章节（${batchStart}-${batchEnd}）${batchCount > 1 ? `[批次 ${batchIdx + 1}/${batchCount}]` : ''}...`);
      const prompt = promptTpl
        .replaceAll('{ACT}', String(actNum))
        .replaceAll('{CHAPTER_BUDGET}', String(batchBudget))
        .replaceAll('{START_NUMBER}', String(batchStart))
        .replaceAll('{END_NUMBER}', String(batchEnd))
        .replace('{BEATS}', beatsBlock)
        .replace('{CHARACTERS}', charList)
        .replace('{ACT_FORESHADOWS}', actForeshadows);

      const res = await callWithValidation<{ chapters: Array<{ number: number; title: string; beat: string; role: string; purpose: string; suspense_level: number; foreshadowing: string; twist_level: number; summary: string; }> }>(engine, prompt, {
        systemPrompt: '你是资深小说编辑。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.blueprint,
        // 按本批章节数动态分配 token 预算：每章摘要 ~300 token + JSON 结构开销。
        maxTokens: Math.max(6000, batchBudget * 400),
        // 按章数动态分配超时：基础 blueprintMs + 每章 ~6 秒（智谱生成 JSON 较慢，留足余量）。
        timeoutMs: Math.max(getRuntimeConfig().generation.timeouts.blueprintMs, batchBudget * 6000),
        schema: { chapters: { type: 'array', min: batchBudget, required: true, itemSpec: CHAPTER_ITEM_SCHEMA } },
        maxAttempts: 3,
      });
      if (!res.ok || !res.data) throw new Error(`第${actNum}幕章节生成失败（批次 ${batchIdx + 1}）：${res.errors.join('; ')}`);
      addUsage(totalUsage, res.totalUsage);

      const batchOutlines: Omit<ChapterOutline, 'id' | 'projectId' | 'status'>[] = res.data.chapters.map((c) => ({
        number: c.number, title: c.title, act: actNum, beat: c.beat,
        role: c.role, purpose: c.purpose,
        suspenseLevel: c.suspense_level, foreshadowing: c.foreshadowing,
        twistLevel: c.twist_level, summary: c.summary,
      }));
      // 增量落盘：每批生成完立即写库，中断后重跑可从断点续传
      saveOutlines(db, projectId, batchOutlines);
      allOutlines.push(...batchOutlines);
      onProgress?.(`act${actNum}-chapters`, `✓ 第${actNum}幕累计 ${allOutlines.filter((o) => o.act === actNum).length} 章`);
    }
    startNumber += budget;
  }

  // 持久化已在每批生成后增量完成（saveOutlines per batch），此处无需重复写入。
  onProgress?.('done', `蓝图生成完成：${allOutlines.length} 章`);

  // 返回时补齐 id/projectId/status（store 写入时生成，这里读回）
  const { getAllOutlines } = await import('./store.ts');
  return { outlines: getAllOutlines(db, projectId), beats, usage: totalUsage };
}
