/**
 * Slice full novels into short golden fixtures for affordable evaluation.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseTxt, splitChaptersWithMeta, countChars } from '@novel-eval/shared';
import type { ChapterInput } from '@novel-eval/shared';
import type { CheckReport, LoadedGoldenCase, SlicePolicy, SliceReport } from './types.ts';
import { sliceOutputPath } from './load-corpus.ts';

/** Front-matter / promo / TOC titles that must not enter golden slices. */
const JUNK_TITLE_RE =
  /table\s*of\s*contents|目录|^封面$|新书已发|不是诈尸|一个普通人的日常|微信公众号|幸福的味道|邮件列表|超大邮件|加入【|番外发布|求票福利/i;

const MAIN_TITLE_RE = /^第[零一二三四五六七八九十百千两0-9]+[章回节]/;

export function isEligibleChapter(chapter: ChapterInput, minChars: number): boolean {
  if (countChars(chapter.content) < minChars) return false;
  if (JUNK_TITLE_RE.test(chapter.title.trim())) return false;
  return true;
}

export function filterEligibleChapters(
  chapters: ChapterInput[],
  policy: SlicePolicy,
): ChapterInput[] {
  const minChars = policy.minChars ?? 400;
  const eligible = chapters.filter((c) => isEligibleChapter(c, minChars));
  const main = eligible.filter((c) => MAIN_TITLE_RE.test(c.title.trim()));
  // Prefer real「第X章」正文；不够时回退到全部合格章。
  return main.length >= 3 ? main : eligible;
}

export function selectChapters(
  chapters: ChapterInput[],
  policy: SlicePolicy,
): ChapterInput[] {
  const pool = filterEligibleChapters(chapters, policy);
  const selected: ChapterInput[] = [];
  let chars = 0;
  for (const chapter of pool) {
    if (selected.length >= policy.maxChapters) break;
    const next = countChars(chapter.content);
    if (selected.length > 0 && chars + next > policy.maxChars) break;

    if (chars + next > policy.maxChars && selected.length === 0) {
      const truncated = truncateToChars(chapter.content, policy.maxChars);
      selected.push({ ...chapter, content: truncated });
      break;
    }

    selected.push(chapter);
    chars += next;
    if (chars >= policy.maxChars) break;
  }
  if (selected.length > 0) return selected;
  // Last resort: first eligible or first raw chapter, truncated.
  const fallback = pool[0] ?? chapters[0];
  if (!fallback) return [];
  return [{ ...fallback, content: truncateToChars(fallback.content, policy.maxChars) }];
}

function truncateToChars(text: string, maxChars: number): string {
  let count = 0;
  let end = 0;
  for (const ch of text) {
    if (/\S/.test(ch)) count += 1;
    end += ch.length;
    if (count >= maxChars) break;
  }
  return `${text.slice(0, end).trimEnd()}\n\n（……以下省略，golden 抽样截断）`;
}

/** Serialize chapters so L1 splitter can re-parse them. */
export function formatSliceText(chapters: ChapterInput[]): string {
  return chapters
    .map((ch, index) => {
      const title = ch.title.trim() || ch.id;
      const body = ch.content.replace(/\r\n?/g, '\n').trim();
      const titleLine = /^第.+[章回节卷]/.test(title) || /^\d+[、.．]/.test(title)
        ? title
        : `第${index + 1}章 ${title}`;
      return `${titleLine}\n\n${body}`;
    })
    .join('\n\n');
}

export function checkCase(loaded: LoadedGoldenCase): CheckReport {
  if (!existsSync(loaded.absoluteSourcePath)) {
    return {
      caseId: loaded.ref.id,
      ok: false,
      sourceExists: false,
      error: `missing source: ${loaded.ref.sourcePath}`,
    };
  }

  try {
    const doc = parseTxt(loaded.absoluteSourcePath);
    const split = splitChaptersWithMeta(doc.text);
    const eligible = filterEligibleChapters(split.chapters, loaded.meta.slice);
    const chars = countChars(doc.text);
    return {
      caseId: loaded.ref.id,
      ok: eligible.length > 0,
      sourceExists: true,
      chapterCount: eligible.length,
      charCount: chars,
      strategy: split.strategy,
      confidence: split.confidence,
      error: eligible.length === 0 ? 'no eligible chapters after junk/TOC filter' : undefined,
    };
  } catch (e) {
    return {
      caseId: loaded.ref.id,
      ok: false,
      sourceExists: true,
      error: (e as Error).message,
    };
  }
}

export function sliceCase(repoRoot: string, loaded: LoadedGoldenCase): SliceReport {
  const check = checkCase(loaded);
  if (!check.ok || !check.sourceExists) {
    throw new Error(check.error ?? `cannot slice ${loaded.ref.id}`);
  }

  const doc = parseTxt(loaded.absoluteSourcePath);
  const split = splitChaptersWithMeta(doc.text);
  const selected = selectChapters(split.chapters, loaded.meta.slice);
  const text = formatSliceText(selected);
  const outPath = sliceOutputPath(repoRoot, loaded.ref.id);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text, 'utf-8');

  return {
    caseId: loaded.ref.id,
    outPath,
    chapterCount: selected.length,
    charCount: countChars(text),
    strategy: split.strategy,
    titles: selected.map((c) => c.title),
  };
}
