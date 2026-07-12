/**
 * 质量门槛 — pass/revise/block 判定
 *
 * 流程：
 *   1. 防重复检测（detectRepetition）→ severe 直接 block
 *   2. 调 eval 的 assessChapters（map + reduce）拿五维分数 + 等级
 *   3. 判定：grade ≥ B 且 writingQuality ≥ 60 → pass
 *          grade C 或某关键维度 <60 → revise（feedback = suggestions + 低分维度 analysis）
 *          grade D → block
 */
import type { AIAgentAdapter, NovelMetadata, TokenUsage } from '@novel-eval/shared';
import { addUsage, zeroUsage } from '@novel-eval/shared';
import { assessChapters, DIMENSION_LABELS } from '@novel-eval/eval';
import type { DimensionKey } from '@novel-eval/eval';
import type { DB } from '../db.ts';
import type { ChapterContent } from './types.ts';
import { detectRepetition } from './repetition.ts';
import { getRecentChapters } from './store.ts';

const RECENT_WINDOW = 5;
const PASS_GRADE = 'B';        // grade ≥ B（70 分）
const PASS_MIN_SCORE = 75;     // 总分 ≥ 75 才 pass（B 级上半段，番茄签约线）
const MIN_DIM_SCORE = 65;      // 任何关键维度低于 65 → revise
const BLOCK_GRADE = 'C';       // grade C 或 D → block（低质量章节不留）

export interface QualityGateResult {
  verdict: 'pass' | 'revise' | 'block';
  reason: string;
  score?: number;
  grade?: string;
  /** revise 时注入 prompt 的反馈（suggestions + 低分维度 + 重复 hotspots）*/
  feedback?: string;
  repetition?: { within: number; cross: number; verdict: string };
}

export interface QualityGateOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  chapter: ChapterContent;
  metadata: NovelMetadata;
  profile?: string;
  onProgress?: (msg: string) => void;
}

export async function assessChapterQuality(opts: QualityGateOptions): Promise<QualityGateResult & { usage: TokenUsage }> {
  const { engine, db, projectId, chapter, metadata, profile, onProgress } = opts;
  const totalUsage: TokenUsage = { ...zeroUsage };

  // ─── 1. 防重复检测 ──────────────────────────────────────────────
  const recent = getRecentChapters(db, projectId, chapter.number, RECENT_WINDOW);
  const recentTexts = recent.map((c) => c.content);
  const rep = detectRepetition(chapter.content, recentTexts);

  if (rep.verdict === 'severe') {
    return {
      verdict: 'block',
      reason: `重复率严重：章内 ${(rep.withinChapter * 100).toFixed(1)}% / 跨章 ${(rep.crossChapter * 100).toFixed(1)}%`,
      repetition: { within: rep.withinChapter, cross: rep.crossChapter, verdict: rep.verdict },
      usage: totalUsage,
    };
  }

  // ─── 2. eval 评估（map + reduce）────────────────────────────────
  onProgress?.(`质量门槛：评估第 ${chapter.number} 章...`);
  const chapterInput = [{ id: `ch${chapter.number}`, title: chapter.title, content: chapter.content }];
  const assessResult = await assessChapters({
    engine, chapters: chapterInput, profile, metadata,
    onProgress: (msg) => onProgress?.(`  ${msg}`),
  });
  addUsage(totalUsage, assessResult.usage);

  const { totalScore, grade, dimensions, suggestions } = assessResult;

  // ─── 3. 判定 ────────────────────────────────────────────────────
  const gradeOrder = ['S', 'A', 'B', 'C', 'D'];
  const gradeOk = gradeOrder.indexOf(grade) <= gradeOrder.indexOf(PASS_GRADE);
  const scoreOk = totalScore >= PASS_MIN_SCORE;

  // 找低分维度
  const lowDims = Object.entries(dimensions)
    .filter(([, d]) => d.score < MIN_DIM_SCORE)
    .map(([k, d]) => `${DIMENSION_LABELS[k as DimensionKey] ?? k}（${d.score}）`);

  const hasRepetition = rep.verdict === 'mild';

  // block：grade C 或 D（低质量章节不留）
  const blockOrder = gradeOrder.indexOf(BLOCK_GRADE);
  if (gradeOrder.indexOf(grade) >= blockOrder) {
    return {
      verdict: 'block',
      reason: `等级 ${grade}（${totalScore} 分）低于 ${BLOCK_GRADE} 线`,
      score: totalScore, grade,
      feedback: buildFeedback(suggestions.map((s) => s.content), lowDims, dimensions, rep.hotspots),
      repetition: { within: rep.withinChapter, cross: rep.crossChapter, verdict: rep.verdict },
      usage: totalUsage,
    };
  }

  if (gradeOk && scoreOk && lowDims.length === 0 && !hasRepetition) {
    return {
      verdict: 'pass',
      reason: `等级 ${grade}（${totalScore} 分），各维度达标`,
      score: totalScore, grade,
      repetition: { within: rep.withinChapter, cross: rep.crossChapter, verdict: rep.verdict },
      usage: totalUsage,
    };
  }

  // revise
  const reasons: string[] = [];
  if (!gradeOk) reasons.push(`等级 ${grade}（${totalScore}）低于 ${PASS_GRADE}`);
  if (!scoreOk) reasons.push(`总分 ${totalScore} 低于 ${PASS_MIN_SCORE}`);
  if (lowDims.length) reasons.push(`低分维度：${lowDims.join('、')}`);
  if (hasRepetition) reasons.push(`重复率偏高：章内 ${(rep.withinChapter * 100).toFixed(1)}%`);

  return {
    verdict: 'revise',
    reason: reasons.join('；'),
    score: totalScore, grade,
    feedback: buildFeedback(suggestions.map((s) => s.content), lowDims, dimensions, rep.hotspots),
    repetition: { within: rep.withinChapter, cross: rep.crossChapter, verdict: rep.verdict },
    usage: totalUsage,
  };
}

/** 构造 revise 反馈（注入重写 prompt）*/
function buildFeedback(
  suggestions: string[],
  lowDims: string[],
  dimensions: Record<DimensionKey, { score: number; analysis: string }>,
  hotspots: string[],
): string {
  const parts: string[] = [];

  if (lowDims.length) {
    parts.push('【低分维度分析】');
    for (const dimLabel of lowDims) {
      const dimKey = Object.entries(DIMENSION_LABELS).find(([, v]) => v === dimLabel.split('（')[0])?.[0] as DimensionKey | undefined;
      if (dimKey && dimensions[dimKey]) {
        parts.push(`  ${dimLabel}：${dimensions[dimKey].analysis.slice(0, 200)}`);
      }
    }
  }

  if (suggestions.length) {
    parts.push('【改进建议】');
    for (const s of suggestions.slice(0, 5)) {
      parts.push(`  - ${s.slice(0, 150)}`);
    }
  }

  if (hotspots.length) {
    parts.push('【重复片段（避免再次使用）】');
    for (const h of hotspots) {
      parts.push(`  - ${h}`);
    }
  }

  return parts.join('\n') || '（无具体反馈）';
}
