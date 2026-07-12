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
import type { DB } from '../db.ts';
import type { ChapterOutline } from './types.ts';
import {
  getOutline, getChapter, getRecentChapters, saveChapter, markOutlineWritten,
  getNarrativeState, getBibleForChapter,
} from './store.ts';
import { finalizeChapter } from './finalizer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

const CHAPTER_TEMPERATURE = 0.7;
const STEP_TIMEOUT_MS = 300_000;  // 单章正文生成可能较长，给 5 分钟
const RECENT_WINDOW = 5;          // 最近 N 章原文注入窗口

// ─── 单章生成 ────────────────────────────────────────────────────

export interface GenerateChapterOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  number: number;
  wordCount: number;            // 目标字数
  onProgress?: (step: string, msg: string) => void;
}

export interface GenerateChapterResult {
  number: number;
  title: string;
  content: string;
  wordCount: number;
  usage: import('@novel-eval/shared').TokenUsage;
}

export async function generateChapter(opts: GenerateChapterOptions): Promise<GenerateChapterResult> {
  const { engine, db, projectId, number, wordCount, onProgress } = opts;
  const totalUsage = { ...zeroUsage };

  // Checkpoint：已存在则跳过
  const existing = getChapter(db, projectId, number);
  if (existing) {
    onProgress?.(`chapter:${number}`, `（已完成，跳过）`);
    return {
      number: existing.number, title: existing.title,
      content: existing.content, wordCount: existing.wordCount, usage: { ...zeroUsage },
    };
  }

  // 1. 读本章蓝图
  const outline = getOutline(db, projectId, number);
  if (!outline) throw new Error(`找不到第 ${number} 章的蓝图，请先运行 write outline`);

  // 2. 组装 prompt
  onProgress?.(`chapter:${number}`, `生成第 ${number} 章《${outline.title}》...`);
  const prompt = await buildChapterPrompt(db, projectId, outline, wordCount);

  // 3. LLM 生成正文
  const res = await engine.run(prompt, {
    systemPrompt: '你是畅销小说作家。直接输出正文，不要任何解释、标题或元说明。',
    temperature: CHAPTER_TEMPERATURE,
    maxTokens: Math.ceil(wordCount * 2.5),  // 中文约 1 字 ≈ 1.5-2 token，留余量
    timeoutMs: STEP_TIMEOUT_MS,
  });
  addUsage(totalUsage, res.usage);

  // 4. 清理正文（去可能的标题重复/markdown 包裹）
  const content = cleanChapterContent(res.text, outline.title);
  const actualWordCount = countChars(content);

  if (content.trim().length === 0) {
    throw new Error(`第 ${number} 章生成失败：正文为空`);
  }
  if (actualWordCount < wordCount * 0.4) {
    onProgress?.(`chapter:${number}`, `⚠ 字数偏少（${actualWordCount}/${wordCount}），M3 将加扩写`);
  }

  // 5. 写入 chapter 表（checkpoint）
  saveChapter(db, projectId, number, {
    outlineId: outline.id, title: outline.title, content, wordCount: actualWordCount,
  });
  markOutlineWritten(db, projectId, number);
  onProgress?.(`chapter:${number}`, `✓ ${actualWordCount} 字`);

  // 6. finalizer 更新叙事状态
  const finRes = await finalizeChapter({
    engine, db, projectId, chapterNumber: number,
    chapterTitle: outline.title, chapterContent: content, onProgress,
  });
  addUsage(totalUsage, finRes.usage);

  return { number, title: outline.title, content, wordCount: actualWordCount, usage: totalUsage };
}

// ─── 上下文组装 ──────────────────────────────────────────────────

async function buildChapterPrompt(
  db: DB, projectId: string, outline: ChapterOutline, wordCount: number,
): Promise<string> {
  const { fullText, characterState } = getBibleForChapter(db, projectId);
  const nextOutline = getOutline(db, projectId, outline.number + 1);

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
      .replace('{WORD_COUNT}', String(wordCount));
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
    .replace('{WORD_COUNT}', String(wordCount));

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
  onProgress?: (step: string, msg: string) => void;
}

export async function generateRange(opts: GenerateRangeOptions): Promise<GenerateChapterResult[]> {
  const results: GenerateChapterResult[] = [];
  for (let n = opts.from; n <= opts.to; n++) {
    const r = await generateChapter({
      engine: opts.engine, db: opts.db,
      projectId: opts.projectId, number: n, wordCount: opts.wordCount,
      onProgress: opts.onProgress,
    });
    results.push(r);
  }
  return results;
}
