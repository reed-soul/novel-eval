/**
 * 章节切分（对齐设计文档 v2.2 第三章「策略2 正则匹配」）
 *
 * 重写背景：原单一正则只能覆盖「第X章」行首格式，对真实网文的 4 种常见格式
 * （分隔符包裹 / 行首标题 / CRLF 裸章号 / 无标志）大多失效。现改为多策略探测器。
 *
 * 两层设计：
 *   L1（本文件）纯逻辑启发式，preflight 和正式评估都用，不调 LLM。
 *   L2（chapter-analyzer.ts）AI 确认层，仅在 L1 低置信度或章节数可疑时调用。
 */
import type { ChapterInput, ChapterKind } from '../types.ts';

/** 切分结果（带元信息，供 evaluator 的 L2 AI 确认层决策）*/
export interface SplitResult {
  chapters: ChapterInput[];
  strategy: 'separator' | 'regex' | 'fallback';
  confidence: 'high' | 'low';
  /** 探测到的前几个标题样本（供 L2 确认用）*/
  sampleTitles: string[];
}

// ─── 行首章节标题正则 ─────────────────────────────────────────────
// 覆盖：第X章/回/节/卷（中文+阿拉伯数字）、Chapter N、N、/N./N． 编号
// 行首锚定（允许半角空格/制表符缩进），避免句中「第3章」误匹配。
const TITLE_LINE_RE =
  /^[ \t]*(?:第[零一二三四五六七八九十百千两0-9]+[章回节卷]|Chapter\s+\d+|\d+[、.．])[ \t]*[^\n]*$/gm;

/** 分隔符行（5 个以上等号/减号/星号），用于「分隔符块」策略 */
const SEPARATOR_RE = /^[ \t]*([=\-*])\1{4,}[ \t]*$/gm;

// ─── 预处理归一化 ───────────────────────────────────────────────

/** 统一换行为 LF、去 BOM、去首尾空白。解决 CRLF 文件（如长夜难明）正则失配问题。 */
function normalize(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

// ─── 策略 A：分隔符块 ──────────────────────────────────────────
//
// 诛仙 / 长安十二时辰 / 夜的命名术 用 ======== 包裹标题：
//   ========================================
//   第一章 标题
//   ========================================
//   正文...
//
// 正文里常重复出现「标题-《书名》」后缀行（在块外），靠「只取块内第一非空行」天然去重。

interface SeparatorBlock {
  titleLine: string;   // 块内第一个非空行（章节标题）
  firstSepPos: number; // 本块第一个分隔符行起点（用于确定上一块正文的终点）
  bodyStart: number;   // 本块正文起点（第二个分隔符行之后）
}

/**
 * 扫描分隔符块。分隔符两两成对：第一个分隔符 → 标题 → 第二个分隔符 → 正文（直到下一对）。
 * 标题取两个分隔符之间的第一个非空行；正文起点是第二个分隔符行之后。
 */
function scanSeparatorBlocks(text: string): SeparatorBlock[] {
  const sepPositions: number[] = [];
  for (const m of text.matchAll(SEPARATOR_RE)) {
    sepPositions.push(m.index!);
  }
  if (sepPositions.length < 4) return [];  // 至少 2 对（4 行）才算分隔符格式

  const blocks: SeparatorBlock[] = [];
  for (let i = 0; i + 1 < sepPositions.length; i += 2) {
    const firstSepPos = sepPositions[i];
    const afterFirstSep = text.indexOf('\n', firstSepPos) + 1;
    const secondSepPos = sepPositions[i + 1];
    const titleRegion = text.slice(afterFirstSep, secondSepPos);
    const titleLine = titleRegion.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    if (!titleLine) continue;
    const bodyStart = text.indexOf('\n', secondSepPos) + 1;
    blocks.push({ titleLine, firstSepPos, bodyStart });
  }
  return blocks;
}

/** 分隔符策略切分：每块正文 = bodyStart 到下一块第一个分隔符前（或文末）*/
function splitBySeparator(text: string): { chapters: ChapterInput[]; sampleTitles: string[] } | null {
  const blocks = scanSeparatorBlocks(text);
  if (blocks.length < 3) return null;  // ≥3 块才确认是分隔符格式，排除装饰线误判

  const chapters: ChapterInput[] = [];
  const sampleTitles: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const { bodyStart } = blocks[i];
    const bodyEnd = i + 1 < blocks.length ? blocks[i + 1].firstSepPos : text.length;
    const content = text.slice(bodyStart, bodyEnd).trim();
    const id = `ch${String(i + 1).padStart(3, '0')}`;
    chapters.push({ id, title: blocks[i].titleLine, content });
    if (sampleTitles.length < 5) sampleTitles.push(blocks[i].titleLine);
  }
  return { chapters, sampleTitles };
}

// ─── 策略 B：行首标题正则 ──────────────────────────────────────

function splitByRegex(text: string): { chapters: ChapterInput[]; sampleTitles: string[] } | null {
  const matches = [...text.matchAll(TITLE_LINE_RE)];
  if (matches.length === 0) return null;

  const chapters: ChapterInput[] = [];
  const sampleTitles: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const headerEnd = start + matches[i][0].length;
    const title = matches[i][0].trim();
    const id = `ch${String(i + 1).padStart(3, '0')}`;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const content = text.slice(headerEnd, nextStart).trim();
    chapters.push({ id, title, content });
    if (sampleTitles.length < 5) sampleTitles.push(title);
  }
  return { chapters, sampleTitles };
}

// ─── 策略 C：无标志回退 ────────────────────────────────────────

function fallbackSingleChapter(text: string): ChapterInput[] {
  return [{ id: 'ch001', title: '全文', content: text.trim() }];
}

// ─── 主入口 ────────────────────────────────────────────────────

/**
 * 带元信息的切分。按优先级探测：分隔符块 → 行首正则 → 回退单章。
 * confidence='high' 表示启发式较确定（分隔符块 ≥3 或正则命中）；
 * 'low' 表示回退到单章或章节数可疑，建议 L2 AI 确认。
 */
export function splitChaptersWithMeta(rawText: string): SplitResult {
  const text = normalize(rawText);

  // 策略 A：分隔符块
  const sepResult = splitBySeparator(text);
  if (sepResult && sepResult.chapters.length >= 3) {
    return {
      chapters: sepResult.chapters,
      strategy: 'separator',
      confidence: 'high',
      sampleTitles: sepResult.sampleTitles,
    };
  }

  // 策略 B：行首正则
  const regResult = splitByRegex(text);
  if (regResult && regResult.chapters.length >= 1) {
    // 仅命中 1 个标题行但文本很长 → 可能误判，标 low
    const wordCount = countChars(text);
    const confidence = regResult.chapters.length === 1 && wordCount > 50_000 ? 'low' : 'high';
    return {
      chapters: regResult.chapters,
      strategy: 'regex',
      confidence,
      sampleTitles: regResult.sampleTitles,
    };
  }

  // 策略 C：回退
  return {
    chapters: fallbackSingleChapter(text),
    strategy: 'fallback',
    confidence: 'low',
    sampleTitles: [],
  };
}

/**
 * 向后兼容的切分入口（preflight / 旧调用点用）。返回纯章节数组。
 */
export function splitChapters(rawText: string): ChapterInput[] {
  return splitChaptersWithMeta(rawText).chapters;
}

// ─── 辅助函数（被 eval map-phase / preflight / writer 复用）─────────

export function countChars(text: string): number {
  return [...text].filter((ch) => /\S/.test(ch)).length;
}

/** 推断章节类型（prologue/epilogue/main/extra）*/
export function inferKind(title: string): ChapterKind {
  if (/楔子|序|引子|前言|序章/i.test(title)) return 'prologue';
  if (/尾声|后记|跋|结章/i.test(title)) return 'epilogue';
  if (/番外|外篇|特别/i.test(title)) return 'extra';
  return 'main';
}
