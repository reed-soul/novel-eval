/**
 * Independent chapter reviewer — Stage C3 facade over quality-gate.
 *
 * Maps pass/revise/block → accept/revise/reject with structured reasons + evidence.
 * Generation optionally calls this before extract/publish.
 */
import type { AIAgentAdapter, NovelMetadata, TokenUsage } from '@novel-eval/shared';
import { addUsage, zeroUsage } from '@novel-eval/shared';

import {
  assessChapterQuality,
  type QualityGateEvidence,
  type QualityGateOptions,
  type QualityGateResult,
} from '../chapter/quality-gate.ts';
import type { DB } from '../db.ts';
import type { ChapterContent } from '../chapter/legacy-types.ts';

export type ChapterReviewVerdict = 'accept' | 'revise' | 'reject';

export interface ChapterReviewEvidence extends QualityGateEvidence {}

export interface ChapterReviewResult {
  verdict: ChapterReviewVerdict;
  reasons: string[];
  reason: string;
  score?: number;
  grade?: string;
  feedback?: string;
  /** Severe repetition — generation must not consume maxRevise. */
  hardBlock?: boolean;
  evidence: ChapterReviewEvidence[];
  repetition?: QualityGateResult['repetition'];
  usage: TokenUsage;
}

export interface ChapterReviewInput {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  chapter: ChapterContent;
  metadata: NovelMetadata;
  profile?: string;
  attempt?: number;
  onProgress?: (msg: string) => void;
  /** Test seam — bypass live assessChapterQuality. */
  assess?: (opts: QualityGateOptions) => Promise<QualityGateResult & { usage: TokenUsage }>;
}

function mapVerdict(verdict: QualityGateResult['verdict']): ChapterReviewVerdict {
  if (verdict === 'pass') return 'accept';
  if (verdict === 'block') return 'reject';
  return 'revise';
}

export class ChapterReviewerService {
  constructor(private readonly db: DB) {}

  async reviewChapter(input: ChapterReviewInput): Promise<ChapterReviewResult> {
    const assess = input.assess ?? assessChapterQuality;
    const gate = await assess({
      engine: input.engine,
      db: input.db ?? this.db,
      projectId: input.projectId,
      chapter: input.chapter,
      metadata: input.metadata,
      profile: input.profile,
      attempt: input.attempt,
      onProgress: input.onProgress,
    });

    const reasons = gate.reasons.length > 0 ? gate.reasons : [gate.reason];
    const usage: TokenUsage = { ...zeroUsage };
    addUsage(usage, gate.usage);

    return {
      verdict: mapVerdict(gate.verdict),
      reasons,
      reason: gate.reason,
      score: gate.score,
      grade: gate.grade,
      feedback: gate.feedback,
      hardBlock: gate.hardBlock === true,
      evidence: gate.evidence ?? [],
      repetition: gate.repetition,
      usage,
    };
  }
}

export function mapQualityVerdict(
  verdict: QualityGateResult['verdict'],
): ChapterReviewVerdict {
  return mapVerdict(verdict);
}
