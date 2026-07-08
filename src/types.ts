/**
 * Novel Eval — 类型定义（生产版，对齐设计文档 v2.2 第九章）
 */

// ─── 任务与状态 ────────────────────────────────────────────────────

export type TaskStatus =
  | 'pending' | 'parsing' | 'splitting'
  | 'mapping' | 'reducing' | 'generating'
  | 'completed' | 'failed';
// 注：'reducing' 覆盖 Reduce Pipeline 的 R1→R2→R3→R4 四个子步骤，
//     细粒度进度见 EvaluationCheckpoint.reduceSubstep

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

// ─── 五维评分 ──────────────────────────────────────────────────────

export type DimensionKey =
  | 'storyStructure'
  | 'characterization'
  | 'writingQuality'
  | 'emotionalResonance'
  | 'marketPotential';

export const DIMENSION_KEYS: DimensionKey[] = [
  'storyStructure', 'characterization', 'writingQuality',
  'emotionalResonance', 'marketPotential',
];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  storyStructure: '故事架构',
  characterization: '人物塑造',
  writingQuality: '文笔质量',
  emotionalResonance: '情感共鸣',
  marketPotential: '市场潜力',
};

export interface DimensionScore {
  score: number;
  subscores?: Record<string, number>;
  analysis: string;  // 含 [chapterId#excerptIndex] 指针
}

// ─── 原文证据（Map 产出，后端回链 offset）─────────────────────────

export interface RawExcerpt {
  text: string;        // 逐字摘录的原文片段（Map 阶段从本章正文复制）
  dimension: DimensionKey;
  reason: string;
}

export interface Excerpt extends RawExcerpt {
  chapterId: string;
  offset: number | null;
  matchedBy: 'exact' | 'fuzzy' | 'none';
}

// ─── Reduce 阶段引用证据的指针 ─────────────────────────────────────

export interface ExcerptRef {
  chapterId: string;
  excerptIndex: number;
}

// ─── Map 阶段（逐章）──────────────────────────────────────────────

export interface MapChapterInput {
  id: string;
  title: string;
  content: string;
}

export interface MapChapterOutput {
  summary: string;
  emotionalTension: number;
  keyEvents: string[];
  characters: string[];
  excerpts: RawExcerpt[];
}

export interface Chapter extends MapChapterInput, MapChapterOutput {
  wordCount: number;
  kind: 'main' | 'extra' | 'prologue' | 'epilogue';
  excerpts: Excerpt[];  // 已回链（覆盖 MapChapterOutput 的 RawExcerpt[]）
}

// ─── Reduce R1 人物归一化 ──────────────────────────────────────────

export interface Character {
  name: string;
  aliases?: string[];
  role: string;
  arc?: string;
  firstAppearance?: string;
  keyChapters?: string[];
  relationships?: CharacterRelationship[];
}

export interface CharacterRelationship {
  target: string;
  type: string;
  strength: number;
}

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

// ─── 评估结果（最终 JSON）──────────────────────────────────────────

export interface EvaluationResult {
  schemaVersion: string;
  novel: { title: string; author: string; totalChapters: number; wordCount: number };
  overall: { totalScore: number; grade: string };
  dimensions: Record<DimensionKey, DimensionScore>;
  chapters: Chapter[];
  characters: Character[];
  emotionalCurve: EmotionalPoint[];
  excerpts: Excerpt[];  // 全局展平的所有 excerpts（便于前端检索）
  suggestions: Suggestion[];
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

// ─── token / 费用 ─────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costRmb: number;
  model: string;
  durationMs: number;
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

export interface EngineConfig {
  baseUrl: string;
  model: string;
  maxBudgetRmb: number;
  perChapterMaxBudgetRmb: number;
}
