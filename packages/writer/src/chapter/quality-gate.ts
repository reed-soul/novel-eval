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
import { addUsage, zeroUsage, countChars } from '@novel-eval/shared';
import {
  assessChapters,
  DIMENSION_LABELS,
  loadPlatform,
  computePlatformGate,
  type DimensionKey,
} from '@novel-eval/eval';
import type { DB } from '../db.ts';
import type { ChapterContent } from './legacy-types.ts';
import { detectRepetition } from './repetition.ts';
import { getRecentChapters, saveEvalHistory } from './store.ts';
import { getRuntimeConfig } from '../runtime-config.ts';
import { ProjectRepository } from '../repositories/project-repository.ts';
import { projectId } from '../domain/ids.ts';

const RECENT_WINDOW = 5;

function gateConfig() {
  const cfg = getRuntimeConfig().qualityGate;
  return {
    PASS_GRADE: cfg.passGrade,
    PASS_MIN_SCORE: cfg.passMinScore,
    MIN_DIM_SCORE: cfg.minDimScore,
    BLOCK_GRADE: cfg.blockGrade,
    // 防御误配（负数/NaN/>1 会导致闸门永久失效或永不过闸）
    MIN_WORD_RATIO: Math.max(0.1, Math.min(1.0, cfg.minWordRatio || 0.75)),
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
  evaluatorEngine?: AIAgentAdapter;
  db: DB;
  projectId: string;
  /** Active / candidate chapter; `chapter.id` must be the chapter revision id. */
  chapter: ChapterContent;
  metadata: NovelMetadata;
  profile?: string;
  /** 当前重写轮次（1=初稿，2+=重写）*/
  attempt?: number;
  /** 目标字数（确定性字数闸门依据；缺省回退 generation.chapterWordCount）*/
  targetWordCount?: number;
  onProgress?: (msg: string) => void;
}

export async function assessChapterQuality(opts: QualityGateOptions): Promise<QualityGateResult & { usage: TokenUsage }> {
  const { engine, evaluatorEngine, db, projectId: rawProjectId, chapter, metadata, profile, attempt: _attempt, onProgress } = opts;
  const attempt = _attempt ?? 1;
  const evalEngine = evaluatorEngine ?? engine;
  const evaluatorModel = evaluatorEngine ? evaluatorEngine.name : null;
  const model = engine.name;  // 引擎标识（供 eval_history 追溯）
  const totalUsage: TokenUsage = { ...zeroUsage };
  // chapter.id is the published/candidate revision id (see getChapter / getRecentChapters).
  const chapterRevisionId = chapter.id;

  const projects = new ProjectRepository(db);
  const project = projects.get(projectId(rawProjectId));
  const targetPlatform = metadata.platform || project?.targetPlatform || 'general';
  const effectiveMetadata: NovelMetadata = {
    ...metadata,
    platform: targetPlatform,
  };

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
      projectId: rawProjectId, chapterNumber: chapter.number, attempt,
      verdict: result.verdict, totalScore: result.score ?? null, grade: result.grade ?? null,
      dimensions: result.dimensions ?? null, suggestions: result.suggestions ?? null,
      repetition: result.repetition ? {
        within: result.repetition.within, cross: result.repetition.cross, hotspots: result.repetition.hotspots,
      } : null,
      assessRaw: result.assessRaw ?? null,
      model, evaluatorModel,
    });
  };

  // ─── 0.5 确定性字数闸门（零 LLM 成本）────────────────────────
  // 实际字数 < 目标 × minWordRatio → 直接 revise（跳过昂贵评估），
  // 反馈带防注水诊断指引，杜绝短章/残卷过闸落盘。
  // targetWordCount 非法（0/NaN/负数）时回退全局配置——否则 NaN 比较恒 false，闸门静默失效。
  const wordRatio = gateConfig().MIN_WORD_RATIO;
  const fallbackWords = getRuntimeConfig().generation.chapterWordCount;
  const targetWords = Number.isFinite(opts.targetWordCount) && (opts.targetWordCount as number) > 0
    ? (opts.targetWordCount as number)
    : fallbackWords;
  const actualWords = countChars(chapter.content);
  if (actualWords < targetWords * wordRatio) {
    const reason = `字数不足：${actualWords} 字 < 目标 ${targetWords}×${Math.round(wordRatio * 100)}%（${Math.round(targetWords * wordRatio)} 字）`;
    const expandGuide = getRuntimeConfig().revision.expansionGuide;
    const feedback = [
      `【字数不达标——按防注水诊断扩充】`,
      `当前 ${actualWords} 字，目标 ${targetWords} 字。${expandGuide ?? '先诊断场景/节奏/情感/对话哪里薄，再对症扩充，严禁注水。'}`,
    ].join('\n');
    persistEval({ verdict: 'revise' });
    return {
      verdict: 'revise',
      reason,
      reasons: [reason],
      feedback,
      evidence: [],
      usage: totalUsage,
    };
  }

  // ─── 1. 防重复检测 ──────────────────────────────────────────────
  const recent = getRecentChapters(db, rawProjectId, chapter.number, RECENT_WINDOW);
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
    engine: evalEngine, chapters: chapterInput, profile, metadata: effectiveMetadata,
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

  // 人物塑造硬下限（2026-10-25 双盲评处方：人物薄是结构伤，总分再高也不能过闸）
  const gcChar = getRuntimeConfig().qualityGate.minCharacterization;
  const charScore = dimensions.characterization?.score;
  const charBelowFloor = gcChar !== null && Number.isFinite(gcChar)
    && typeof charScore === 'number' && charScore < gcChar;
  if (charBelowFloor) {
    const label = `${DIMENSION_LABELS.characterization ?? '人物塑造'}（${charScore}）`;
    if (!lowDims.includes(label)) lowDims.push(label);
  }

  // 情感共鸣硬下限（v3 P0-4：情感冷漠稿拦在门外；阈值校准前为 null=关闭）
  const gcEmo = getRuntimeConfig().qualityGate.minEmotionalResonance;
  const emoScore = dimensions.emotionalResonance?.score;
  const emoBelowFloor = gcEmo !== null && Number.isFinite(gcEmo)
    && typeof emoScore === 'number' && emoScore < gcEmo;
  if (emoBelowFloor) {
    const label = `${DIMENSION_LABELS.emotionalResonance ?? '情感共鸣'}（${emoScore}）`;
    if (!lowDims.includes(label)) lowDims.push(label);
  }

  const hasRepetition = rep.verdict === 'mild';
  const repPersist = {
    within: rep.withinChapter, cross: rep.crossChapter, hotspots: rep.hotspots,
  };

  // 平台投稿红线检查
  let platformGateReasons: string[] = [];
  if (targetPlatform !== 'general') {
    try {
      const platformConfig = loadPlatform(targetPlatform);
      const gate = computePlatformGate(platformConfig, dimensions);
      if (gate.verdict === 'block') {
        platformGateReasons = gate.reasons;
      }
    } catch {
      // 平台未配置时忽略红线
    }
  }
  const platformPass = platformGateReasons.length === 0;

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
      feedback: buildFeedback(
        [...platformGateReasons, ...suggestions.map((s) => s.content)],
        lowDims,
        dimensions,
        rep.hotspots,
      ),
      evidence,
      repetition: { within: rep.withinChapter, cross: rep.crossChapter, verdict: rep.verdict },
      usage: totalUsage,
    };
  }

  if (gradeOk && scoreOk && lowDims.length === 0 && !hasRepetition && platformPass) {
    persistEval({
      verdict: 'pass', score: totalScore, grade, dimensions, suggestions,
      repetition: repPersist, assessRaw,
    });
    const reason = `等级 ${grade}（${totalScore} 分），各维度达标且平台红线全过`;
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
  if (!platformPass) reasons.push(`平台投稿红线未过：${platformGateReasons.join('；')}`);

  persistEval({
    verdict: 'revise', score: totalScore, grade, dimensions, suggestions,
    repetition: repPersist, assessRaw,
  });
  return {
    verdict: 'revise',
    reason: reasons.join('；'),
    reasons,
    score: totalScore, grade,
    feedback: buildFeedback(
      [...platformGateReasons, ...suggestions.map((s) => s.content)],
      lowDims,
      dimensions,
      rep.hotspots,
    ),
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
    // v3 P0-4：行为级纠偏指引——只给分数不给动作会导致 revise 震荡耗尽重试（agy 评审警告）
    const lowDimText = lowDims.join('、');
    if (lowDimText.includes('情感') || lowDimText.includes('人物')) {
      parts.push('  【纠偏动作】严禁纯物证说明文与抽象抒情：关键线索必须从与活人的对话、照护、对视或物件传递中产出；情感用具体动作落地（递碗/扶人/翻遗物），不许写"心中酸楚/眼眶发热"类情绪标签');
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
