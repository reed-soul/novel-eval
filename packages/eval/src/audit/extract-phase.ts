/**
 * Audit 抽取阶段：逐章抽事件-因果图（对齐 map-phase 的并发/校验/降级模式）
 */
import type { AIAgentAdapter, ChapterInput } from '@novel-eval/shared';
import { callWithValidation, type SchemaSpec } from '@novel-eval/shared';
import { loadPrompt, mapWithConcurrency, zeroUsage } from '@novel-eval/shared';
import type { TokenUsage } from '../types.ts';
import type { AuditEdgeSpec, AuditEvent, ChapterExtraction } from './types.ts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '..', 'prompts');

const CONCURRENCY = 5;

const EVENT_ITEM: SchemaSpec = {
  localId: { type: 'string', required: true },
  description: { type: 'string', min: 6, max: 120, required: true },
  participants: { type: 'array', itemSpec: { type: 'string' } },
  storyline: { type: 'string', required: true },
  timeMarker: { type: 'string' },
  location: { type: 'string' },
  isCoincidence: { type: 'boolean' },
  isEvidence: { type: 'boolean' },
  quote: { type: 'string', min: 8, max: 200, required: true },
};

const EXTRACT_SCHEMA: SchemaSpec = {
  events: {
    type: 'array', min: 1, max: 40, required: true,
    itemSpec: { type: 'object', fields: EVENT_ITEM },
  },
  edges: {
    type: 'array', required: true,
    itemSpec: {
      type: 'object', fields: {
        fromLocalId: { type: 'string', required: true },
        toLocalId: { type: 'string', required: true },
        type: { type: 'string', required: true },
        explanation: { type: 'string', min: 4, required: true },
      },
    },
  },
  characters: { type: 'array', itemSpec: { type: 'string' } },
};

export interface ExtractPhaseResult {
  extractions: Map<string, ChapterExtraction>;
  usage: TokenUsage;
  failedChapterIds: string[];
}

export type ExtractProgressCallback = (
  completed: number,
  total: number,
  chapterId: string,
  status: 'ok' | 'failed',
) => void;

/** 过滤：丢掉引用了不存在事件 / 非法边类型的边 */
function sanitizeEdges(edges: AuditEdgeSpec[], validIds: Set<string>): AuditEdgeSpec[] {
  const EDGE_TYPES = new Set(['physical', 'motivational', 'enabling', 'temporal']);
  return edges.filter(
    (e) => validIds.has(e.fromLocalId) && validIds.has(e.toLocalId)
      && e.fromLocalId !== e.toLocalId
      && EDGE_TYPES.has(e.type as AuditEdgeSpec['type']),
  ) as AuditEdgeSpec[];
}

function sanitizeEvents(events: AuditEvent[]): AuditEvent[] {
  return events.map((ev) => ({
    ...ev,
    participants: Array.isArray(ev.participants) ? ev.participants : [],
    storyline: ev.storyline?.trim() || '主线',
    yearHint: typeof ev.yearHint === 'number' && Number.isFinite(ev.yearHint) ? ev.yearHint : null,
    isCoincidence: ev.isCoincidence === true,
    isEvidence: ev.isEvidence === true,
  }));
}

export async function runExtractPhase(
  engine: AIAgentAdapter,
  chapters: ChapterInput[],
  onProgress?: ExtractProgressCallback,
): Promise<ExtractPhaseResult> {
  const promptTemplate = loadPrompt('audit-extract', PROMPTS_DIR);
  const systemPrompt = '你是剧情逻辑审计师，做章级事件-因果抽取。只输出 JSON，不要任何额外文字。';

  const total = chapters.length;
  let completed = 0;
  const failedChapterIds: string[] = [];
  const totalUsage: TokenUsage = { ...zeroUsage };

  const results = await mapWithConcurrency(chapters, CONCURRENCY, async (chapter) => {
    const userPrompt = promptTemplate
      .replace('{TITLE}', chapter.title)
      .replace('{CONTENT}', chapter.content);

    const res = await callWithValidation<ChapterExtraction>(engine, userPrompt, {
      systemPrompt,
      outputSchema: { type: 'object' },
      temperature: 0.2,
      maxTokens: 6000,
      timeoutMs: 180_000,
      schema: EXTRACT_SCHEMA,
      maxAttempts: 3,
    });

    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    totalUsage.model = res.totalUsage.model;
    totalUsage.durationMs += res.totalUsage.durationMs;

    completed++;
    if (!res.ok || !res.data) {
      failedChapterIds.push(chapter.id);
      onProgress?.(completed, total, chapter.id, 'failed');
      return null;
    }
    onProgress?.(completed, total, chapter.id, 'ok');

    const events = sanitizeEvents(res.data.events);
    const validIds = new Set(events.map((e) => e.localId));
    return {
      events,
      edges: sanitizeEdges(res.data.edges ?? [], validIds),
      characters: Array.isArray(res.data.characters) ? res.data.characters : [],
    } satisfies ChapterExtraction;
  });

  const extractions = new Map<string, ChapterExtraction>();
  results.forEach((out, i) => {
    if (out) extractions.set(chapters[i].id, out);
  });

  return { extractions, usage: totalUsage, failedChapterIds };
}
