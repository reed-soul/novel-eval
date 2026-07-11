/**
 * excerpts 回链（评估专属，包装 shared 的通用文本定位逻辑）
 *
 * 策略：Map 产出的 excerpt.text（逐字摘录）→ 后端在章节正文里定位 offset
 *   1. 精确匹配 indexOf
 *   2. 模糊匹配：归一化（剥离所有标点/空白/符号）后匹配
 *   3. 仍失败 → offset = null，matchedBy = 'none'
 *
 * 核心定位逻辑在 @novel-eval/shared 的 locateTextInContent（不依赖 Excerpt 类型）。
 */
import { locateTextInContent } from '@novel-eval/shared';
import type { Excerpt, RawExcerpt } from './types.ts';

/** 在给定章节正文中回链一条 excerpt，补 offset + matchedBy */
export function linkExcerpt(
  raw: RawExcerpt,
  chapterId: string,
  chapters: Map<string, string>,
): Excerpt {
  const content = chapters.get(chapterId);
  const base: Excerpt = { ...raw, chapterId, offset: null, matchedBy: 'none' };
  if (!content) return base;
  const { offset, matchedBy } = locateTextInContent(raw.text, content);
  return { ...base, offset, matchedBy };
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
