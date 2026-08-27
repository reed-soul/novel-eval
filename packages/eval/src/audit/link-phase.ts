/**
 * Audit 建链阶段：全局 LLM 调用，补跨章边 + 关键事件前置嫌疑
 */
import type { AIAgentAdapter } from '@novel-eval/shared';
import { callWithValidation, type SchemaSpec } from '@novel-eval/shared';
import { loadPrompt, zeroUsage } from '@novel-eval/shared';
import type { TokenUsage } from '../types.ts';
import type { CrossEdge, GraphEdge, GraphNode, LinkResult, SuspicionKind } from './types.ts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '..', 'prompts');

const LINK_SCHEMA: SchemaSpec = {
  edges: {
    type: 'array', required: true,
    itemSpec: {
      type: 'object', fields: {
        fromGlobalId: { type: 'string', required: true },
        toGlobalId: { type: 'string', required: true },
        type: { type: 'string', required: true },
        explanation: { type: 'string', min: 4, required: true },
      },
    },
  },
  suspicions: {
    type: 'array', required: true,
    itemSpec: {
      type: 'object', fields: {
        globalEventId: { type: 'string', required: true },
        kind: { type: 'string', required: true },
        note: { type: 'string', min: 6, required: true },
      },
    },
  },
};

const EDGE_TYPES = new Set(['physical', 'motivational', 'enabling', 'temporal']);
const SUSPICION_KINDS = new Set(['missing-antecedent', 'convenience', 'unclear']);

export interface LinkPhaseResult {
  edges: GraphEdge[];
  suspicions: LinkResult['suspicions'];
  usage: TokenUsage;
}

/** 全局事件 → 清单行（供 prompt 注入）。上限保护：超长截断。 */
export function formatEventList(nodes: GraphNode[], maxChars = 24_000): string {
  const lines: string[] = [];
  let length = 0;
  for (const n of nodes) {
    const tags = [
      n.event.isEvidence ? '〔证据〕' : '',
      n.event.isCoincidence ? '〔巧合〕' : '',
    ].join('');
    const line = `${n.globalId} [${n.event.storyline}${n.event.yearHint ? ` ${n.event.yearHint}` : ''}]${tags} ${n.event.description}｜人物:${n.event.participants.join('、') || '无'}`;
    if (length + line.length > maxChars) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n');
}

export async function runLinkPhase(
  engine: AIAgentAdapter,
  nodes: GraphNode[],
): Promise<LinkPhaseResult> {
  const usage: TokenUsage = { ...zeroUsage };
  const eventsBlock = formatEventList(nodes);
  const prompt = loadPrompt('audit-link', PROMPTS_DIR).replace('{EVENTS}', eventsBlock);

  const res = await callWithValidation<LinkResult>(engine, prompt, {
    systemPrompt: '你是剧情逻辑审计师，做全书跨章接线。只输出 JSON。',
    outputSchema: { type: 'object' },
    temperature: 0.2,
    maxTokens: 6000,
    timeoutMs: 180_000,
    schema: LINK_SCHEMA,
    maxAttempts: 3,
  });

  usage.inputTokens += res.totalUsage.inputTokens;
  usage.outputTokens += res.totalUsage.outputTokens;
  usage.costRmb += res.totalUsage.costRmb;
  usage.model = res.totalUsage.model;
  usage.durationMs += res.totalUsage.durationMs;

  if (!res.ok || !res.data) {
    return { edges: [], suspicions: [], usage };
  }

  const nodeIdSet = new Set(nodes.map((n) => n.globalId));
  const edges: GraphEdge[] = (res.data.edges ?? [])
    .filter((e: CrossEdge) =>
      nodeIdSet.has(e.fromGlobalId)
      && nodeIdSet.has(e.toGlobalId)
      && e.fromGlobalId !== e.toGlobalId
      && EDGE_TYPES.has(e.type))
    .map((e: CrossEdge) => ({
      from: e.fromGlobalId,
      to: e.toGlobalId,
      type: e.type as GraphEdge['type'],
      explanation: e.explanation,
      origin: 'cross' as const,
    }));

  const suspicions = (res.data.suspicions ?? [])
    .filter((s) => nodeIdSet.has(s.globalEventId) && SUSPICION_KINDS.has(s.kind))
    .map((s) => ({
      globalEventId: s.globalEventId,
      kind: s.kind as SuspicionKind,
      note: s.note,
    }));

  return { edges, suspicions, usage };
}
