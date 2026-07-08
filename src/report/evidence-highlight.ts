/**
 * 证据高亮上下文切片（纯逻辑，供单测与报告脚本复用思路）
 */
import type { Excerpt } from '../types.ts';

export interface HighlightSlice {
  before: string;
  highlight: string;
  after: string;
}

const CONTEXT_RADIUS = 200;

export function sliceHighlightedExcerpt(content: string, excerpt: Excerpt): HighlightSlice {
  const { text, offset, matchedBy } = excerpt;
  if (offset != null && matchedBy === 'exact' && content.slice(offset, offset + text.length) === text) {
    const start = Math.max(0, offset - CONTEXT_RADIUS);
    const end = Math.min(content.length, offset + text.length + CONTEXT_RADIUS);
    return {
      before: content.slice(start, offset),
      highlight: text,
      after: content.slice(offset + text.length, end),
    };
  }
  const idx = content.indexOf(text);
  if (idx >= 0) {
    const start = Math.max(0, idx - CONTEXT_RADIUS);
    const end = Math.min(content.length, idx + text.length + CONTEXT_RADIUS);
    return {
      before: content.slice(start, idx),
      highlight: text,
      after: content.slice(idx + text.length, end),
    };
  }
  return { before: '', highlight: text, after: '' };
}
