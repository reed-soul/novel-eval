/**
 * 单章生成主循环 — 上下文组装 + 正文生成 + checkpoint
 *
 * 流程（每章）：
 *   1. 读本章蓝图 + narrative_state + character_state + 最近 N 章原文
 *   2. 组装 prompt（第一章简化，后续章注入全部上下文）
 *   3. LLM 生成正文
 *   4. 写入 chapter 表（checkpoint）
 *   5. finalizer 更新叙事状态
 *
 * 连贯机制（不妥协方案）：
 *   - 原文窗口（最近 5 章）：局部衔接流畅
 *   - macroSummary + openForeshadows：全局伏笔/逻辑一致
 *   - characterState：角色一致性
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIAgentAdapter } from '@novel-eval/shared';
import { loadPrompt, addUsage, zeroUsage, countChars } from '@novel-eval/shared';
import type { NovelMetadata, TokenUsage } from '@novel-eval/shared';
import type { DB } from '../db.ts';
import type { ChapterOutline, ChapterContent } from './types.ts';
import {
  getOutline, getChapter, getRecentChapters, saveChapter, markOutlineWritten,
  getNarrativeState, getBibleForChapter, deleteChapter,
} from './store.ts';
import { finalizeChapter } from './finalizer.ts';
import { assessChapterQuality, type QualityGateResult } from './quality-gate.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

const CHAPTER_TEMPERATURE = 0.7;
const STEP_TIMEOUT_MS = 300_000;  // 单章正文生成可能较长，给 5 分钟
const RECENT_WINDOW = 5;          // 最近 N 章原文注入窗口

// ─── 单章生成 ────────────────────────────────────────────────────

/** 质量门槛配置（有则启用写-评-改循环）*/
export interface QualityGateConfig {
  metadata: NovelMetadata;
  profile?: string;
  maxRevise: number;           // 最大重写次数（默认 2）
}

export interface GenerateChapterOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  number: number;
  wordCount: number;            // 目标字数
  qualityGate?: QualityGateConfig;  // 有则启用质量门槛，无则保持 M2 行为
  onProgress?: (step: string, msg: string) => void;
}

export interface GenerateChapterResult {
  number: number;
  title: string;
  content: string;
  wordCount: number;
  usage: TokenUsage;
  qualityGate?: QualityGateResult;  // 质量门槛结果（启用时）
}

export async function generateChapter(opts: GenerateChapterOptions): Promise<GenerateChapterResult> {
  const { engine, db, projectId, number, wordCount, qualityGate, onProgress } = opts;
  const totalUsage: TokenUsage = { ...zeroUsage };

  // Checkpoint：已存在则跳过（无质量门槛时）
  const existing = getChapter(db, projectId, number);
  if (existing && !qualityGate) {
    onProgress?.(`chapter:${number}`, `（已完成，跳过）`);
    return {
      number: existing.number, title: existing.title,
      content: existing.content, wordCount: existing.wordCount, usage: { ...zeroUsage },
    };
  }

  // 读本章蓝图
  const outline = getOutline(db, projectId, number);
  if (!outline) throw new Error(`找不到第 ${number} 章的蓝图，请先运行 write outline`);

  // ─── 无质量门槛：M2 原始流程 ────────────────────────────────────
  if (!qualityGate) {
    const result = await generateOnce(engine, db, projectId, outline, wordCount, undefined, onProgress, totalUsage);
    await finalizeAndSave(engine, db, projectId, outline, result.content, result.wordCount, onProgress, totalUsage);
    return { number, title: outline.title, content: result.content, wordCount: result.wordCount, usage: totalUsage };
  }

  // ─── 有质量门槛：写-评-改循环 ──────────────────────────────────
  const maxAttempts = qualityGate.maxRevise + 1;
  let lastGate: QualityGateResult | undefined;
  let revisionFeedback: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 如有旧章（revise 重写场景），先删
    if (attempt > 1) {
      deleteChapter(db, projectId, number);
      onProgress?.(`chapter:${number}`, `重写（第 ${attempt} 次，max ${maxAttempts}）...`);
    } else {
      onProgress?.(`chapter:${number}`, `生成第 ${number} 章《${outline.title}》...`);
    }

    // 生成正文
    const gen = await generateOnce(engine, db, projectId, outline, wordCount, revisionFeedback, onProgress, totalUsage);

    // 暂存（质量门槛评估需要读 DB 里的章节）
    saveChapter(db, projectId, number, {
      outlineId: outline.id, title: outline.title, content: gen.content, wordCount: gen.wordCount,
    });

    // 质量门槛评估
    const gateRes = await assessChapterQuality({
      engine, db, projectId,
      chapter: { id: '', projectId, number, outlineId: outline.id, title: outline.title, content: gen.content, wordCount: gen.wordCount, createdAt: '', updatedAt: '' },
      metadata: qualityGate.metadata, profile: qualityGate.profile,
      onProgress: (msg) => onProgress?.(`gate:${number}`, msg),
    });
    addUsage(totalUsage, gateRes.usage);
    lastGate = { verdict: gateRes.verdict, reason: gateRes.reason, score: gateRes.score, grade: gateRes.grade, feedback: gateRes.feedback, repetition: gateRes.repetition };

    onProgress?.(`chapter:${number}`, `质量门槛：${gateRes.verdict.toUpperCase()} — ${gateRes.reason}`);

    if (gateRes.verdict === 'pass') {
      markOutlineWritten(db, projectId, number);
      // finalizer 更新叙事状态
      const finRes = await finalizeChapter({
        engine, db, projectId, chapterNumber: number,
        chapterTitle: outline.title, chapterContent: gen.content, onProgress,
      });
      addUsage(totalUsage, finRes.usage);
      return { number, title: outline.title, content: gen.content, wordCount: gen.wordCount, usage: totalUsage, qualityGate: lastGate };
    }

    if (gateRes.verdict === 'block') {
      deleteChapter(db, projectId, number);  // 不留不合格的章
      throw new Error(`第 ${number} 章被质量门槛 block：${gateRes.reason}`);
    }

    // revise：构造反馈，下一轮注入
    revisionFeedback = gateRes.feedback;
  }

  // 达上限仍不 pass
  deleteChapter(db, projectId, number);
  throw new Error(`第 ${number} 章重写 ${qualityGate.maxRevise} 次后仍未通过质量门槛：${lastGate?.reason}`);
}

/** 单次生成（不含质量门槛）*/
async function generateOnce(
  engine: AIAgentAdapter, db: DB, projectId: string,
  outline: ChapterOutline, wordCount: number,
  revisionFeedback: string | undefined,
  onProgress: ((s: string, m: string) => void) | undefined,
  totalUsage: TokenUsage,
): Promise<{ content: string; wordCount: number }> {
  const prompt = await buildChapterPrompt(db, projectId, outline, wordCount, revisionFeedback);
  const systemPrompt = revisionFeedback
    ? '你是畅销小说作家。针对评审意见改进重写。直接输出正文，不要任何解释、标题或元说明。'
    : '你是畅销小说作家。直接输出正文，不要任何解释、标题或元说明。';

  const res = await engine.run(prompt, {
    systemPrompt,
    temperature: CHAPTER_TEMPERATURE,
    maxTokens: Math.ceil(wordCount * 2.5),
    timeoutMs: STEP_TIMEOUT_MS,
    // 关闭推理过程：蓝图已提供结构，thinking 会挤占 output 预算导致正文截断。
    // DeepSeek 默认输出 thinking block；智谱端忽略此字段。
    disableThinking: true,
  });
  addUsage(totalUsage, res.usage);

  const content = cleanChapterContent(res.text, outline.title);
  const actualWordCount = countChars(content);

  if (content.trim().length === 0) {
    throw new Error(`第 ${outline.number} 章生成失败：正文为空`);
  }
  if (actualWordCount < wordCount * 0.4) {
    onProgress?.(`chapter:${outline.number}`, `⚠ 字数偏少（${actualWordCount}/${wordCount}）`);
  }

  return { content, wordCount: actualWordCount };
}

/** finalizer + 保存（无质量门槛路径用）*/
async function finalizeAndSave(
  engine: AIAgentAdapter, db: DB, projectId: string,
  outline: ChapterOutline, content: string, wordCount: number,
  onProgress: ((s: string, m: string) => void) | undefined,
  totalUsage: TokenUsage,
): Promise<void> {
  saveChapter(db, projectId, outline.number, {
    outlineId: outline.id, title: outline.title, content, wordCount,
  });
  markOutlineWritten(db, projectId, outline.number);
  onProgress?.(`chapter:${outline.number}`, `✓ ${wordCount} 字`);
  const finRes = await finalizeChapter({
    engine, db, projectId, chapterNumber: outline.number,
    chapterTitle: outline.title, chapterContent: content, onProgress,
  });
  addUsage(totalUsage, finRes.usage);
}

// ─── 上下文组装 ──────────────────────────────────────────────────

async function buildChapterPrompt(
  db: DB, projectId: string, outline: ChapterOutline, wordCount: number,
  revisionFeedback?: string,
): Promise<string> {
  const { fullText, characterState } = getBibleForChapter(db, projectId);
  const nextOutline = getOutline(db, projectId, outline.number + 1);
  const feedbackSection = revisionFeedback
    ? `\n\n【评审反馈（针对以下意见改进重写）】\n${revisionFeedback}`
    : '';

  // 第一章：简化路径（只注入 bible + 本章蓝图）
  if (outline.number === 1) {
    return loadPrompt('chapter-first', PROMPTS_DIR)
      .replace('{BIBLE}', fullText)
      .replace('{NUMBER}', String(outline.number))
      .replace('{TITLE}', outline.title)
      .replace('{ROLE}', outline.role)
      .replace('{PURPOSE}', outline.purpose)
      .replace('{SUSPENSE}', String(outline.suspenseLevel))
      .replace('{FORESHADOWING}', outline.foreshadowing || '（本章无显式伏笔操作）')
      .replace('{TWIST}', String(outline.twistLevel))
      .replace('{SUMMARY}', outline.summary)
      .replace('{WORD_COUNT}', String(wordCount)) + feedbackSection;
  }

  // 后续章：注入全部上下文
  const narrative = getNarrativeState(db, projectId);
  const recent = getRecentChapters(db, projectId, outline.number, RECENT_WINDOW);
  const macroSummary = narrative?.macroSummary ?? '（尚无前情摘要）';
  const openForeshadows = narrative && narrative.openForeshadows.length
    ? narrative.openForeshadows.map((f) => `第${f.setupChapter}章埋设：${f.description}`).join('\n')
    : '（暂无未回收伏笔）';
  const recentText = recent.length
    ? recent.map((c) => `第${c.number}章《${c.title}》\n${c.content}`).join('\n\n---\n\n')
    : '（无前序章节）';
  const stateText = characterState.characters.map((c) =>
    `${c.name}：[${c.items.join('、')}] 能力[${c.abilities.join('、')}] 状态：${c.status} 事件[${c.events.join('；')}]`,
  ).join('\n');

  const prompt = loadPrompt('chapter-next', PROMPTS_DIR)
    .replace('{BIBLE}', fullText)
    .replace('{MACRO_SUMMARY}', macroSummary)
    .replace('{OPEN_FORESHADOWS}', openForeshadows)
    .replace('{CHARACTER_STATE}', stateText)
    .replace('{RECENT_CHAPTERS}', recentText)
    .replace('{NUMBER}', String(outline.number))
    .replace('{TITLE}', outline.title)
    .replace('{ROLE}', outline.role)
    .replace('{PURPOSE}', outline.purpose)
    .replace('{SUSPENSE}', String(outline.suspenseLevel))
    .replace('{FORESHADOWING}', outline.foreshadowing || '（本章无显式伏笔操作）')
    .replace('{TWIST}', String(outline.twistLevel))
    .replace('{SUMMARY}', outline.summary)
    .replace('{NEXT_NUMBER}', String(outline.number + 1))
    .replace('{NEXT_TITLE}', nextOutline?.title ?? '（最终章）')
    .replace('{NEXT_SUMMARY}', nextOutline?.summary ?? '本章为最终章，无需预告下一章')
    .replace('{WORD_COUNT}', String(wordCount)) + feedbackSection;

  return prompt;
}

/** 清理 LLM 输出：去标题重复、去 markdown 包裹、去首尾空白 */
function cleanChapterContent(raw: string, title: string): string {
  let text = raw.trim();
  // 去 markdown 代码块包裹
  text = text.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');
  // 去开头的标题重复（LLM 可能重复章节标题）
  const titleLine = `第${getChapterOrdinalFromTitle(title)}章`;
  if (text.startsWith(titleLine)) {
    text = text.slice(titleLine.length).trim();
  }
  if (text.startsWith(title)) {
    text = text.slice(title.length).trim();
  }
  // 去开头的「标题：」之类
  text = text.replace(/^[#\s]*第[一二三四五六七八九十百零\d]+章[^\n]*\n/, '');
  return text.trim();
}

function getChapterOrdinalFromTitle(title: string): string {
  // 从 title 里尽量提取章号，失败则返回空（不影响清理逻辑）
  const m = title.match(/第([一二三四五六七八九十百零\d]+)章/);
  return m ? m[1] : '';
}

// ─── 批量生成（按范围）───────────────────────────────────────────

export interface GenerateRangeOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  from: number;
  to: number;
  wordCount: number;
  qualityGate?: QualityGateConfig;
  onProgress?: (step: string, msg: string) => void;
}

export async function generateRange(opts: GenerateRangeOptions): Promise<GenerateChapterResult[]> {
  const results: GenerateChapterResult[] = [];
  for (let n = opts.from; n <= opts.to; n++) {
    const r = await generateChapter({
      engine: opts.engine, db: opts.db,
      projectId: opts.projectId, number: n, wordCount: opts.wordCount,
      qualityGate: opts.qualityGate, onProgress: opts.onProgress,
    });
    results.push(r);
  }
  return results;
}
