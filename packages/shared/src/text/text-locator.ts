/**
 * 文本定位（从 quote-linker 抽出的通用核心，不依赖 eval 的 Excerpt 类型）
 *
 * 给一段文本和一个内容容器，返回精确/模糊匹配的位置。
 * eval 的 excerpt 回链和 writer 未来的段落定位都能复用。
 */

export type MatchedBy = 'exact' | 'fuzzy' | 'none';

export interface LocateResult {
  offset: number | null;
  matchedBy: MatchedBy;
}

/** 归一化：剥离所有空白、标点（P）、符号（S），只保留字母数字与 CJK 等字符 */
function normalize(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * 在 content 中定位 text 的位置。
 *   1. 精确匹配 indexOf
 *   2. 模糊匹配：归一化（剥离所有标点/空白/符号）后匹配
 *   3. 仍失败 → offset = null，matchedBy = 'none'
 *
 * 注：模糊匹配返回的 offset 是归一化串中的位置（近似），非原文精确偏移。
 */
export function locateTextInContent(text: string, content: string): LocateResult {
  // 1. 精确
  const exactIdx = content.indexOf(text);
  if (exactIdx >= 0) return { offset: exactIdx, matchedBy: 'exact' };

  // 2. 模糊
  const normText = normalize(text);
  const normContent = normalize(content);
  const fuzzyIdx = normContent.indexOf(normText);
  if (fuzzyIdx >= 0) return { offset: fuzzyIdx, matchedBy: 'fuzzy' };

  return { offset: null, matchedBy: 'none' };
}
