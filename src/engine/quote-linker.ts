/**
 * quotes 回链（生产版，对齐设计文档 v2.2「原文证据机制」）
 *
 * 策略：Map 产出的 excerpt.text（逐字摘录）→ 后端在章节正文里定位 offset
 *   1. 精确匹配 indexOf
 *   2. 模糊匹配：归一化空白/全半角标点后匹配
 *   3. 仍失败 → offset = null，matchedBy = 'none'
 *
 * spike 已验证此逻辑。
 */
import type { Excerpt, RawExcerpt } from '../types.ts';

function normalize(s: string): string {
  const map: Record<string, string> = {
    '\uFF0C': ',', '\u3002': '.', '\uFF01': '!', '\uFF1F': '?',
    '\uFF1B': ';', '\uFF1A': ':', '\u201C': '"', '\u201D': '"',
    '\u2018': "'", '\u2019': "'", '\uFF08': '(', '\uFF09': ')',
    '\u3010': '[', '\u3011': ']', '\u300A': '<', '\u300B': '>',
    '\u3001': ',',
  };
  let out = s.replace(/\s+/g, '');
  for (const [from, to] of Object.entries(map)) {
    out = out.split(from).join(to);
  }
  return out;
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
