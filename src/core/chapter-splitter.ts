/**
 * 章节切分（对齐设计文档 v2.2 第三章，策略2 正则匹配）
 */
import type { MapChapterInput } from '../types.ts';

const CHAPTER_RE = /^[ \t]*第[零一二三四五六七八九十百千0-9]+[章回节卷][ \t]*[^\n]*$/gm;

export function splitChapters(rawText: string): MapChapterInput[] {
  const matches = [...rawText.matchAll(CHAPTER_RE)];
  if (matches.length === 0) {
    return [{ id: 'ch001', title: '全文', content: rawText.trim() }];
  }
  const chapters: MapChapterInput[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const headerEnd = start + matches[i][0].length;
    const title = matches[i][0].trim();
    const id = `ch${String(i + 1).padStart(3, '0')}`;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index! : rawText.length;
    const content = rawText.slice(headerEnd, nextStart).trim();
    chapters.push({ id, title, content });
  }
  return chapters;
}

export function countChars(text: string): number {
  return [...text].filter((ch) => /\S/.test(ch)).length;
}

/** 推断章节类型（prologue/epilogue/main/extra）*/
export function inferKind(title: string): 'main' | 'extra' | 'prologue' | 'epilogue' {
  if (/楔子|序|引子|前言/i.test(title)) return 'prologue';
  if (/尾声|后记|跋|尾声/i.test(title)) return 'epilogue';
  if (/番外|外篇|特别/i.test(title)) return 'extra';
  return 'main';
}
