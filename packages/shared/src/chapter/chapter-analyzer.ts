/**
 * L2 章节规则 AI 确认层
 *
 * 当 L1 启发式分章置信度低（如无章节标志回退单章）或章节数可疑时，
 * 取全文头部样本 + L1 探测到的标题行，让 LLM 判定「这本书的章节规则」。
 *
 * 设计原则：LLM 只输出「规则描述 + 正则建议」，实际全文切分仍由本地代码执行，
 * 避免 LLM 处理全书正文（token 爆炸、切分不一致）。
 *
 * 成本：单次调用，约 2K input + 200 output token ≈ ¥0.002。
 */
import type { AIAgentAdapter } from '../engine/interface.ts';
import { callWithValidation, type SchemaSpec } from '../engine/json-validator.ts';
import type { ChapterInput, TokenUsage } from '../types.ts';
import type { SplitResult } from './chapter-splitter.ts';

export interface ChapterRuleAnalysis {
  /** LLM 判定的章节标题模式描述（自然语言，供进度展示与日志）*/
  pattern: string;
  /** LLM 建议的正则表达式（行匹配，用于本地重切）。无效或空则不重切。*/
  suggestedRegex: string | null;
  /** LLM 对自身判断的置信度 */
  confidence: 'high' | 'low';
  /** 最终决策：是否采用 L1 启发式结果（true=用启发式，false=用 resplitChapters）*/
  useHeuristic: boolean;
  /** 当 useHeuristic=false 时，本地重切的结果（按 suggestedRegex 在全文执行）*/
  resplitChapters: ChapterInput[] | null;
  usage: TokenUsage;
}

const ANALYSIS_SCHEMA: SchemaSpec = {
  hasClearChapters: { type: 'boolean', required: true },
  pattern: { type: 'string', min: 4, max: 200, required: true },
  suggestedRegex: { type: 'string', max: 300 },
  confidence: { type: 'string', required: true },
};

/**
 * 取全文头部样本（前若干行，去重压缩），供 LLM 判定章节规则。
 * 不把全文发给 LLM（省 token），头部样本足以看出章节标题格式。
 */
function buildSample(fullText: string, maxChars = 2000): string {
  // 取前 maxChars 字符，按行截断到完整行
  const head = fullText.slice(0, maxChars * 3);  // 多取一些再按行收
  const lines = head.split('\n');
  let acc = 0;
  const out: string[] = [];
  for (const line of lines) {
    if (acc + line.length > maxChars) break;
    out.push(line);
    acc += line.length + 1;
  }
  return out.join('\n');
}

/** 用 LLM 建议的正则在本地重切全文 */
function resplitWithRegex(fullText: string, regexSource: string): ChapterInput[] | null {
  let re: RegExp;
  try {
    // 建议的正则带 gm 标志；若 LLM 没写标志，补上 gm
    re = /m[^/]*$/.test(regexSource) ? new RegExp(regexSource) : new RegExp(regexSource, 'gm');
  } catch {
    return null;  // 无效正则，放弃重切
  }
  const matches = [...fullText.matchAll(re)];
  if (matches.length < 2) return null;  // 切不出足够章节，放弃

  const chapters: ChapterInput[] = [];

  // 提取前言/序章（第一个匹配章节之前的非空文本）
  const firstMatchIndex = matches[0].index!;
  const preamble = fullText.slice(0, firstMatchIndex).trim();
  if (preamble.length > 0) {
    const firstLine = preamble.split('\n')[0].trim();
    const title = (firstLine.length > 0 && firstLine.length < 30) ? firstLine : '前言/序言';
    chapters.push({ id: '', title, content: preamble });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const headerEnd = start + matches[i][0].length;
    const title = matches[i][0].trim();
    const nextStart = i + 1 < matches.length ? matches[i + 1].index! : fullText.length;
    const content = fullText.slice(headerEnd, nextStart).trim();
    chapters.push({ id: '', title, content });
  }

  for (let i = 0; i < chapters.length; i++) {
    chapters[i].id = `ch${String(i + 1).padStart(3, '0')}`;
  }

  return chapters;
}

/**
 * AI 确认章节规则。
 *
 * 决策矩阵：
 *   - L1 confidence=high 且 LLM 也 high 且 agrees → useHeuristic=true（省钱的快速路径）
 *   - L1 confidence=low → 调 LLM；若 LLM 给出有效 suggestedRegex → 重切（useHeuristic=false）
 *   - L1 confidence=high 但 LLM 给出不同且更优的 regex → 也可重切（保守：仅当 L1 章节数可疑时）
 */
export async function analyzeChapterRule(
  engine: AIAgentAdapter,
  fullText: string,
  heuristic: SplitResult,
): Promise<ChapterRuleAnalysis> {
  const sample = buildSample(fullText);
  const samplesDetected = heuristic.sampleTitles.length > 0
    ? heuristic.sampleTitles.map((t) => `  - ${t}`).join('\n')
    : '  （L1 未探测到明确标题）';

  const prompt = `你是一个小说章节结构分析助手。下面是一部小说的开头样本，请判断它的章节区分规则。

【小说开头样本】
${sample}

【本地启发式探测结果】
- 使用策略：${heuristic.strategy}
- 切出章节数：${heuristic.chapters.length}
- 探测到的标题样本：
${samplesDetected}

请判断：
1. 这部小说是否有清晰的章节标题标志？
2. 章节标题长什么样？（用一句话描述模式，如「第X章 标题，行首顶格」「数字编号 + 顿号」等）
3. 给出一个能匹配章节标题行的正则表达式（用于全文切分）。注意：
   - 用 gm 标志
   - 锚定行首 ^ 避免误匹配正文
   - 只匹配标题行本身，不要贪婪吞掉正文
   - 如果小说没有清晰的章节结构，suggestedRegex 留空字符串

只输出 JSON：{"hasClearChapters": true/false, "pattern": "...", "suggestedRegex": "...", "confidence": "high"|"low"}`;

  const res = await callWithValidation<{
    hasClearChapters: boolean; pattern: string; suggestedRegex: string; confidence: 'high' | 'low';
  }>(engine, prompt, {
    systemPrompt: '你是文本结构分析助手。只输出 JSON，不要任何额外文字。',
    outputSchema: { type: 'object' },
    temperature: 0.2,
    maxTokens: 600,
    timeoutMs: 60_000,
    schema: ANALYSIS_SCHEMA,
    maxAttempts: 2,
  });

  if (!res.ok || !res.data) {
    // LLM 失败 → 保守采用启发式结果
    return {
      pattern: '（AI 分析失败，沿用启发式）',
      suggestedRegex: null,
      confidence: 'low',
      useHeuristic: true,
      resplitChapters: null,
      usage: res.totalUsage,
    };
  }

  const { pattern, suggestedRegex, confidence } = res.data;
  const regexSrc = suggestedRegex?.trim() || null;

  // 决策：低置信度启发式 + LLM 给出有效正则 → 尝试重切
  if (heuristic.confidence === 'low' && regexSrc) {
    const resplit = resplitWithRegex(fullText, regexSrc);
    if (resplit && resplit.length >= 2) {
      return {
        pattern,
        suggestedRegex: regexSrc,
        confidence,
        useHeuristic: false,
        resplitChapters: resplit,
        usage: res.totalUsage,
      };
    }
  }

  // 默认：采用启发式（含 LLM 也 high 且 agrees 的快速路径）
  return {
    pattern,
    suggestedRegex: regexSrc,
    confidence,
    useHeuristic: true,
    resplitChapters: null,
    usage: res.totalUsage,
  };
}
