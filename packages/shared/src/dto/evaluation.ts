import { fail, isRecord, type ParseResult } from './parse.ts';
import type { CharacterProfile, CharacterRelationship } from '../types.ts';

export const EVALUATION_DIMENSION_KEYS = [
  'storyStructure',
  'characterization',
  'writingQuality',
  'emotionalResonance',
  'marketPotential',
  'thematicDepth',
  'originality',
  'pacingRetention',
] as const;

export type EvaluationDimensionKey = typeof EVALUATION_DIMENSION_KEYS[number];

export const EVALUATION_DIMENSION_LABELS: Record<EvaluationDimensionKey, string> = {
  storyStructure: '故事架构',
  characterization: '人物塑造',
  writingQuality: '文笔质量',
  emotionalResonance: '情感共鸣',
  marketPotential: '市场潜力',
  thematicDepth: '主题深度',
  originality: '原创性',
  pacingRetention: '节奏留存',
};

/** Dimension scores exposed to the web client (B7 may expand UI to all eight). */
export interface EvaluationDimensionDto {
  score: number;
  analysis: string;
  subscores?: Record<string, number>;
}

export interface EvaluationNovelDto {
  title: string;
  author: string;
  totalChapters: number;
  wordCount: number;
  genre?: string;
  targetAudience?: string;
  platform?: string;
}

export interface EvaluationOverallDto {
  totalScore: number;
  grade: string;
}

export interface EvaluationEmotionalPointDto {
  chapterId: string;
  tension: number;
  annotation?: string | null;
}

export interface EvaluationSuggestionDto {
  dimension: string;
  type?: string;
  content: string;
  relatedChapters?: string[];
  excerptRef?: {
    chapterId: string;
    excerptIndex: number;
  } | null;
}

export interface EvaluationMarketComparableDto {
  title: string;
  similarity: number;
  matchReason: string;
  differentiation: string;
  referenceNote?: string;
}

export interface EvaluationMarketBenchmarkDto {
  positioning: string;
  audienceFit: number;
  comparables: EvaluationMarketComparableDto[];
  disclaimer?: string;
}

export interface EvaluationExcerptDto {
  text: string;
  dimension: string;
  reason: string;
  chapterId?: string;
  excerptIndex?: number;
  offset?: number | null;
  matchedBy?: string;
  length?: number;
}

export interface EvaluationCoverageDto {
  complete: boolean;
  dimensionsExpected: EvaluationDimensionKey[];
  dimensionsPresent: string[];
  missingDimensions: EvaluationDimensionKey[];
  excerptCount: number;
  chapterCount?: number;
  sourceWordCount?: number;
  /** Map-phase chapters that failed and were placeholder-skipped. */
  skippedChapterIds?: string[];
  skippedChapterCount?: number;
  /** skippedChapterCount / chapterCount, 0..1 */
  chapterSkipRate?: number;
  /** Excerpts with matchedBy exact|fuzzy (or offset != null when matchedBy absent). */
  evidenceLinkedCount?: number;
  evidenceUnlinkedCount?: number;
  /** linked / excerptCount, 0..1; undefined when excerptCount === 0 */
  evidenceLinkRate?: number;
  /** Human-readable incomplete reasons (empty when complete). */
  incompleteReasons?: string[];
}

/** Default Stage C2 coverage gates. */
export const DEFAULT_COVERAGE_THRESHOLDS = {
  minEvidenceLinkRate: 0.5,
  maxChapterSkipRate: 0.3,
} as const;

export interface CoverageThresholds {
  minEvidenceLinkRate: number;
  maxChapterSkipRate: number;
}

export interface EvaluationCoverageInput {
  dimensions: Record<string, EvaluationDimensionDto>;
  excerpts?: readonly EvaluationExcerptDto[];
  chapters?: readonly unknown[];
  task?: { sourceWordCount?: number; chapterCount?: number };
  skippedChapterIds?: readonly string[];
  thresholds?: Partial<CoverageThresholds>;
}

/**
 * Stable evaluation report DTO for GET /api/eval/:taskId/result.
 * Flat shape — never the evaluate() `{ task, result }` envelope.
 */
export interface EvaluationReportResponse {
  schemaVersion?: string;
  novel: EvaluationNovelDto;
  overall: EvaluationOverallDto;
  dimensions: Record<string, EvaluationDimensionDto>;
  characters: CharacterProfile[];
  emotionalCurve: EvaluationEmotionalPointDto[];
  suggestions: EvaluationSuggestionDto[];
  marketBenchmark?: EvaluationMarketBenchmarkDto | null;
  excerpts: EvaluationExcerptDto[];
  chapters?: unknown[];
  coverage: EvaluationCoverageDto;
}

function parseDimension(raw: unknown): EvaluationDimensionDto | null {
  if (!isRecord(raw) || typeof raw.score !== 'number') return null;
  const dim: EvaluationDimensionDto = {
    score: raw.score,
    analysis: typeof raw.analysis === 'string' ? raw.analysis : '',
  };
  if (isRecord(raw.subscores)) {
    const subscores: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.subscores)) {
      if (typeof v === 'number') subscores[k] = v;
    }
    dim.subscores = subscores;
  }
  return dim;
}

function parseNovel(raw: unknown): EvaluationNovelDto | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.title !== 'string' || typeof raw.author !== 'string') return null;
  if (typeof raw.totalChapters !== 'number' || typeof raw.wordCount !== 'number') return null;
  const novel: EvaluationNovelDto = {
    title: raw.title,
    author: raw.author,
    totalChapters: raw.totalChapters,
    wordCount: raw.wordCount,
  };
  if (typeof raw.genre === 'string') novel.genre = raw.genre;
  if (typeof raw.targetAudience === 'string') novel.targetAudience = raw.targetAudience;
  if (typeof raw.platform === 'string') novel.platform = raw.platform;
  return novel;
}

function parseOverall(raw: unknown): EvaluationOverallDto | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.totalScore !== 'number' || typeof raw.grade !== 'string') return null;
  return { totalScore: raw.totalScore, grade: raw.grade };
}

function parseEmotionalPoint(raw: unknown): EvaluationEmotionalPointDto | null {
  if (!isRecord(raw) || typeof raw.chapterId !== 'string' || typeof raw.tension !== 'number') {
    return null;
  }
  const point: EvaluationEmotionalPointDto = {
    chapterId: raw.chapterId,
    tension: raw.tension,
  };
  if (raw.annotation === null || typeof raw.annotation === 'string') {
    point.annotation = raw.annotation;
  }
  return point;
}

function parseSuggestion(raw: unknown): EvaluationSuggestionDto | null {
  if (!isRecord(raw) || typeof raw.dimension !== 'string' || typeof raw.content !== 'string') {
    return null;
  }
  const suggestion: EvaluationSuggestionDto = {
    dimension: raw.dimension,
    content: raw.content,
  };
  if (typeof raw.type === 'string') suggestion.type = raw.type;
  if (Array.isArray(raw.relatedChapters)) {
    suggestion.relatedChapters = raw.relatedChapters.filter((c): c is string => typeof c === 'string');
  }
  if (isRecord(raw.excerptRef)
    && typeof raw.excerptRef.chapterId === 'string'
    && typeof raw.excerptRef.excerptIndex === 'number'
  ) {
    suggestion.excerptRef = {
      chapterId: raw.excerptRef.chapterId,
      excerptIndex: raw.excerptRef.excerptIndex,
    };
  } else if (raw.excerptRef === null) {
    suggestion.excerptRef = null;
  }
  return suggestion;
}

function parseExcerpt(raw: unknown): EvaluationExcerptDto | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.text !== 'string' || typeof raw.dimension !== 'string' || typeof raw.reason !== 'string') {
    return null;
  }
  const excerpt: EvaluationExcerptDto = {
    text: raw.text,
    dimension: raw.dimension,
    reason: raw.reason,
  };
  if (typeof raw.chapterId === 'string') excerpt.chapterId = raw.chapterId;
  if (typeof raw.excerptIndex === 'number') excerpt.excerptIndex = raw.excerptIndex;
  if (typeof raw.offset === 'number' || raw.offset === null) excerpt.offset = raw.offset;
  if (typeof raw.matchedBy === 'string') excerpt.matchedBy = raw.matchedBy;
  if (typeof raw.length === 'number') excerpt.length = raw.length;
  return excerpt;
}

function parseRelationship(raw: unknown): CharacterRelationship | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.target !== 'string' || typeof raw.type !== 'string') return null;
  if (typeof raw.strength !== 'number') return null;
  return { target: raw.target, type: raw.type, strength: raw.strength };
}

function parseCharacter(raw: unknown): CharacterProfile | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || typeof raw.role !== 'string') return null;
  const character: CharacterProfile = { name: raw.name, role: raw.role };
  if (Array.isArray(raw.aliases)) {
    character.aliases = raw.aliases.filter((a): a is string => typeof a === 'string');
  }
  if (typeof raw.arc === 'string') character.arc = raw.arc;
  if (typeof raw.firstAppearance === 'string') character.firstAppearance = raw.firstAppearance;
  if (Array.isArray(raw.keyChapters)) {
    character.keyChapters = raw.keyChapters.filter((c): c is string => typeof c === 'string');
  }
  if (Array.isArray(raw.relationships)) {
    character.relationships = raw.relationships
      .map(parseRelationship)
      .filter((r): r is CharacterRelationship => r !== null);
  }
  return character;
}

function parseMarketBenchmark(raw: unknown): EvaluationMarketBenchmarkDto | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.positioning !== 'string' || typeof raw.audienceFit !== 'number') return null;
  const comparables: EvaluationMarketComparableDto[] = [];
  if (Array.isArray(raw.comparables)) {
    for (const item of raw.comparables) {
      if (!isRecord(item)) continue;
      if (typeof item.title !== 'string' || typeof item.similarity !== 'number') continue;
      if (typeof item.matchReason !== 'string' || typeof item.differentiation !== 'string') continue;
      const comp: EvaluationMarketComparableDto = {
        title: item.title,
        similarity: item.similarity,
        matchReason: item.matchReason,
        differentiation: item.differentiation,
      };
      if (typeof item.referenceNote === 'string') comp.referenceNote = item.referenceNote;
      comparables.push(comp);
    }
  }
  const benchmark: EvaluationMarketBenchmarkDto = {
    positioning: raw.positioning,
    audienceFit: raw.audienceFit,
    comparables,
  };
  if (typeof raw.disclaimer === 'string') benchmark.disclaimer = raw.disclaimer;
  return benchmark;
}

/** Unwrap evaluate() `{ task, result }` envelope when present; otherwise treat as flat report. */
export function unwrapEvaluationPayload(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  if (isRecord(raw.result) && isRecord(raw.result.overall) && isRecord(raw.result.novel)) {
    return raw.result;
  }
  return raw;
}

export function isExcerptLinked(excerpt: EvaluationExcerptDto): boolean {
  if (excerpt.matchedBy === 'exact' || excerpt.matchedBy === 'fuzzy') return true;
  if (excerpt.matchedBy === 'none') return false;
  // Legacy payloads without matchedBy: treat numeric offset as linked.
  return typeof excerpt.offset === 'number';
}

export function evaluationCoverageFor(
  report: EvaluationCoverageInput,
): EvaluationCoverageDto {
  const thresholds: CoverageThresholds = {
    minEvidenceLinkRate:
      report.thresholds?.minEvidenceLinkRate ?? DEFAULT_COVERAGE_THRESHOLDS.minEvidenceLinkRate,
    maxChapterSkipRate:
      report.thresholds?.maxChapterSkipRate ?? DEFAULT_COVERAGE_THRESHOLDS.maxChapterSkipRate,
  };

  const dimensionsPresent = Object.keys(report.dimensions);
  const missingDimensions = EVALUATION_DIMENSION_KEYS.filter((key) => !report.dimensions[key]);
  const excerpts = report.excerpts ?? [];
  const excerptCount = excerpts.length;
  const linked = excerpts.filter(isExcerptLinked);
  const evidenceLinkedCount = linked.length;
  const evidenceUnlinkedCount = excerptCount - evidenceLinkedCount;
  const evidenceLinkRate = excerptCount > 0 ? evidenceLinkedCount / excerptCount : undefined;

  const skippedChapterIds = [...(report.skippedChapterIds ?? [])];
  const skippedChapterCount = skippedChapterIds.length;

  let chapterCount: number | undefined;
  if (Array.isArray(report.chapters)) chapterCount = report.chapters.length;
  if (typeof report.task?.chapterCount === 'number') chapterCount = report.task.chapterCount;

  const chapterSkipRate =
    typeof chapterCount === 'number' && chapterCount > 0
      ? skippedChapterCount / chapterCount
      : skippedChapterCount > 0
        ? 1
        : 0;

  const incompleteReasons: string[] = [];
  if (missingDimensions.length > 0) {
    incompleteReasons.push(`missing dimensions: ${missingDimensions.join(', ')}`);
  }
  if (typeof chapterCount === 'number' && chapterCount > 0 && excerptCount === 0) {
    incompleteReasons.push('no evidence excerpts produced');
  }
  if (
    evidenceLinkRate !== undefined &&
    evidenceLinkRate < thresholds.minEvidenceLinkRate
  ) {
    incompleteReasons.push(
      `evidence link rate ${evidenceLinkRate.toFixed(2)} < ${thresholds.minEvidenceLinkRate}`,
    );
  }
  if (chapterSkipRate > thresholds.maxChapterSkipRate) {
    incompleteReasons.push(
      `chapter skip rate ${chapterSkipRate.toFixed(2)} > ${thresholds.maxChapterSkipRate}`,
    );
  }

  const coverage: EvaluationCoverageDto = {
    complete: incompleteReasons.length === 0,
    dimensionsExpected: [...EVALUATION_DIMENSION_KEYS],
    dimensionsPresent,
    missingDimensions,
    excerptCount,
    incompleteReasons,
    skippedChapterIds,
    skippedChapterCount,
    chapterSkipRate,
    evidenceLinkedCount,
    evidenceUnlinkedCount,
  };
  if (evidenceLinkRate !== undefined) coverage.evidenceLinkRate = evidenceLinkRate;
  if (typeof chapterCount === 'number') coverage.chapterCount = chapterCount;
  if (typeof report.task?.sourceWordCount === 'number') {
    coverage.sourceWordCount = report.task.sourceWordCount;
  }
  return coverage;
}

export function parseEvaluationReportResponse(raw: unknown): ParseResult<EvaluationReportResponse> {
  const flat = unwrapEvaluationPayload(raw);
  if (!isRecord(flat)) return fail('评估报告必须是对象');

  const novel = parseNovel(flat.novel);
  const overall = parseOverall(flat.overall);
  if (!novel || !overall) return fail('评估报告缺少 novel/overall');

  if (!isRecord(flat.dimensions)) return fail('评估报告缺少 dimensions');
  const dimensions: Record<string, EvaluationDimensionDto> = {};
  for (const [key, value] of Object.entries(flat.dimensions)) {
    const dim = parseDimension(value);
    if (dim) dimensions[key] = dim;
  }
  if (Object.keys(dimensions).length === 0) return fail('评估报告 dimensions 为空');

  const characters: CharacterProfile[] = [];
  if (Array.isArray(flat.characters)) {
    for (const item of flat.characters) {
      const character = parseCharacter(item);
      if (character) characters.push(character);
    }
  }

  const emotionalCurve: EvaluationEmotionalPointDto[] = [];
  if (Array.isArray(flat.emotionalCurve)) {
    for (const item of flat.emotionalCurve) {
      const point = parseEmotionalPoint(item);
      if (point) emotionalCurve.push(point);
    }
  }

  const suggestions: EvaluationSuggestionDto[] = [];
  if (Array.isArray(flat.suggestions)) {
    for (const item of flat.suggestions) {
      const suggestion = parseSuggestion(item);
      if (suggestion) suggestions.push(suggestion);
    }
  }

  const excerpts: EvaluationExcerptDto[] = [];
  if (Array.isArray(flat.excerpts)) {
    for (const item of flat.excerpts) {
      const excerpt = parseExcerpt(item);
      if (excerpt) excerpts.push(excerpt);
    }
  }

  const report: EvaluationReportResponse = {
    novel,
    overall,
    dimensions,
    characters,
    emotionalCurve,
    suggestions,
    excerpts,
    coverage: {
      complete: false,
      dimensionsExpected: [...EVALUATION_DIMENSION_KEYS],
      dimensionsPresent: [],
      missingDimensions: [...EVALUATION_DIMENSION_KEYS],
      excerptCount: 0,
    },
  };

  if (typeof flat.schemaVersion === 'string') report.schemaVersion = flat.schemaVersion;
  if (flat.marketBenchmark === null) {
    report.marketBenchmark = null;
  } else if (flat.marketBenchmark !== undefined) {
    report.marketBenchmark = parseMarketBenchmark(flat.marketBenchmark);
  }
  if (Array.isArray(flat.chapters)) report.chapters = flat.chapters;
  const taskCoverage: { sourceWordCount?: number; chapterCount?: number } = {};
  if (isRecord(flat.task)) {
    if (typeof flat.task.sourceWordCount === 'number') taskCoverage.sourceWordCount = flat.task.sourceWordCount;
    if (typeof flat.task.chapterCount === 'number') taskCoverage.chapterCount = flat.task.chapterCount;
  }

  let skippedChapterIds: string[] | undefined;
  if (isRecord(flat.coverage) && Array.isArray(flat.coverage.skippedChapterIds)) {
    skippedChapterIds = flat.coverage.skippedChapterIds.filter(
      (id): id is string => typeof id === 'string',
    );
  } else if (Array.isArray(flat.skippedChapterIds)) {
    skippedChapterIds = flat.skippedChapterIds.filter((id): id is string => typeof id === 'string');
  }

  const coverageInput: EvaluationCoverageInput = {
    dimensions: report.dimensions,
    excerpts: report.excerpts,
  };
  if (report.chapters) coverageInput.chapters = report.chapters;
  if (Object.keys(taskCoverage).length > 0) coverageInput.task = taskCoverage;
  if (skippedChapterIds) coverageInput.skippedChapterIds = skippedChapterIds;
  report.coverage = evaluationCoverageFor(coverageInput);

  return { ok: true, data: report };
}

/** Map evaluate() output or persisted JSON into the stable web DTO. */
export function toEvaluationReportResponse(raw: unknown): EvaluationReportResponse {
  const parsed = parseEvaluationReportResponse(raw);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return parsed.data;
}
