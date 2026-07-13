/**
 * 内存版评估 — 供 writer 质量门槛复用
 *
 * 区别于 evaluate()（文件版：parseTxt → splitChapters → map → reduce → 报告），
 * assessChapters 直接接收内存里的 ChapterInput[]，跑 map+reduce+聚合，
 * 返回五维分数+等级+suggestions。不碰文件/报告/preflight。
 */
import type { AIAgentAdapter, NovelMetadata, TokenUsage } from '@novel-eval/shared';
import { addUsage, zeroUsage } from '@novel-eval/shared';
import { runMapPhase } from './map-phase.ts';
import { runReducePhase } from './reduce-phase.ts';
import { loadConfig, computeOverall, lookupGrade } from './config.ts';
import type {
  Chapter, ChapterInput, DimensionKey, DimensionScore, Suggestion,
} from './types.ts';

export interface AssessOptions {
  engine: AIAgentAdapter;
  chapters: ChapterInput[];        // writer 直接传 {id,title,content}
  profile?: string;                // 默认 'default'
  metadata: NovelMetadata;         // genre/audience
  onProgress?: (msg: string) => void;
}

export interface AssessResult {
  totalScore: number;
  grade: string;                   // S/A/B/C/D
  dimensions: Record<DimensionKey, DimensionScore>;
  chapters: Chapter[];             // map 产出（含 excerpts）
  suggestions: Suggestion[];       // R4 改进建议（revise 时喂回 prompt）
  usage: TokenUsage;
  failures: string[];              // 非致命失败（R1/R3/R4/R5）
}

export async function assessChapters(opts: AssessOptions): Promise<AssessResult> {
  const { engine, chapters, metadata, onProgress } = opts;
  const profileName = opts.profile ?? 'default';
  const config = loadConfig(profileName);
  const totalUsage: TokenUsage = { ...zeroUsage };

  // Map：逐章评估（5 并发）
  onProgress?.(`评估 Map：${chapters.length} 章...`);
  const mapResult = await runMapPhase(engine, chapters);
  addUsage(totalUsage, mapResult.usage);

  // Reduce：单章质量门槛走 lite 模式（跳过 R3 情绪曲线 / R5 市场对标——单章路径不消费）
  onProgress?.('评估 Reduce：R1→R2→R4（lite）...');
  const reduceResult = await runReducePhase(
    engine, mapResult.chapters, config.profile.weights, profileName, metadata,
    undefined, 'lite',
  );
  addUsage(totalUsage, reduceResult.usage);

  // 聚合：维度分 × 权重 → 总分 → 等级
  const totalScore = computeOverall(reduceResult.dimensions, config.profile.weights);
  const grade = lookupGrade(totalScore, config.gradeThresholds);

  onProgress?.(`评估完成：${totalScore}（${grade}）`);

  return {
    totalScore,
    grade,
    dimensions: reduceResult.dimensions,
    chapters: mapResult.chapters,
    suggestions: reduceResult.suggestions,
    usage: totalUsage,
    failures: reduceResult.failures,
  };
}
