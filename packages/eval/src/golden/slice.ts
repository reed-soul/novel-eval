/**
 * Slice full novels into short golden fixtures for affordable evaluation.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseTxt, splitChaptersWithMeta, countChars } from '@novel-eval/shared';
import type { ChapterInput } from '@novel-eval/shared';
import type { CheckReport, LoadedGoldenCase, SlicePolicy, SliceReport } from './types.ts';
import { sliceOutputPath } from './load-corpus.ts';

export function selectChapters(
  chapters: ChapterInput[],
  policy: SlicePolicy,
): ChapterInput[] {
  const selected: ChapterInput[] = [];
  let chars = 0;
  for (const chapter of chapters) {
    if (selected.length >= policy.maxChapters) break;
    const next = countChars(chapter.content);
    if (selected.length > 0 && chars + next > policy.maxChars) break;

    if (chars + next > policy.maxChars && selected.length === 0) {
      // Single oversized chapter: keep a head slice so eval stays affordable.
      const truncated = truncateToChars(chapter.content, policy.maxChars);
      selected.push({ ...chapter, content: truncated });
      break;
    }

    selected.push(chapter);
    chars += next;
    if (chars >= policy.maxChars) break;
  }
  return selected.length > 0 ? selected : chapters.slice(0, 1);
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
      // Prefer keeping an existing 第X章 style title; otherwise prefix.
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
    const chars = countChars(doc.text);
    return {
      caseId: loaded.ref.id,
      ok: split.chapters.length > 0,
      sourceExists: true,
      chapterCount: split.chapters.length,
      charCount: chars,
      strategy: split.strategy,
      confidence: split.confidence,
      error: split.chapters.length === 0 ? 'no chapters detected' : undefined,
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
