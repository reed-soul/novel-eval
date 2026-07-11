export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 把 analysis 里的 [chapterId#excerptIndex] 渲染为可点击标记 */
export function renderExcerptRefs(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(/\[([\w-]+)#(\d+)\]/g, (_, chId, idx) =>
    `<a href="#" class="excerpt-ref" data-chapter="${chId}" data-index="${idx}">[${chId}#${idx}]</a>`,
  );
}
