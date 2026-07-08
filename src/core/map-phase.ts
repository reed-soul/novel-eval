/**
 * Map 阶段：逐章评估（对齐设计文档 v2.2 第三章）
 *
 * 流程：章节列表 → 并发调用 LLM（每章产出 5 项含 excerpts）
 *       → 校验 → excerpts 回链定位 offset → 返回 Chapter[]
 */
import type { AIAgentAdapter } from '../engine/interface.ts';
import { callWithValidation, type SchemaSpec } from '../engine/json-validator.ts';
import { loadPrompt } from '../engine/bigmodel.ts';
import { linkExcerpt } from '../engine/quote-linker.ts';
import type { Chapter, MapChapterInput, MapChapterOutput, RawExcerpt, TokenUsage } from '../types.ts';

const CONCURRENCY = 5;

/** Map 输出的 schema 约束（对齐设计文档 10.1） */
const MAP_SCHEMA: SchemaSpec = {
  summary: { type: 'string', min: 20, max: 600, required: true },
  emotionalTension: { type: 'number', min: 0, max: 100, integer: true, required: true },
  keyEvents: { type: 'array', min: 1, max: 8, required: true, itemSpec: { type: 'string' } },
  characters: { type: 'array', max: 30, required: true, itemSpec: { type: 'string' } },
  excerpts: {
    type: 'array', min: 3, max: 5, required: true,
    itemSpec: {
      type: 'object', fields: {
        text: { type: 'string', min: 5, max: 200, required: true },
        dimension: { type: 'string', required: true },
        reason: { type: 'string', min: 4, max: 150, required: true },
      },
    },
  },
};

export interface MapPhaseResult {
  chapters: Chapter[];
  usage: TokenUsage;
  skippedChapters: string[];
}

export interface MapProgressCallback {
  (completed: number, total: number, chapterId: string, status: 'ok' | 'skipped' | 'failed'): void;
}

/** 并发限制器 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runMapPhase(
  engine: AIAgentAdapter,
  chapters: MapChapterInput[],
  onProgress?: MapProgressCallback,
): Promise<MapPhaseResult> {
  const promptTemplate = loadPrompt('map');
  const systemPrompt = '你是资深小说编辑，做逐章细读。只输出 JSON，不要任何额外文字。';

  const total = chapters.length;
  let completed = 0;
  const skippedChapters: string[] = [];
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, costRmb: 0, model: '', durationMs: 0 };

  const results = await mapWithConcurrency(chapters, CONCURRENCY, async (chapter) => {
    const userPrompt = promptTemplate
      .replace('{TITLE}', chapter.title)
      .replace('{CONTENT}', chapter.content);

    const res = await callWithValidation<MapChapterOutput>(engine, userPrompt, {
      systemPrompt,
      outputSchema: { type: 'object' },
      temperature: 0.3,
      maxTokens: 2000,
      timeoutMs: 120_000,
      schema: MAP_SCHEMA,
      maxAttempts: 3,
    });

    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    totalUsage.model = res.totalUsage.model;
    totalUsage.durationMs += res.totalUsage.durationMs;

    completed++;
    if (!res.ok || !res.data) {
      skippedChapters.push(chapter.id);
      onProgress?.(completed, total, chapter.id, 'skipped');
      // 降级：填空值，标注跳过
      return {
        ...chapter,
        summary: '（本章评估失败，已跳过）',
        emotionalTension: 0,
        keyEvents: [],
        characters: [],
        excerpts: [],
        wordCount: countChars(chapter.content),
        kind: 'main' as const,
      } as Chapter;
    }

    onProgress?.(completed, total, chapter.id, 'ok');
    return res.data as MapChapterOutput;
  });

  // 回链 excerpts（需要章节正文映射）
  const chapterTextMap = new Map(chapters.map((c) => [c.id, c.content]));
  const finalChapters: Chapter[] = results.map((out, i) => {
    const input = chapters[i];
    const mapOut = out as MapChapterOutput;
    const rawExcerpts: Array<RawExcerpt & { chapterId: string }> =
      (mapOut.excerpts ?? []).map((e) => ({ ...e, chapterId: input.id }));
    const linkedExcerpts = rawExcerpts.map((r) => linkExcerpt(r, r.chapterId, chapterTextMap));
    return {
      id: input.id,
      title: input.title,
      content: input.content,
      wordCount: countChars(input.content),
      kind: 'main',
      summary: mapOut.summary,
      emotionalTension: mapOut.emotionalTension,
      keyEvents: mapOut.keyEvents,
      characters: mapOut.characters,
      excerpts: linkedExcerpts,
    };
  });

  return { chapters: finalChapters, usage: totalUsage, skippedChapters };
}

function countChars(text: string): number {
  return [...text].filter((ch) => /\S/.test(ch)).length;
}
