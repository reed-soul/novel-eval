/**
 * quotes 回链（生产版，对齐设计文档 v2.2「原文证据机制」）
 *
 * 策略：Map 产出的 excerpt.text（逐字摘录）→ 后端在章节正文里定位 offset
 *   1. 精确匹配 indexOf
 *   2. 模糊匹配：归一化（剥离所有标点/空白/符号）后匹配
 *   3. 仍失败 → offset = null，matchedBy = 'none'
 *
 * 归一化采用「剥离」而非「全角转半角」：逐字摘录常与原文存在标点差异
 * （摘录插入/省略逗号、句号等）。仅做等价字符替换救不了「多/少一个标点」，
 * 剥离所有 Unicode 标点与符号后比对，才能容忍这类差异。
 *
 * 注：模糊匹配返回的 offset 是归一化串中的位置（近似），非原文精确偏移。
 * 设计文档第 186 行接受模糊 offset 为「近似 offset」。
 */
import type { Excerpt, RawExcerpt } from '../types.ts';

function normalize(s: string): string {
  // 剥离所有空白、标点（P）、符号（S），只保留字母数字与 CJK 等字符
  return s.replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 在给定章节正文中回链一条 excerpt，补 offset + matchedBy */
export function linkExcerpt(
  raw: RawExcerpt,
  chapterId: string,
  chapters: Map<string, string>,
): Excerpt {
  const content = chapters.get(chapterId);
  const base: Excerpt = { ...raw, chapterId, offset: null, matchedBy: 'none' };
  if (!content) return base;

  // 1. 精确
  const exactIdx = content.indexOf(raw.text);
  if (exactIdx >= 0) return { ...base, offset: exactIdx, matchedBy: 'exact' };

  // 2. 模糊
  const normQuote = normalize(raw.text);
  const normContent = normalize(content);
  const fuzzyIdx = normContent.indexOf(normQuote);
  if (fuzzyIdx >= 0) return { ...base, offset: fuzzyIdx, matchedBy: 'fuzzy' };

  return base;
}

/** 批量回链，返回统计 */
export function linkExcerpts(
  raws: Array<RawExcerpt & { chapterId: string }>,
  chapters: Map<string, string>,
): { linked: Excerpt[]; stats: { exact: number; fuzzy: number; none: number; total: number } } {
  const linked = raws.map((r) => linkExcerpt(r, r.chapterId, chapters));
  const stats = {
    exact: linked.filter((l) => l.matchedBy === 'exact').length,
    fuzzy: linked.filter((l) => l.matchedBy === 'fuzzy').length,
    none: linked.filter((l) => l.matchedBy === 'none').length,
    total: linked.length,
  };
  return { linked, stats };
}
