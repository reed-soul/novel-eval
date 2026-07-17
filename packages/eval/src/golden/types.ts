/**
 * Golden corpus types — score bands and corpus registry.
 */
import type { DimensionKey } from '../types.ts';

export type ExpectStatus = 'pending_annotation' | 'seeded_baseline' | 'active';

export interface ScoreBand {
  min: number | null;
  max: number | null;
}

export interface GoldenExpect {
  status: ExpectStatus;
  toleranceNote?: string;
  seededFrom?: {
    totalScore: number;
    grade: string;
    dimensions: Partial<Record<DimensionKey, number>>;
    seededAt: string;
  };
  overall: ScoreBand;
  gradeAllowlist: string[];
  dimensions: Partial<Record<DimensionKey, ScoreBand>>;
}

export interface SlicePolicy {
  maxChapters: number;
  maxChars: number;
  /** Skip chapters shorter than this (filters TOC shells). Default 400. */
  minChars?: number;
}

export interface GoldenCaseMeta {
  id: string;
  title: string;
  author: string;
  genre: string;
  audience: string;
  profile: string;
  slice: SlicePolicy;
}

export interface CorpusCaseRef {
  id: string;
  sourcePath: string;
  metaPath: string;
  expectPath: string;
}

export interface CorpusRegistry {
  schemaVersion: string;
  cases: CorpusCaseRef[];
}

export interface LoadedGoldenCase {
  ref: CorpusCaseRef;
  meta: GoldenCaseMeta;
  expect: GoldenExpect;
  absoluteSourcePath: string;
}

export interface BandViolation {
  field: string;
  actual: number | string;
  expected: string;
  message: string;
}

export interface BandAssertResult {
  ok: boolean;
  skipped: boolean;
  violations: BandViolation[];
}

export interface SliceReport {
  caseId: string;
  outPath: string;
  chapterCount: number;
  charCount: number;
  strategy: string;
  titles: string[];
}

export interface CheckReport {
  caseId: string;
  ok: boolean;
  sourceExists: boolean;
  chapterCount?: number;
  charCount?: number;
  strategy?: string;
  confidence?: string;
  error?: string;
}
