/**
 * 质量门槛 — pass/revise/block 判定
 *
 * 流程：
 *   1. 防重复检测 → severe → block + hardBlock（不可消耗 maxRevise）
 *   2. assessChapters（map + reduce）拿八维分数 + 等级；结果写入 eval_history.assess_raw
 *   3. 判定（阈值见 writer.yml qualityGate）：
 *      - grade/score/维度达标且无 mild 重复 → pass
 *      - grade ≥ blockGrade → block（软挡：带 feedback，可消耗 maxRevise）
 *      - 其余未达标 → revise
 */
import type { AIAgentAdapter, NovelMetadata, TokenUsage } from '@novel-eval/shared';
import { addUsage, zeroUsage } from '@novel-eval/shared';
import { assessChapters, DIMENSION_LABELS } from '@novel-eval/eval';
import type { DimensionKey } from '@novel-eval/eval';
import type { DB } from '../db.ts';
import type { ChapterContent } from './legacy-types.ts';
import { detectRepetition } from './repetition.ts';
import { getRecentChapters, saveEvalHistory } from './store.ts';
import { getRuntimeConfig } from '../runtime-config.ts';

const RECENT_WINDOW = 5;

function gateConfig() {
  const cfg = getRuntimeConfig().qualityGate;
  return {
    PASS_GRADE: cfg.passGrade,
    PASS_MIN_SCORE: cfg.passMinScore,
    MIN_DIM_SCORE: cfg.minDimScore,
    BLOCK_GRADE: cfg.blockGrade,
  };
}

export interface QualityGateEvidence {
  chapterId: string;
  excerptIndex?: number;
  text: string;
  dimension: string;
  reason: string;
  matchedBy?: string;
  offset?: number | null;
}

export interface QualityGateResult {
  verdict: 'pass' | 'revise' | 'block';
  reason: string;
  reasons: string[];
  score?: number;
  grade?: string;
  /** revise 时注入 prompt 的反馈（suggestions + 低分维度 + 重复 hotspots）*/
  feedback?: string;
  /**
   * When true, generation must not consume maxRevise (severe repetition).
   * Grade-based block stays soft (hardBlock false/undefined).
   */
  hardBlock?: boolean;
  repetition?: { within: number; cross: number; verdict: string };
  evidence: QualityGateEvidence[];
}

export interface QualityGateOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  /** Active / candidate chapter; `chapter.id` must be the chapter revision id. */
  chapter: ChapterContent;
  metadata: NovelMetadata;
  profile?: string;
  /** 当前重写轮次（1=初稿，2+=重写）*/
  attempt?: number;
  onProgress?: (msg: string) => void;
}

export async function assessChapterQuality(opts: QualityGateOptions): Promise<QualityGateResult & { usage: TokenUsage }> {
  const { engine, db, projectId, chapter, metadata, profile, attempt: _attempt, onProgress } = opts;
  const attempt = _attempt ?? 1;
  const model = engine.name;  // 引擎标识（供 eval_history 追溯）
  const totalUsage: TokenUsage = { ...zeroUsage };
  // chapter.id is the published/candidate revision id (see getChapter / getRecentChapters).
  const chapterRevisionId = chapter.id;

  // ─── 0. 内部辅助：持久化评估记录 ──────────────────────────────────
  const persistEval = (result: {
    verdict: 'pass' | 'revise' | 'block';
    score?: number; grade?: string;
    dimensions?: Record<string, { score: number; analysis: string }>;
    suggestions?: Array<{ dimension?: string; content: string }>;
    repetition?: { within: number; cross: number; hotspots: string[] };
    assessRaw?: unknown | null;
  }) => {
    saveEvalHistory(db, {
      projectId, chapterNumber: chapter.number, attempt,
      verdict: result.verdict, totalScore: result.score ?? null, grade: result.grade ?? null,
      dimensions: result.dimensions ?? null, suggestions: result.suggestions ?? null,
      repetition: result.repetition ? {
        within: result.repetition.within, cross: result.repetition.cross, hotspots: result.repetition.hotspots,
      } : null,
      assessRaw: result.assessRaw ?? null,
      model, evaluatorModel: null,  // 自评
    });
  };

  // ─── 1. 防重复检测 ──────────────────────────────────────────────
  const recent = getRecentChapters(db, projectId, chapter.number, RECENT_WINDOW);
  const recentTexts = recent.map((c) => c.content);
  const rep = detectRepetition(chapter.content, recentTexts);

  if (rep.verdict === 'severe') {
    persistEval({
      verdict: 'block',
      repetition: { within: rep.withinChapter, cross: rep.crossChapter, hotspots: rep.hotspots },
    });
    const reason = `重复率严重：章内 ${(rep.withinChapter * 100).toFixed(1)}% / 跨章 ${(rep.crossChapter * 100).toFixed(1)}%`;
    return {
      verdict: 'block',
      hardBlock: true,
      reason,
      reasons: [reason],
      evidence: [],
      repetition: { within: rep.withinChapter, cross: rep.crossChapter, verdict: rep.verdict },
      usage: totalUsage,
    };
  }

  // ─── 2. eval 评估（map + reduce）────────────────────────────────
  onProgress?.(`质量门槛：评估第 ${chapter.number} 章...`);
  const chapterInput = [{ id: chapterRevisionId, title: chapter.title, content: chapter.content }];
  const assessResult = await assessChapters({
    engine, chapters: chapterInput, profile, metadata,
    onProgress: (msg) => onProgress?.(`  ${msg}`),
  });
  addUsage(totalUsage, assessResult.usage);

  const { totalScore, grade, dimensions, suggestions } = assessResult;
  const assessRaw = {
    totalScore,
    grade,
    dimensions,
    suggestions,
    failures: assessResult.failures,
    chapters: assessResult.chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      excerpts: ch.excerpts,
    })),
  };
  const evidence: QualityGateEvidence[] = assessResult.chapters.flatMap((ch) =>
    (ch.excerpts ?? []).map((ex, excerptIndex) => ({
      chapterId: ch.id,
      excerptIndex,
      text: ex.text,
      dimension: ex.dimension,
      reason: ex.reason,
      matchedBy: ex.matchedBy,
      offset: ex.offset,
    })),
  );

  // ─── 3. 判定 ────────────────────────────────────────────────────
  const gc = gateConfig();
  const gradeOrder = ['S', 'A', 'B', 'C', 'D'];
  const gradeOk = gradeOrder.indexOf(grade) <= gradeOrder.indexOf(gc.PASS_GRADE);
  const scoreOk = totalScore >= gc.PASS_MIN_SCORE;

  // 找低分维度
  const lowDims = Object.entries(dimensions)
    .filter(([, d]) => d.score < gc.MIN_DIM_SCORE)
    .map(([k, d]) => `${DIMENSION_LABELS[k as DimensionKey] ?? k}（${d.score}）`);

  const hasRepetition = rep.verdict === 'mild';
  const repPersist = {
    within: rep.withinChapter, cross: rep.crossChapter, hotspots: rep.hotspots,
  };

  // Soft block：grade ≥ BLOCK_GRADE（可消耗 maxRevise；仅 severe 复读 hardBlock）
  const blockOrder = gradeOrder.indexOf(gc.BLOCK_GRADE);
  if (gradeOrder.indexOf(grade) >= blockOrder) {
    persistEval({
      verdict: 'block', score: totalScore, grade, dimensions, suggestions,
      repetition: repPersist, assessRaw,
    });
    const reason = `等级 ${grade}（${totalScore} 分）低于 ${gc.BLOCK_GRADE} 线`;
    return {
      verdict: 'block',
      hardBlock: false,
      reason,
      reasons: [reason],
      score: totalScore, grade,
      feedback: buildFeedback(suggestions.map((s) => s.content), lowDims, dimensions, rep.hotspots),
      evidence,
      repetition: { within: rep.withinChapter, cross: rep.crossChapter, verdict: rep.verdict },
      usage: totalUsage,
    };
  }

  if (gradeOk && scoreOk && lowDims.length === 0 && !hasRepetition) {
    persistEval({
      verdict: 'pass', score: totalScore, grade, dimensions, suggestions,
      repetition: repPersist, assessRaw,
    });
    const reason = `等级 ${grade}（${totalScore} 分），各维度达标`;
    return {
      verdict: 'pass',
      reason,
      reasons: [reason],
      score: totalScore, grade,
      evidence,
      repetition: { within: rep.withinChapter, cross: rep.crossChapter, verdict: rep.verdict },
      usage: totalUsage,
    };
  }

  // revise
  const reasons: string[] = [];
  if (!gradeOk) reasons.push(`等级 ${grade}（${totalScore}）低于 ${gc.PASS_GRADE}`);
  if (!scoreOk) reasons.push(`总分 ${totalScore} 低于 ${gc.PASS_MIN_SCORE}`);
  if (lowDims.length) reasons.push(`低分维度：${lowDims.join('、')}`);
  if (hasRepetition) reasons.push(`重复率偏高：章内 ${(rep.withinChapter * 100).toFixed(1)}%`);

  persistEval({
    verdict: 'revise', score: totalScore, grade, dimensions, suggestions,
    repetition: repPersist, assessRaw,
  });
  return {
    verdict: 'revise',
    reason: reasons.join('；'),
    reasons,
    score: totalScore, grade,
    feedback: buildFeedback(suggestions.map((s) => s.content), lowDims, dimensions, rep.hotspots),
    evidence,
    repetition: { within: rep.withinChapter, cross: rep.crossChapter, verdict: rep.verdict },
    usage: totalUsage,
  };
}

/** 构造 revise/修正 反馈（注入重写 prompt）。导出供 corrector 复用。*/
export function buildFeedback(
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
