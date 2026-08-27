/**
 * Audit 探针阶段：公平清单（Van Dine/Knox）‖ 合乎世情（陪审员故事模型）并行
 */
import type { AIAgentAdapter } from '@novel-eval/shared';
import { callWithValidation, type FieldSpec, type SchemaSpec } from '@novel-eval/shared';
import { loadPrompt, zeroUsage } from '@novel-eval/shared';
import type { TokenUsage } from '../types.ts';
import type { FairPlayResult, GraphNode, PlausibilityResult, ProbeHole } from './types.ts';
import { formatEventList } from './link-phase.ts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '..', 'prompts');

const HOLE_ITEM: FieldSpec = {
  type: 'object',
  fields: {
    type: { type: 'string', required: true },
    severity: { type: 'string', required: true },
    title: { type: 'string', min: 6, required: true },
    detail: { type: 'string', min: 20, required: true },
    evidenceChapterIds: { type: 'array', itemSpec: { type: 'string' } },
    evidenceQuote: { type: 'string' },
    suggestedFix: { type: 'string', min: 4, required: true },
    fixCost: { type: 'string' },
  },
};

const FAIRPLAY_SCHEMA: SchemaSpec = {
  clues: {
    type: 'array', min: 1, required: true,
    itemSpec: {
      type: 'object', fields: {
        name: { type: 'string', required: true },
        plantedAt: { type: 'string', required: true },
        retrievedAt: { type: 'string', required: true },
        costPaid: { type: 'string' },
        fair: { type: 'boolean', required: true },
        note: { type: 'string' },
      },
    },
  },
  antagonistFirstMention: { type: 'string' },
  antagonistFirstMeaningfulRole: { type: 'string' },
  coincidenceAudit: {
    type: 'object', required: true, fields: {
      count: { type: 'number', min: 0, integer: true, required: true },
      note: { type: 'string' },
    },
  },
  holes: { type: 'array', itemSpec: HOLE_ITEM },
};

const PLAUSIBILITY_SCHEMA: SchemaSpec = {
  probes: {
    type: 'array', min: 1, required: true,
    itemSpec: {
      type: 'object', fields: {
        eventRef: { type: 'string', required: true },
        readerQuestion: { type: 'string', min: 8, required: true },
        answered: { type: 'boolean', required: true },
        whereNote: { type: 'string' },
      },
    },
  },
  endingCheck: {
    type: 'object', required: true, fields: {
      punishmentFits: { type: 'boolean', required: true },
      note: { type: 'string', required: true },
      alternativeExplanation: { type: 'string' },
    },
  },
  holes: { type: 'array', itemSpec: HOLE_ITEM },
};

export interface ProbePhaseResult {
  fairplay: FairPlayResult | null;
  plausibility: PlausibilityResult | null;
  usage: TokenUsage;
  failures: string[];
}

export async function runProbePhase(
  engine: AIAgentAdapter,
  args: {
    nodes: GraphNode[];
    mainChainIds: Set<string>;
    climaxChapterIndex: number;
    genre?: string;
  },
): Promise<ProbePhaseResult> {
  const usage: TokenUsage = { ...zeroUsage };
  const failures: string[] = [];

  const eventsBlock = formatEventList(args.nodes);
  const mainChainNodes = args.nodes.filter((n) => args.mainChainIds.has(n.globalId));
  const mainChainBlock = mainChainNodes
    .map((n) => {
      const tags = [
        n.event.isEvidence ? '〔证据〕' : '',
        n.event.isCoincidence ? '〔巧合〕' : '',
      ].join('');
      return `${n.globalId} [${n.event.storyline}]${tags} ${n.event.description}`;
    })
    .join('\n');
  // 结局探针输入：高潮章 + 最后一章（尾声常在最后一章，追责/收束线索不能漏）
  const lastIndex = args.nodes.reduce((m, n) => Math.max(m, n.chapterIndex), 0);
  const endingNodes = args.nodes.filter(
    (n) => n.chapterIndex === args.climaxChapterIndex || n.chapterIndex === lastIndex,
  );
  const endingBlock = endingNodes
    .map((n) => `${n.globalId} ${n.event.description}｜「${n.event.quote}」`)
    .join('\n');

  const fairplayPrompt = loadPrompt('audit-fairplay', PROMPTS_DIR)
    .replace('{GENRE}', args.genre ?? '未指定')
    .replace('{EVENTS}', eventsBlock);
  const plausibilityPrompt = loadPrompt('audit-plausibility', PROMPTS_DIR)
    .replace('{GENRE}', args.genre ?? '未指定')
    .replace('{MAINCHAIN}', mainChainBlock.slice(0, 20_000))
    .replace('{ENDING}', endingBlock.slice(0, 6_000));

  const [fair, plaus] = await Promise.all([
    callWithValidation<FairPlayResult>(engine, fairplayPrompt, {
      systemPrompt: '你是本格推理审校编辑，按公平竞赛规则审线索与巧合。只输出 JSON。',
      outputSchema: { type: 'object' },
      temperature: 0.3, maxTokens: 6000, timeoutMs: 180_000,
      schema: FAIRPLAY_SCHEMA, maxAttempts: 3,
    }),
    callWithValidation<PlausibilityResult>(engine, plausibilityPrompt, {
      systemPrompt: '你是陪审团心理分析师，逐转折生成读者之问并核对文本回答。只输出 JSON。',
      outputSchema: { type: 'object' },
      temperature: 0.3, maxTokens: 6000, timeoutMs: 180_000,
      schema: PLAUSIBILITY_SCHEMA, maxAttempts: 3,
    }),
  ]);

  for (const [label, res] of [['fairplay', fair], ['plausibility', plaus]] as const) {
    usage.inputTokens += res.totalUsage.inputTokens;
    usage.outputTokens += res.totalUsage.outputTokens;
    usage.costRmb += res.totalUsage.costRmb;
    usage.durationMs += res.totalUsage.durationMs;
    usage.model = res.totalUsage.model;
  }

  const fairplay = fair.ok && fair.data ? fair.data : null;
  if (!fairplay) failures.push('fairplay 公平清单失败');
  const plausibility = plaus.ok && plaus.data ? plaus.data : null;
  if (!plausibility) failures.push('plausibility 世情探针失败');

  return { fairplay, plausibility, usage, failures };
}

// ─── 红队（对抗式）────────────────────────────────────────────────

export async function runRedTeam(
  engine: AIAgentAdapter,
  args: {
    nodes: GraphNode[];
    graphSummary: string;
    foundHoles: ProbeHole[];
    genre?: string;
  },
): Promise<{ holes: ProbeHole[]; usage: TokenUsage; ok: boolean }> {
  const usage: TokenUsage = { ...zeroUsage };
  const foundBlock = args.foundHoles.length
    ? args.foundHoles.map((h) => `[${h.severity}][${h.type}] ${h.title}——${h.detail}`).join('\n')
    : '（暂无）';

  const prompt = loadPrompt('audit-redteam', PROMPTS_DIR)
    .replace('{GENRE}', args.genre ?? '未指定')
    .replace('{GRAPH}', args.graphSummary)
    .replace('{FOUND}', foundBlock.slice(0, 8_000))
    .replace('{EVENTS}', formatEventList(args.nodes).slice(0, 16_000));

  const schema: SchemaSpec = { holes: { type: 'array', itemSpec: HOLE_ITEM } };
  const res = await callWithValidation<{ holes: ProbeHole[] }>(engine, prompt, {
    systemPrompt: '你是来找茬的悬疑责编，只输出 JSON。只报已发现清单之外的逻辑洞。',
    outputSchema: { type: 'object' },
    temperature: 0.5, maxTokens: 5000, timeoutMs: 180_000,
    schema, maxAttempts: 3,
  });

  usage.inputTokens += res.totalUsage.inputTokens;
  usage.outputTokens += res.totalUsage.outputTokens;
  usage.costRmb += res.totalUsage.costRmb;
  usage.durationMs += res.totalUsage.durationMs;
  usage.model = res.totalUsage.model;

  return {
    holes: res.ok && res.data && Array.isArray(res.data.holes) ? res.data.holes : [],
    usage,
    ok: res.ok,
  };
}
