/**
 * 精简短篇核心：章节 → LLM 缩写（map：逐章浓缩 → reduce：合成终稿）。
 * 引擎复用应用同款（shared engines.yml，与 audiobook attribute.ts 同模式）；
 * 段级缓存按内容哈希键控——改章只重浓缩那一章（与 M1 TTS 缓存同哲学）。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AIAgentAdapter } from '@novel-eval/shared';
import type { Chapter } from './db.ts';

export type DigestStyle = 'faithful' | 'hook';

export interface CondenseOptions {
  title: string;
  targetWords: number;
  style: DigestStyle;
  cacheFile?: string;          // 内容哈希缓存（缺省不缓存）
  onProgress?: (phase: 'map' | 'reduce', done: number, total: number) => void;
}

export interface CondenseResult {
  markdown: string;
  words: number;
  llmCalls: number;
}

type Cache = Record<string, string>;

const STYLE_BRIEF: Record<DigestStyle, string> = {
  faithful: '忠实浓缩：保留完整主线、全部关键反转与人物动机，删去枝节描写与重复铺垫；叙事顺序与原作一致。',
  hook: '引流浓缩：以最快节奏讲完主线，前三句必须抛出核心悬念，保留最强反转，结尾留一个回味钩子。',
};

function loadCache(file?: string): Cache {
  if (!file || !existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Cache;
  } catch {
    return {};
  }
}

function saveCache(file: string | undefined, cache: Cache): void {
  if (file) writeFileSync(file, JSON.stringify(cache, null, 1), 'utf-8');
}

/** 缓存键 = 影响产出的全部输入（M1 内容哈希同哲学：改字自动失配） */
export function condenseCacheKey(scope: string, text: string, targetWords: number, style: string): string {
  return createHash('sha256').update(`${scope}|${targetWords}|${style}|${text}`).digest('hex').slice(0, 24);
}

export function mapPrompt(ch: Chapter, targetWords: number, style: string): string {
  const perChapter = Math.max(300, Math.round(targetWords / 4));
  return [
    `以下是中文小说《第${ch.position}章 ${ch.title}》全文。请把它浓缩成 ${perChapter} 字左右的叙事摘要。`,
    STYLE_BRIEF[style as DigestStyle] ?? STYLE_BRIEF.faithful,
    '直接输出摘要正文（不要标题、不要解释、不要列表）。',
    '',
    ch.content,
  ].join('\n');
}

export function reducePrompt(title: string, summaries: string[], targetWords: number, style: string): string {
  return [
    `以下是一部中文小说各章的浓缩摘要。请把它们合成为一篇 ${targetWords} 字左右的精简短篇，标题为《${title}》。`,
    STYLE_BRIEF[style as DigestStyle] ?? STYLE_BRIEF.faithful,
    '要求：成稿是连贯的短篇小说（有场景、有对白、有节奏），不是摘要的拼接；人物名与关键反转必须与原作一致。',
    '输出格式：第一行标题《…》，之后正文。',
    '',
    ...summaries,
  ].join('\n\n');
}

/** 主流程：map 逐章浓缩（命中缓存零调用）→ reduce 合成终稿 */
export async function condenseChapters(
  chapters: Chapter[],
  opts: CondenseOptions,
  engine: AIAgentAdapter,
): Promise<CondenseResult> {
  if (chapters.length === 0) throw new Error('没有章节可浓缩');
  const cache = loadCache(opts.cacheFile);
  let llmCalls = 0;

  const summaries: string[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const key = condenseCacheKey(`map:${ch.position}`, ch.content, opts.targetWords, opts.style);
    let out = cache[key];
    if (out === undefined) {
      const r = await engine.run(mapPrompt(ch, opts.targetWords, opts.style), {
        systemPrompt: '你是中文小说的资深改稿编辑，擅长在不丢失主线与反转的前提下压缩篇幅。只输出正文。',
        temperature: 0.3,
        maxTokens: 4000,
        disableThinking: true,
      });
      out = r.text.trim();
      cache[key] = out;
      saveCache(opts.cacheFile, cache);
      llmCalls += 1;
    }
    summaries.push(`【第${ch.position}章 ${ch.title}】\n${out}`);
    opts.onProgress?.('map', i + 1, chapters.length);
  }

  const reduceKey = condenseCacheKey('reduce', summaries.join('\n\f'), opts.targetWords, opts.style + opts.title);
  let final = cache[reduceKey];
  if (final === undefined) {
    const r = await engine.run(reducePrompt(opts.title, summaries, opts.targetWords, opts.style), {
      systemPrompt: '你是中文短篇小说家，擅长把长篇浓缩为节奏紧凑、反转保留的精简短篇。只输出标题与正文。',
      temperature: 0.4,
      maxTokens: 8000,
      disableThinking: true,
    });
    final = r.text.trim();
    cache[reduceKey] = final;
    saveCache(opts.cacheFile, cache);
    llmCalls += 1;
  }
  opts.onProgress?.('reduce', 1, 1);

  const words = final.replace(/\s/g, '').length;
  return { markdown: final, words, llmCalls };
}
