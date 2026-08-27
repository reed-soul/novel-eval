/**
 * Resolve eval-side chapter refs (ch001, ch-10, "12") to outline positions.
 */
export function resolveEvalChapterRef(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // 用 String.match 而非 RegExp.exec：exec 与 child_process 同名，污点引擎会把
  // 链上的正则调用误分类为命令执行 sink（纯函数假链），match 语义等价且无歧义。
  const chMatch = trimmed.match(/^ch-?0*(\d+)$/i);
  if (chMatch) {
    const n = Number.parseInt(chMatch[1]!, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  return null;
}

/**
 * Pick a single chapter number from revision-task chapter refs.
 * Prefers excerptRef.chapterId, else relatedChapters when length === 1.
 */
export function resolveSingleChapterFromTask(input: {
  excerptRef?: { chapterId: string } | null;
  relatedChapters?: string[];
  scope?: string;
}): { chapterNumber: number } | { error: string } {
  const fromExcerpt = input.excerptRef?.chapterId;
  if (typeof fromExcerpt === 'string' && fromExcerpt.trim() !== '') {
    const n = resolveEvalChapterRef(fromExcerpt);
    if (n === null) {
      return { error: `cannot parse excerptRef.chapterId: ${fromExcerpt}` };
    }
    return { chapterNumber: n };
  }

  const related = input.relatedChapters ?? [];
  if (related.length === 1) {
    const n = resolveEvalChapterRef(related[0]!);
    if (n === null) {
      return { error: `cannot parse relatedChapters[0]: ${related[0]}` };
    }
    return { chapterNumber: n };
  }

  if (related.length > 1) {
    return {
      error: `revision task spans ${related.length} chapters; pick a chapter-scoped task`,
    };
  }

  return { error: 'revision task has no chapter reference' };
}
