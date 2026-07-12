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
import type { Beat, ChapterOutline } from './types.ts';
import { saveOutlines, countOutlines } from './store.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

const BLUEPRINT_TEMPERATURE = 0.5;
const STEP_TIMEOUT_MS = 180_000;

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
  if (total <= 3) return [1, Math.max(1, total - 2), 1];
  // act1/act3 至少 2，act2 取剩余（中段最长），保证合计 = total
  const act1 = Math.max(2, Math.round(total * 0.30));
  const act3 = Math.max(2, Math.round(total * 0.20));
  const act2 = Math.max(1, total - act1 - act3);
  // 修正溢出：若 act1+act3 已超 total，按比例缩
  if (act1 + act2 + act3 > total) {
    const overflow = (act1 + act2 + act3) - total;
    return [Math.max(1, act1 - Math.ceil(overflow / 2)), Math.max(1, act2), Math.max(1, act3 - Math.floor(overflow / 2))];
  }
  return [act1, act2, act3];
}

export async function generateBlueprint(opts: GenerateBlueprintOptions): Promise<GenerateBlueprintResult> {
  const { engine, db, projectId, plot, characters, totalChapters, onProgress } = opts;
  const totalUsage = { ...zeroUsage };

  // Checkpoint：已有 outline 则跳过
  const existing = countOutlines(db, projectId);
  if (existing > 0) {
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
      temperature: BLUEPRINT_TEMPERATURE, maxTokens: 2000, timeoutMs: STEP_TIMEOUT_MS,
      schema: BEAT_SCHEMA, maxAttempts: 3,
    });
    if (!res.ok || !res.data) throw new Error(`第${actNum}幕段落生成失败：${res.errors.join('; ')}`);
    addUsage(totalUsage, res.totalUsage);
    beats[actNum] = res.data.beats;
    onProgress?.(`act${actNum}-beats`, `✓ ${beats[actNum].length} 个段落`);
  }

  // ─── 第二层：段落 → 章节 ────────────────────────────────────────
  const allOutlines: Omit<ChapterOutline, 'id' | 'projectId' | 'status'>[] = [];
  let startNumber = 1;
  for (const actNum of [1, 2, 3] as const) {
    const budget = actBudget[actNum];
    const endNumber = startNumber + budget - 1;
    const beatsBlock = beats[actNum].map((b, i) =>
      `段落${i + 1}【${b.position}】目标：${b.goal}（张力${b.tension}）伏笔：${b.foreshadows.join('、') || '无'}`,
    ).join('\n');
    const charList = characters.map((c) => `${c.name}（${c.role}）`).join('、');
    const actForeshadows = plot.foreshadows
      .filter((f) => f.setupAct === actNum || f.resolveAct === actNum)
      .map((f) => `${f.description}（${f.setupAct === actNum ? '本幕埋设' : ''}${f.resolveAct === actNum ? '本幕回收' : ''}）`)
      .join('\n') || '（无）';

    onProgress?.(`act${actNum}-chapters`, `生成第${actNum}幕章节（${startNumber}-${endNumber}）...`);
    const promptTpl = loadPrompt('blueprint-chapters', PROMPTS_DIR);
    const prompt = promptTpl
      .replaceAll('{ACT}', String(actNum))
      .replaceAll('{CHAPTER_BUDGET}', String(budget))
      .replaceAll('{START_NUMBER}', String(startNumber))
      .replaceAll('{END_NUMBER}', String(endNumber))
      .replace('{BEATS}', beatsBlock)
      .replace('{CHARACTERS}', charList)
      .replace('{ACT_FORESHADOWS}', actForeshadows);

    const res = await callWithValidation<{ chapters: Array<{ number: number; title: string; beat: string; role: string; purpose: string; suspense_level: number; foreshadowing: string; twist_level: number; summary: string; }> }>(engine, prompt, {
      systemPrompt: '你是资深小说编辑。只输出 JSON。',
      temperature: BLUEPRINT_TEMPERATURE,
      // 按章节数动态分配 token 预算：每章摘要 ~300 token + JSON 结构开销。
      // 第二幕常 40+ 章，固定 6000 会截断（实测 40 章需 ~14000 token）。
      maxTokens: Math.max(6000, budget * 400),
      timeoutMs: STEP_TIMEOUT_MS,
      schema: { chapters: { type: 'array', min: budget, required: true, itemSpec: CHAPTER_ITEM_SCHEMA } },
      maxAttempts: 3,
    });
    if (!res.ok || !res.data) throw new Error(`第${actNum}幕章节生成失败：${res.errors.join('; ')}`);
    addUsage(totalUsage, res.totalUsage);

    for (const c of res.data.chapters) {
      allOutlines.push({
        number: c.number, title: c.title, act: actNum, beat: c.beat,
        role: c.role, purpose: c.purpose,
        suspenseLevel: c.suspense_level, foreshadowing: c.foreshadowing,
        twistLevel: c.twist_level, summary: c.summary,
      });
    }
    onProgress?.(`act${actNum}-chapters`, `✓ ${res.data.chapters.length} 章`);
    startNumber = endNumber + 1;
  }

  // 持久化（事务批量写入）
  saveOutlines(db, projectId, allOutlines);
  onProgress?.('done', `蓝图生成完成：${allOutlines.length} 章`);

  // 返回时补齐 id/projectId/status（store 写入时生成，这里读回）
  const { getAllOutlines } = await import('./store.ts');
  return { outlines: getAllOutlines(db, projectId), beats, usage: totalUsage };
}
