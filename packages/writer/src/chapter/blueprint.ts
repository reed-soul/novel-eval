/**
 * 章节蓝图生成器 — 两层拆分（幕→段落→章节）
 *
 * 第一层：plotArchitecture 三幕 → 段落（beats）。生成后立即持久化。
 * 第二层：每幕的 beats → 该幕的章节蓝图（approved outline revision 1）。
 *
 * 重跑时优先读取已持久化 beats，不重新生成。
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AIAgentAdapter } from '@novel-eval/shared';
import { callWithValidation, loadPrompt, addUsage, zeroUsage, type SchemaSpec } from '@novel-eval/shared';

import type { PlotArchitecture, CharacterDynamic } from '../bible/types.ts';
import type { DB } from '../db.ts';
import { outlineId, projectId } from '../domain/ids.ts';
import {
  PlanningRepository,
  type BeatRecord,
  type BibleDocument,
} from '../repositories/planning-repository.ts';
import { getRuntimeConfig } from '../runtime-config.ts';
import type { Beat, ChapterOutline } from './legacy-types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

const BEAT_SCHEMA: SchemaSpec = {
  beats: {
    type: 'array',
    min: 2,
    max: 4,
    required: true,
    itemSpec: {
      type: 'object',
      fields: {
        position: { type: 'string', required: true },
        goal: { type: 'string', min: 10, required: true },
        foreshadows: { type: 'array', itemSpec: { type: 'string' } },
        tension: { type: 'number', min: 0, max: 10, integer: true, required: true },
      },
    },
  },
};

const CHAPTER_ITEM_SCHEMA = {
  type: 'object' as const,
  fields: {
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

function beatFromRecord(record: BeatRecord): Beat {
  const content = record.content;
  const position = typeof content.position === 'string' ? content.position : '推进';
  const goal = typeof content.goal === 'string' ? content.goal : '';
  const tension = typeof content.tension === 'number' ? content.tension : 5;
  const foreshadowsRaw = content.foreshadows;
  const foreshadows = Array.isArray(foreshadowsRaw)
    ? foreshadowsRaw.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    position: position as Beat['position'],
    goal,
    foreshadows,
    tension,
  };
}

function groupBeatsByAct(records: BeatRecord[]): Record<1 | 2 | 3, Beat[]> {
  const beats: Record<1 | 2 | 3, Beat[]> = { 1: [], 2: [], 3: [] };
  for (const record of records) {
    if (record.act === 1 || record.act === 2 || record.act === 3) {
      beats[record.act].push(beatFromRecord(record));
    }
  }
  return beats;
}

export async function generateBlueprint(opts: GenerateBlueprintOptions): Promise<GenerateBlueprintResult> {
  const { engine, db, plot, characters, totalChapters, onProgress } = opts;
  const id = projectId(opts.projectId);
  const planning = new PlanningRepository(db);
  const totalUsage = { ...zeroUsage };

  const bible = planning.getActiveBibleForProject(id);
  if (!bible) {
    throw new Error('bible 未完成，无法生成蓝图。请先运行 write init。');
  }

  const existingCount = planning.countOutlines(id);
  if (existingCount >= totalChapters) {
    onProgress?.('blueprint', `（已完成 ${existingCount} 章，跳过）`);
    return {
      outlines: planning.listOutlinesForCli(id),
      beats: groupBeatsByAct(planning.listBeats(id)),
      usage: { ...zeroUsage },
    };
  }

  const [act1Count, act2Count, act3Count] = splitChaptersByAct(totalChapters);
  const actBudget = { 1: act1Count, 2: act2Count, 3: act3Count } as const;
  const acts = [plot.act1, plot.act2, plot.act3] as const;
  const beats: Record<1 | 2 | 3, Beat[]> = { 1: [], 2: [], 3: [] };

  const persisted = planning.listBeats(id);
  const persistedByAct = groupBeatsByAct(persisted);
  let nextBeatPosition = persisted.length > 0
    ? Math.max(...persisted.map((b) => b.position)) + 1
    : 1;

  for (const actNum of [1, 2, 3] as const) {
    if (persistedByAct[actNum].length > 0) {
      beats[actNum] = persistedByAct[actNum];
      onProgress?.(`act${actNum}-beats`, `（第${actNum}幕段落已持久化，跳过）`);
      continue;
    }

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
      temperature: getRuntimeConfig().generation.temperatures.blueprint,
      maxTokens: 2000,
      timeoutMs: getRuntimeConfig().generation.timeouts.blueprintMs,
      schema: BEAT_SCHEMA,
      maxAttempts: 3,
    });
    if (!res.ok || !res.data) {
      throw new Error(`第${actNum}幕段落生成失败：${res.errors.join('; ')}`);
    }
    addUsage(totalUsage, res.totalUsage);
    beats[actNum] = res.data.beats;

    const now = new Date().toISOString();
    const records: BeatRecord[] = beats[actNum].map((beat, index) => ({
      id: randomUUID(),
      projectId: id,
      bibleRevisionId: bible.id,
      position: nextBeatPosition + index,
      act: actNum,
      content: {
        position: beat.position,
        goal: beat.goal,
        foreshadows: beat.foreshadows,
        tension: beat.tension,
      } as unknown as BibleDocument,
      createdAt: now,
    }));
    planning.saveBeats(records);
    nextBeatPosition += records.length;
    onProgress?.(`act${actNum}-beats`, `✓ ${beats[actNum].length} 个段落（已持久化）`);
  }

  const CHAPTER_BATCH_SIZE = 12;
  let startNumber = 1;
  for (const actNum of [1, 2, 3] as const) {
    const budget = actBudget[actNum];
    const actBeats = beats[actNum];
    const charList = characters.map((c) => `${c.name}（${c.role}）`).join('、');
    const actForeshadows = plot.foreshadows
      .filter((f) => f.setupAct === actNum || f.resolveAct === actNum)
      .map((f) => `${f.description}（${f.setupAct === actNum ? '本幕埋设' : ''}${f.resolveAct === actNum ? '本幕回收' : ''}）`)
      .join('\n') || '（无）';

    const batchCount = Math.max(1, Math.ceil(budget / CHAPTER_BATCH_SIZE));
    const chaptersPerBatch = Math.ceil(budget / batchCount);
    const promptTpl = loadPrompt('blueprint-chapters', PROMPTS_DIR);

    for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
      const batchStart = startNumber + batchIdx * chaptersPerBatch;
      const remaining = budget - batchIdx * chaptersPerBatch;
      const batchBudget = Math.min(chaptersPerBatch, remaining);
      const batchEnd = batchStart + batchBudget - 1;

      if (planning.hasOutlineAtPosition(id, batchStart)) {
        onProgress?.(`act${actNum}-chapters`, `（第${actNum}幕 ${batchStart}-${batchEnd} 已存在，跳过）`);
        continue;
      }

      const beatStartIdx = Math.floor((batchIdx / batchCount) * actBeats.length);
      const beatEndIdx = Math.floor(((batchIdx + 1) / batchCount) * actBeats.length);
      const batchBeats = actBeats.slice(beatStartIdx, Math.max(beatEndIdx, beatStartIdx + 1));
      const beatsBlock = batchBeats.map((b, i) =>
        `段落${beatStartIdx + i + 1}【${b.position}】目标：${b.goal}（张力${b.tension}）伏笔：${b.foreshadows.join('、') || '无'}`,
      ).join('\n');

      onProgress?.(
        `act${actNum}-chapters`,
        `生成第${actNum}幕章节（${batchStart}-${batchEnd}）${batchCount > 1 ? `[批次 ${batchIdx + 1}/${batchCount}]` : ''}...`,
      );
      const prompt = promptTpl
        .replaceAll('{ACT}', String(actNum))
        .replaceAll('{CHAPTER_BUDGET}', String(batchBudget))
        .replaceAll('{START_NUMBER}', String(batchStart))
        .replaceAll('{END_NUMBER}', String(batchEnd))
        .replace('{BEATS}', beatsBlock)
        .replace('{CHARACTERS}', charList)
        .replace('{ACT_FORESHADOWS}', actForeshadows);

      const res = await callWithValidation<{
        chapters: Array<{
          number: number;
          title: string;
          beat: string;
          role: string;
          purpose: string;
          suspense_level: number;
          foreshadowing: string;
          twist_level: number;
          summary: string;
        }>;
      }>(engine, prompt, {
        systemPrompt: '你是资深小说编辑。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.blueprint,
        maxTokens: Math.max(6000, batchBudget * 400),
        timeoutMs: Math.max(getRuntimeConfig().generation.timeouts.blueprintMs, batchBudget * 6000),
        schema: {
          chapters: {
            type: 'array',
            min: batchBudget,
            required: true,
            itemSpec: CHAPTER_ITEM_SCHEMA,
          },
        },
        maxAttempts: 3,
      });
      if (!res.ok || !res.data) {
        throw new Error(`第${actNum}幕章节生成失败（批次 ${batchIdx + 1}）：${res.errors.join('; ')}`);
      }
      addUsage(totalUsage, res.totalUsage);

      const now = new Date().toISOString();
      for (const chapter of res.data.chapters) {
        const oid = outlineId(randomUUID());
        planning.saveApprovedOutline({
          outline: {
            id: oid,
            projectId: id,
            position: chapter.number,
            createdAt: now,
            updatedAt: now,
          },
          revision: {
            id: randomUUID(),
            revisionNumber: 1,
            title: chapter.title,
            content: {
              summary: chapter.summary,
              beats: [chapter.beat],
              act: actNum,
              role: chapter.role,
              purpose: chapter.purpose,
              suspenseLevel: chapter.suspense_level,
              foreshadowing: chapter.foreshadowing,
              twistLevel: chapter.twist_level,
              beatLabel: chapter.beat,
            },
            createdAt: now,
          },
        });
      }
      onProgress?.(
        `act${actNum}-chapters`,
        `✓ 第${actNum}幕累计 ${res.data.chapters.length} 章（本批）`,
      );
    }
    startNumber += budget;
  }

  onProgress?.('done', `蓝图生成完成：${planning.countOutlines(id)} 章`);
  return {
    outlines: planning.listOutlinesForCli(id),
    beats,
    usage: totalUsage,
  };
}
