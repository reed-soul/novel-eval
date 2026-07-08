/**
 * 评估前预检：解析 + 分章，供确认屏使用（不调 LLM）
 */
import { parseTxt } from '../parser/txt-parser.ts';
import { splitChapters, countChars } from './chapter-splitter.ts';
import { estimateEvaluation } from './estimate.ts';
import type { NovelMetadata } from '../types.ts';

export interface PreflightResult {
  fileName: string;
  wordCount: number;
  chapterCount: number;
  title?: string;
  author?: string;
  estimate: ReturnType<typeof estimateEvaluation>;
}

export function runPreflight(filePath: string): PreflightResult {
  const doc = parseTxt(filePath);
  const chapters = splitChapters(doc.text);
  const wordCount = countChars(doc.text);
  const fileName = filePath.split('/').pop() ?? filePath;
  return {
    fileName,
    wordCount,
    chapterCount: chapters.length,
    title: doc.title,
    author: doc.author,
    estimate: estimateEvaluation(chapters.length),
  };
}

export function formatPreflightSummary(
  preflight: PreflightResult,
  metadata: NovelMetadata,
): string {
  const { estimate } = preflight;
  const lines = [
    `📄 ${preflight.fileName} · ${preflight.wordCount.toLocaleString()} 字 · ${preflight.chapterCount} 章`,
    `📋 ${metadata.genre} · ${metadata.targetAudience}${metadata.platform ? ` · ${metadata.platform}` : ''}`,
    `⏱ 预估：~${estimate.minutesMin}-${estimate.minutesMax} min · 💰 约 ¥${estimate.costMinRmb}-${estimate.costMaxRmb}`,
  ];
  return lines.join('\n');
}
