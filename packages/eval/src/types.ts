/**
 * @novel-eval/eval — 评估专属类型
 *
 * 八维评分、证据机制、评估结果、评估配置。
 * 共享类型（TokenUsage/EngineConfig/NovelMetadata/ChapterInput/BaseChapter/
 * CharacterProfile）从 @novel-eval/shared 重新导出，保持现有代码 import 路径不变。
 */
// 从 shared 重新导出共享类型（eval 内部代码沿用 from '../types.ts' 习惯）
export type {
  TokenUsage,
  EngineConfig,
  NovelMetadata,
  ChapterKind,
  ChapterInput,
  BaseChapter,
  CharacterProfile,
  CharacterRelationship,
} from '@novel-eval/shared';

import type {
  BaseChapter,
  CharacterProfile,
  ChapterInput,
} from '@novel-eval/shared';

// ─── 任务与状态 ────────────────────────────────────────────────────

export type TaskStatus =
  | 'pending' | 'parsing' | 'splitting'
  | 'mapping' | 'reducing' | 'generating'
  | 'completed' | 'failed';

export interface EvaluationTask {
  id: string;
  filePath: string;
  fileName: string;
  format: 'txt' | 'epub' | 'pdf' | 'docx';
  status: TaskStatus;
  progress: { current: number; total: number; message: string };
  error: Error | null;
  engine: string;
  configSnapshot: object;
  cost: { inputTokens: number; outputTokens: number; totalRmb: number };
  checkpoint: EvaluationCheckpoint | null;
  sourceWordCount: number;
  chapterCount: number;
  createdAt: Date;
  completedAt?: Date;
  resultFile?: string;
  reportFile?: string;
}

export interface EvaluationCheckpoint {
  phase: 'split' | 'map' | 'reduce';
  completedChapterIds: string[];
  reduceSubstep?: 'r1' | 'r2' | 'r3' | 'r4' | 'done';
  partialResultPath: string;
  sessionId?: string;
}

// ─── 八维评分 ──────────────────────────────────────────────────────
// 五维（故事架构/人物塑造/文笔质量/情感共鸣/市场潜力）+ 三维新增：
//   thematicDepth  主题深度（文学奖维度：思想性、现实映照、不说教）
//   originality     原创性（文学奖+学术：反套路、设定/结构/手法创新）
//   pacingRetention 节奏留存（网文维度：章节钩子、爽点密度、中段拖沓）

export type DimensionKey =
  | 'storyStructure'
  | 'characterization'
  | 'writingQuality'
  | 'emotionalResonance'
  | 'marketPotential'
  | 'thematicDepth'
  | 'originality'
  | 'pacingRetention';

export const DIMENSION_KEYS: DimensionKey[] = [
  'storyStructure', 'characterization', 'writingQuality',
  'emotionalResonance', 'marketPotential',
  'thematicDepth', 'originality', 'pacingRetention',
];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  storyStructure: '故事架构',
  characterization: '人物塑造',
  writingQuality: '文笔质量',
  emotionalResonance: '情感共鸣',
  marketPotential: '市场潜力',
  thematicDepth: '主题深度',
  originality: '原创性',
  pacingRetention: '节奏留存',
};

export interface DimensionScore {
  score: number;
  subscores?: Record<string, number>;
  analysis: string;
}

// ─── 原文证据（Map 产出，后端回链 offset）─────────────────────────

export interface RawExcerpt {
  text: string;
  dimension: DimensionKey;
  reason: string;
}

export interface Excerpt extends RawExcerpt {
  chapterId: string;
  offset: number | null;
  matchedBy: 'exact' | 'fuzzy' | 'none';
  length?: number;
}

// ─── Reduce 阶段引用证据的指针 ─────────────────────────────────────

export interface ExcerptRef {
  chapterId: string;
  excerptIndex: number;
}

// ─── Map 阶段（逐章）──────────────────────────────────────────────

/** 保留旧别名：MapChapterInput === shared 的 ChapterInput */
export type MapChapterInput = ChapterInput;

export interface MapChapterOutput {
  summary: string;
  emotionalTension: number;
  keyEvents: string[];
  characters: string[];
  excerpts: RawExcerpt[];
}

export interface Chapter extends BaseChapter, MapChapterOutput {
  excerpts: Excerpt[];
}

// ─── Reduce R1 人物归一化（Character = shared 的 CharacterProfile 别名）───

export type Character = CharacterProfile;

// ─── Reduce R3 情绪曲线 ────────────────────────────────────────────

export interface EmotionalPoint {
  chapterId: string;
  tension: number;
  annotation?: string | null;
}

// ─── Reduce R4 改进建议 ────────────────────────────────────────────

export interface Suggestion {
  dimension: string;
  type?: string;
  content: string;
  relatedChapters?: string[];
  excerptRef?: ExcerptRef | null;
}

// ─── R5 市场对标 ───────────────────────────────────────────────────

export interface MarketComparable {
  title: string;
  similarity: number;
  matchReason: string;
  differentiation: string;
  referenceNote: string;
}

export interface MarketBenchmark {
  positioning: string;
  audienceFit: number;
  comparables: MarketComparable[];
  disclaimer: string;
}

// ─── 改稿对比 ─────────────────────────────────────────────────────

export interface DimensionDelta {
  baseline: number;
  current: number;
  delta: number;
}

export interface CompareResult {
  baseline: { taskId: string; title: string; overall: number; grade: string; completedAt: string };
  current: { taskId: string; title: string; overall: number; grade: string; completedAt: string };
  dimensionDeltas: Record<DimensionKey, DimensionDelta>;
  overallDelta: number;
  suggestionsAdded: string[];
  suggestionsRemoved: string[];
}

// ─── 评估结果（最终 JSON）──────────────────────────────────────────

export interface EvaluationResult {
  schemaVersion: string;
  novel: {
    title: string;
    author: string;
    totalChapters: number;
    wordCount: number;
    genre?: string;
    targetAudience?: string;
    platform?: string;
  };
  overall: { totalScore: number; grade: string };
  dimensions: Record<DimensionKey, DimensionScore>;
  chapters: Chapter[];
  characters: Character[];
  emotionalCurve: EmotionalPoint[];
  excerpts: Excerpt[];
  suggestions: Suggestion[];
  marketBenchmark?: MarketBenchmark | null;
  baselineTaskId?: string;
  task: {
    id: string;
    error: string | null;
    engine: string;
    configSnapshot: object;
    cost: { inputTokens: number; outputTokens: number; totalRmb: number };
    checkpoint: EvaluationCheckpoint | null;
    sourceWordCount: number;
    chapterCount: number;
    createdAt: string;
    completedAt: string;
  };
}

// ─── 配置 ─────────────────────────────────────────────────────────

export interface ProfileConfig {
  weights: Record<DimensionKey, number>;
}

export interface GradeThresholds {
  S: number;
  A: number;
  B: number;
  C: number;
  D: number;
}
