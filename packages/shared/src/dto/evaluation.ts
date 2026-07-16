import { fail, isRecord, type ParseResult } from './parse.ts';
import type { CharacterProfile, CharacterRelationship } from '../types.ts';

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
  excerpts?: unknown[];
  chapters?: unknown[];
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
  return suggestion;
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

  const report: EvaluationReportResponse = {
    novel,
    overall,
    dimensions,
    characters,
    emotionalCurve,
    suggestions,
  };

  if (typeof flat.schemaVersion === 'string') report.schemaVersion = flat.schemaVersion;
  if (flat.marketBenchmark === null) {
    report.marketBenchmark = null;
  } else if (flat.marketBenchmark !== undefined) {
    report.marketBenchmark = parseMarketBenchmark(flat.marketBenchmark);
  }
  if (Array.isArray(flat.excerpts)) report.excerpts = flat.excerpts;
  if (Array.isArray(flat.chapters)) report.chapters = flat.chapters;

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
