/**
 * WriterApplication — CLI / Web 共用的写作门面。
 *
 * 所有写路径必须持有 project write lease；调用方不直接拼装 repositories。
 */
import { randomUUID } from 'node:crypto';

import type { AIAgentAdapter } from '@novel-eval/shared';
import { addUsage, countChars, zeroUsage, type TokenUsage } from '@novel-eval/shared';

import {
  applyCorrectionDraft,
  type ApplyCorrectionDraftResult,
} from '../chapter/corrector.ts';
import {
  generateBible as generateBibleImpl,
  type GenerateBibleOptions,
  type GenerateBibleResult,
} from '../bible/generator.ts';
import {
  importBible as importBibleImpl,
  type ImportBibleOptions,
  type ImportBibleResult,
} from '../bible/importer.ts';
import {
  generateBlueprint as generateBlueprintImpl,
  type GenerateBlueprintOptions,
  type GenerateBlueprintResult,
} from '../chapter/blueprint.ts';
import type { ExtractStoryStateResult } from '../chapter/finalizer.ts';
import {
  JobCancelledError,
  JobPausedError,
  type GenerationControl,
} from '../chapter/generator.ts';
import type { DB } from '../db.ts';
import {
  chapterId,
  chapterRevisionId,
  projectId,
  type ChapterRevisionId,
  type ProjectId,
} from '../domain/ids.ts';
import { BudgetExceededError } from '../domain/errors.ts';
import type { StoryState, StoryStateDelta } from '../domain/story-state.ts';
import {
  createJobRow,
  getJobRow,
  readJobResumeConfig,
  updateJobStatus,
  updateJobUsage,
  type JobResumeConfig,
  type JobRow,
} from '../job-store.ts';
import { ChapterRepository } from '../repositories/chapter-repository.ts';
import {
  ProjectWriteLeaseRepository,
  type ProjectWriteLease,
} from '../repositories/lease-repository.ts';
import { PlanningRepository } from '../repositories/planning-repository.ts';
import { StoryStateRepository } from '../repositories/story-state-repository.ts';
import type { JsonValue } from '../repositories/validation.ts';
import { getRuntimeConfig } from '../runtime-config.ts';
import {
  ChapterGenerationService,
  type GenerateChapterOutcome,
  type GeneratedChapterContent,
} from './chapter-generation-service.ts';
import {
  ChapterPublicationService,
  type PublishResult,
  type StaleImpact,
} from './chapter-publication-service.ts';
import type { CompiledChapterContext } from './context-compiler.ts';
import {
  StateRebuildService,
  type RebuildExtractInput,
  type RebuildResult,
} from './state-rebuild-service.ts';

export interface WriterApplicationOptions {
  now?: () => Date;
  defaultOwnerId?: string;
  leaseTtlMs?: number;
}

export interface ImportBibleAppInput extends Omit<ImportBibleOptions, 'db'> {
  existingJobId?: string;
  ownerId?: string;
  ttlMs?: number;
}

export interface GenerateBibleAppInput extends Omit<GenerateBibleOptions, 'db'> {
  existingJobId?: string;
  ownerId?: string;
  ttlMs?: number;
}

export interface GenerateBlueprintAppInput extends Omit<GenerateBlueprintOptions, 'db'> {
  existingJobId?: string;
  ownerId?: string;
  ttlMs?: number;
}

export interface GenerateChapterRangeInput {
  projectId: ProjectId;
  from: number;
  to: number;
  engine: AIAgentAdapter;
  wordCount: number;
  /** Resume a paused job in-place (same jobId); cancels other active jobs first when omitted. */
  resumeJobId?: string;
  /**
   * Use a pre-created running job row (Web createJob). Mutually exclusive with resumeJobId.
   * Skips createJobRow so the facade and the SSE tracker share one job id.
   */
  existingJobId?: string;
  ownerId?: string;
  engineName?: string;
  model?: string;
  qualityProfile?: string;
  promptVersion?: string;
  budget?: JsonValue;
  ttlMs?: number;
  onProgress?: (step: string, msg: string) => void;
  control?: GenerationControl;
  generateContent?: (context: CompiledChapterContext) => Promise<GeneratedChapterContent>;
  extractState?: (input: {
    context: CompiledChapterContext;
    content: string;
    title: string;
    chapterRevisionId: ChapterRevisionId;
  }) => Promise<ExtractStoryStateResult>;
}

export interface AdoptCorrectionDraftInput {
  projectId: ProjectId;
  draftId: string;
  state: StoryState;
  delta: StoryStateDelta;
  model: string;
  promptVersion: string;
  ownerId?: string;
  ttlMs?: number;
  extractState?: (input: RebuildExtractInput) => Promise<ExtractStoryStateResult>;
}

export interface GenerateChapterRangeResult {
  jobId: string;
  outcomes: GenerateChapterOutcome[];
}

export interface PublishChapterEditInput {
  projectId: ProjectId;
  outlinePosition: number;
  title: string;
  content: string;
  state: StoryState;
  delta: StoryStateDelta;
  model: string;
  promptVersion: string;
  source?: 'manual' | 'correction';
  ownerId?: string;
  ttlMs?: number;
}

export interface RebuildStoryStateInput {
  projectId: ProjectId;
  fromOutlinePosition: number;
  extractState: (input: RebuildExtractInput) => Promise<ExtractStoryStateResult>;
  ownerId?: string;
  ttlMs?: number;
}

export class WriterApplication {
  private readonly now: () => Date;
  private readonly defaultOwnerId: string;
  private readonly leaseTtlMs: number;
  private readonly leases: ProjectWriteLeaseRepository;
  private readonly planning: PlanningRepository;
  private readonly chapters: ChapterRepository;
  private readonly states: StoryStateRepository;
  private readonly generation: ChapterGenerationService;
  private readonly publication: ChapterPublicationService;
  private readonly rebuild: StateRebuildService;

  constructor(
    private readonly db: DB,
    options: WriterApplicationOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.defaultOwnerId = options.defaultOwnerId ?? 'local-writer';
    this.leaseTtlMs = options.leaseTtlMs ?? 120_000;
    this.leases = new ProjectWriteLeaseRepository(db);
    this.planning = new PlanningRepository(db);
    this.chapters = new ChapterRepository(db);
    this.states = new StoryStateRepository(db);
    this.generation = new ChapterGenerationService(db, this.now);
    this.publication = new ChapterPublicationService(db, this.now);
    this.rebuild = new StateRebuildService(db, this.now);
  }

  async generateBible(opts: GenerateBibleAppInput): Promise<GenerateBibleResult> {
    const ownerId = opts.ownerId ?? this.defaultOwnerId;
    const stepTimeoutMs = getRuntimeConfig().generation.timeouts.bibleMs;
    // Floor TTL at one LLM step when caller did not override — prevents mid-call expiry.
    const ttlMs = opts.ttlMs !== undefined
      ? opts.ttlMs
      : Math.max(this.leaseTtlMs, stepTimeoutMs);
    let jobId: string;
    if (opts.existingJobId) {
      const existing = getJobRow(this.db, opts.existingJobId);
      if (!existing || existing.projectId !== opts.projectId) {
        throw new Error(`Job ${opts.existingJobId} not found for project`);
      }
      jobId = opts.existingJobId;
    } else {
      jobId = createJobRow(this.db, {
        projectId: opts.projectId,
        type: 'bible',
        engine: opts.engine.name,
        model: opts.engine.name,
        wordCount: 0,
        promptVersion: 'bible-v1',
      });
    }
    let lease: ProjectWriteLease;
    try {
      lease = this.leases.acquire({
        projectId: projectId(opts.projectId),
        jobId,
        ownerId,
        ttlMs,
        now: this.now(),
      });
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'lease acquire failed',
      });
      throw error;
    }
    try {
      const onProgress = this.bindLeaseHeartbeat(lease, ownerId, ttlMs, opts.onProgress);
      const result = await generateBibleImpl({ ...opts, db: this.db, onProgress });
      updateJobStatus(this.db, jobId, 'completed');
      return result;
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'generate bible failed',
      });
      throw error;
    } finally {
      this.leases.release({ leaseId: lease.id, ownerId });
    }
  }

  importBible(opts: ImportBibleAppInput): ImportBibleResult {
    const ownerId = opts.ownerId ?? this.defaultOwnerId;
    const ttlMs = opts.ttlMs ?? this.leaseTtlMs;
    let jobId: string;
    if (opts.existingJobId) {
      const existing = getJobRow(this.db, opts.existingJobId);
      if (!existing || existing.projectId !== opts.projectId) {
        throw new Error(`Job ${opts.existingJobId} not found for project`);
      }
      jobId = opts.existingJobId;
    } else {
      jobId = createJobRow(this.db, {
        projectId: opts.projectId,
        type: 'bible',
        engine: 'import',
        model: 'import',
        wordCount: 0,
        promptVersion: 'bible-import-v1',
      });
    }
    let lease: ProjectWriteLease;
    try {
      lease = this.leases.acquire({
        projectId: projectId(opts.projectId),
        jobId,
        ownerId,
        ttlMs,
        now: this.now(),
      });
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'lease acquire failed',
      });
      throw error;
    }
    try {
      const result = importBibleImpl({ ...opts, db: this.db });
      updateJobStatus(this.db, jobId, 'completed');
      return result;
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'import bible failed',
      });
      throw error;
    } finally {
      this.leases.release({ leaseId: lease.id, ownerId });
    }
  }

  async generateBlueprint(opts: GenerateBlueprintAppInput): Promise<GenerateBlueprintResult> {
    const ownerId = opts.ownerId ?? this.defaultOwnerId;
    const stepTimeoutMs = getRuntimeConfig().generation.timeouts.blueprintMs;
    const ttlMs = opts.ttlMs !== undefined
      ? opts.ttlMs
      : Math.max(this.leaseTtlMs, stepTimeoutMs);
    let jobId: string;
    if (opts.existingJobId) {
      const existing = getJobRow(this.db, opts.existingJobId);
      if (!existing || existing.projectId !== opts.projectId) {
        throw new Error(`Job ${opts.existingJobId} not found for project`);
      }
      jobId = opts.existingJobId;
    } else {
      jobId = createJobRow(this.db, {
        projectId: opts.projectId,
        type: 'outline',
        engine: opts.engine.name,
        model: opts.engine.name,
        wordCount: 0,
        promptVersion: 'blueprint-v1',
      });
    }
    let lease: ProjectWriteLease;
    try {
      lease = this.leases.acquire({
        projectId: projectId(opts.projectId),
        jobId,
        ownerId,
        ttlMs,
        now: this.now(),
      });
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'lease acquire failed',
      });
      throw error;
    }
    try {
      const onProgress = this.bindLeaseHeartbeat(lease, ownerId, ttlMs, opts.onProgress);
      const result = await generateBlueprintImpl({ ...opts, db: this.db, onProgress });
      updateJobStatus(this.db, jobId, 'completed');
      return result;
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'generate blueprint failed',
      });
      throw error;
    } finally {
      this.leases.release({ leaseId: lease.id, ownerId });
    }
  }

  readJobResumeConfig(jobId: string): JobResumeConfig {
    return readJobResumeConfig(this.db, jobId);
  }

  getJob(jobId: string): JobRow | null {
    return getJobRow(this.db, jobId);
  }

  getStaleImpact(id: ProjectId, fromOutlinePosition: number): StaleImpact {
    if (!Number.isInteger(fromOutlinePosition) || fromOutlinePosition <= 0) {
      throw new Error('fromOutlinePosition must be a positive integer');
    }
    const staleSequences = this.states
      .listStale(id)
      .map((revision) => revision.sequence)
      .filter((sequence) => sequence >= fromOutlinePosition);
    const unique = [...new Set(staleSequences)].sort((a, b) => a - b);
    const affectedOutlinePositions = unique.filter(
      (sequence) => this.states.getCurrentAtPosition(id, sequence) === null,
    );
    return { affectedOutlinePositions };
  }

  async rebuildStoryState(input: RebuildStoryStateInput): Promise<RebuildResult> {
    const ownerId = input.ownerId ?? this.defaultOwnerId;
    const ttlMs = input.ttlMs ?? this.leaseTtlMs;
    const jobId = createJobRow(this.db, {
      projectId: input.projectId,
      type: 'rebuild',
      scope: { from: input.fromOutlinePosition, to: null },
      engine: 'rebuild',
      model: 'rebuild',
      wordCount: 0,
      promptVersion: 'state-v1',
    });
    const lease = this.leases.acquire({
      projectId: input.projectId,
      jobId,
      ownerId,
      ttlMs,
      now: this.now(),
    });
    try {
      const result = await this.rebuild.rebuildFrom({
        projectId: input.projectId,
        fromOutlinePosition: input.fromOutlinePosition,
        lease,
        extractState: input.extractState,
      });
      updateJobStatus(this.db, jobId, 'completed');
      return result;
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'rebuild failed',
      });
      throw error;
    } finally {
      this.leases.release({ leaseId: lease.id, ownerId });
    }
  }

  async publishChapterEdit(input: PublishChapterEditInput): Promise<PublishResult> {
    if (!Number.isInteger(input.outlinePosition) || input.outlinePosition <= 0) {
      throw new Error('outlinePosition must be a positive integer');
    }
    const ownerId = input.ownerId ?? this.defaultOwnerId;
    const ttlMs = input.ttlMs ?? this.leaseTtlMs;
    const source = input.source ?? 'manual';

    const outline = this.planning.getOutlineWithApprovedRevisionAtPosition(
      input.projectId,
      input.outlinePosition,
    );
    if (!outline) {
      throw new Error(`No outline at position ${input.outlinePosition}`);
    }

    const jobId = createJobRow(this.db, {
      projectId: input.projectId,
      type: 'edit',
      scope: { from: input.outlinePosition, to: input.outlinePosition },
      engine: 'manual',
      model: input.model,
      wordCount: countChars(input.content),
      promptVersion: input.promptVersion,
    });
    const lease = this.leases.acquire({
      projectId: input.projectId,
      jobId,
      ownerId,
      ttlMs,
      now: this.now(),
    });

    try {
      const createdAt = this.now().toISOString();
      const existing = this.chapters.getByOutlinePosition(input.projectId, input.outlinePosition);
      const candidate = existing
        ? this.chapters.appendCandidate({
            chapterId: existing.id,
            revision: {
              id: chapterRevisionId(randomUUID()),
              revisionNumber: this.chapters.nextRevisionNumber(existing.id),
              source,
              parentRevisionId: existing.activeRevisionId,
              title: input.title,
              content: input.content,
              wordCount: countChars(input.content),
              status: 'draft',
              generationRunId: null,
              createdAt,
            },
          })
        : this.chapters.saveCandidate({
            chapter: {
              id: chapterId(randomUUID()),
              projectId: input.projectId,
              outlineId: outline.outline.id,
              createdAt,
            },
            revision: {
              id: chapterRevisionId(randomUUID()),
              revisionNumber: 1,
              source,
              parentRevisionId: null,
              title: input.title,
              content: input.content,
              wordCount: countChars(input.content),
              status: 'draft',
              generationRunId: null,
              createdAt,
            },
          });

      const previousStateRevisionId = input.outlinePosition === 1
        ? null
        : this.states.getCurrentAtPosition(input.projectId, input.outlinePosition - 1)?.id ?? null;

      const published = this.publication.publishHistoricalRevision({
        lease,
        candidateRevisionId: candidate.revision.id,
        previousStateRevisionId,
        state: input.state,
        delta: input.delta,
        model: input.model,
        promptVersion: input.promptVersion,
        checkpoint: {
          jobId,
          outlinePosition: input.outlinePosition,
        },
      });
      updateJobStatus(this.db, jobId, 'completed');
      return published;
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'publish edit failed',
      });
      throw error;
    } finally {
      this.leases.release({ leaseId: lease.id, ownerId });
    }
  }

  async generateChapterRange(input: GenerateChapterRangeInput): Promise<GenerateChapterRangeResult> {
    const ownerId = input.ownerId ?? this.defaultOwnerId;
    const ttlMs = input.ttlMs ?? this.leaseTtlMs;

    let from = input.from;
    let to = input.to;
    let wordCount = input.wordCount;
    let engineName = input.engineName ?? input.engine.name;
    let model = input.model ?? input.engine.name;
    let qualityProfile = input.qualityProfile ?? 'default';
    let promptVersion = input.promptVersion ?? 'chapter-v1';
    let budget = input.budget ?? {};

    let resumeJobId: string | undefined;
    let existingJobId: string | undefined;
    let resumedUsage: TokenUsage | null = null;

    if (input.resumeJobId) {
      const existing = getJobRow(this.db, input.resumeJobId);
      if (!existing || existing.projectId !== input.projectId) {
        throw new Error(`Resume job ${input.resumeJobId} not found for project`);
      }
      if (existing.status !== 'paused' && existing.status !== 'running') {
        throw new Error(`Resume job ${input.resumeJobId} is ${existing.status}, expected paused`);
      }
      const snapshot = readJobResumeConfig(this.db, input.resumeJobId);
      // AC6: resume is bound to the stored config snapshot; ignore caller overrides.
      from = snapshot.scope.from;
      to = snapshot.scope.to;
      wordCount = snapshot.wordCount;
      engineName = snapshot.engine;
      model = snapshot.model;
      qualityProfile = snapshot.qualityProfile;
      promptVersion = snapshot.promptVersion;
      budget = snapshot.budget ?? {};
      resumeJobId = input.resumeJobId;
      resumedUsage = readPersistedUsage(existing.usage);
    } else if (input.existingJobId) {
      const existing = getJobRow(this.db, input.existingJobId);
      if (!existing || existing.projectId !== input.projectId) {
        throw new Error(`Job ${input.existingJobId} not found for project`);
      }
      if (existing.status !== 'running') {
        throw new Error(`Job ${input.existingJobId} is ${existing.status}, expected running`);
      }
      existingJobId = input.existingJobId;
    }

    if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to < from) {
      throw new Error('from/to must be positive integers with to >= from');
    }

    for (let position = from; position <= to; position += 1) {
      if (!this.planning.hasOutlineAtPosition(input.projectId, position)) {
        throw new Error(`章节范围存在缺口：缺少第 ${position} 章蓝图（请求 ${from}-${to}）`);
      }
    }

    const approvedPositions: number[] = [];
    for (let position = from; position <= to; position += 1) {
      const approved = this.planning.getApprovedOutlineAtPosition(input.projectId, position);
      if (approved) approvedPositions.push(position);
    }

    let jobId: string;
    if (resumeJobId) {
      this.cancelOtherActiveJobs(input.projectId, resumeJobId);
      updateJobStatus(this.db, resumeJobId, 'running');
      jobId = resumeJobId;
    } else if (existingJobId) {
      this.cancelOtherActiveJobs(input.projectId, existingJobId);
      jobId = existingJobId;
    } else {
      this.cancelOtherActiveJobs(input.projectId, null);
      jobId = createJobRow(this.db, {
        projectId: input.projectId,
        type: 'chapter',
        scope: { from, to },
        engine: engineName,
        model,
        wordCount,
        qualityProfile,
        budget,
        promptVersion,
        input: {
          from,
          to,
          wordCount,
        },
      });
    }

    let lease: ProjectWriteLease;
    try {
      lease = this.leases.acquire({
        projectId: input.projectId,
        jobId,
        ownerId,
        ttlMs,
        now: this.now(),
      });
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'lease acquire failed',
      });
      throw error;
    }

    const outcomes: GenerateChapterOutcome[] = [];
    const cumulativeUsage: TokenUsage = resumedUsage !== null
      ? { ...resumedUsage }
      : { ...zeroUsage };
    const maxCostRmb = readMaxCostRmb(budget);
    try {
      for (const position of approvedPositions) {
        if (input.control?.shouldCancel?.()) {
          throw new JobCancelledError();
        }
        if (input.control?.shouldPause?.()) {
          throw new JobPausedError(position);
        }

        if (maxCostRmb !== null && cumulativeUsage.costRmb > maxCostRmb) {
          throw new BudgetExceededError(cumulativeUsage.costRmb, maxCostRmb);
        }

        this.leases.renew({
          leaseId: lease.id,
          ownerId,
          ttlMs,
          now: this.now(),
        });

        input.onProgress?.(`chapter:${position}`, `生成第 ${position} 章...`);
        const outcome = await this.generation.generateNext({
          projectId: input.projectId,
          outlinePosition: position,
          lease,
          engine: input.engine,
          wordCount,
          promptTemplateVersion: promptVersion,
          generateContent: input.generateContent,
          extractState: input.extractState,
        });
        outcomes.push(outcome);
        addUsage(cumulativeUsage, outcome.usage);
        updateJobUsage(this.db, jobId, {
          inputTokens: cumulativeUsage.inputTokens,
          outputTokens: cumulativeUsage.outputTokens,
          costRmb: cumulativeUsage.costRmb,
          model: cumulativeUsage.model,
          durationMs: cumulativeUsage.durationMs,
        });

        if (maxCostRmb !== null && cumulativeUsage.costRmb > maxCostRmb) {
          // Stop before the next expensive call; fail the job now if range continues.
          const remaining = approvedPositions.filter((p) => p > position);
          if (remaining.length > 0) {
            throw new BudgetExceededError(cumulativeUsage.costRmb, maxCostRmb);
          }
        }

        input.control?.onChapterComplete?.(position);
      }

      updateJobStatus(this.db, jobId, 'completed', {
        result: { generated: outcomes.length },
      });
      return { jobId, outcomes };
    } catch (error: unknown) {
      if (error instanceof JobPausedError) {
        updateJobStatus(this.db, jobId, 'paused');
        throw error;
      }
      if (error instanceof JobCancelledError) {
        updateJobStatus(this.db, jobId, 'cancelled');
        throw error;
      }
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'generate range failed',
      });
      throw error;
    } finally {
      this.leases.release({ leaseId: lease.id, ownerId });
    }
  }

  private bindLeaseHeartbeat(
    lease: ProjectWriteLease,
    ownerId: string,
    ttlMs: number,
    onProgress?: (step: string, msg: string) => void,
  ): (step: string, msg: string) => void {
    return (step: string, msg: string) => {
      this.leases.renew({
        leaseId: lease.id,
        ownerId,
        ttlMs,
        now: this.now(),
      });
      onProgress?.(step, msg);
    };
  }

  private cancelOtherActiveJobs(id: ProjectId, keepJobId: string | null): void {
    const rows: unknown[] = this.db.prepare(`
      SELECT id FROM job
      WHERE project_id = ?
        AND status IN ('running', 'paused')
        AND (? IS NULL OR id != ?)
    `).all(id, keepJobId, keepJobId);
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || !('id' in row)) continue;
      const jobId = String((row as { id: string }).id);
      updateJobStatus(this.db, jobId, 'cancelled');
    }
  }

  async adoptCorrectionDraft(input: AdoptCorrectionDraftInput): Promise<ApplyCorrectionDraftResult> {
    const ownerId = input.ownerId ?? this.defaultOwnerId;
    const ttlMs = input.ttlMs ?? this.leaseTtlMs;
    const jobId = createJobRow(this.db, {
      projectId: input.projectId,
      type: 'correction',
      scope: { from: null, to: null },
      engine: 'correction',
      model: input.model,
      wordCount: 0,
      promptVersion: input.promptVersion,
    });
    const lease = this.leases.acquire({
      projectId: input.projectId,
      jobId,
      ownerId,
      ttlMs,
      now: this.now(),
    });
    try {
      const result = await applyCorrectionDraft({
        db: this.db,
        draftId: input.draftId,
        lease,
        state: input.state,
        delta: input.delta,
        model: input.model,
        promptVersion: input.promptVersion,
        extractState: input.extractState,
        now: this.now,
      });
      updateJobStatus(this.db, jobId, 'completed');
      return result;
    } catch (error: unknown) {
      updateJobStatus(this.db, jobId, 'failed', {
        errorType: error instanceof Error ? error.name : 'Error',
        error: error instanceof Error ? error.message : 'adopt correction failed',
      });
      throw error;
    } finally {
      this.leases.release({ leaseId: lease.id, ownerId });
    }
  }
}

function readMaxCostRmb(budget: JsonValue): number | null {
  if (typeof budget !== 'object' || budget === null || Array.isArray(budget)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(budget, 'maxCostRmb')) {
    return null;
  }
  const value = budget.maxCostRmb;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function readPersistedUsage(usage: JsonValue | null): TokenUsage {
  const total: TokenUsage = { ...zeroUsage };
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) {
    return total;
  }
  if (typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)) {
    total.inputTokens = usage.inputTokens;
  }
  if (typeof usage.outputTokens === 'number' && Number.isFinite(usage.outputTokens)) {
    total.outputTokens = usage.outputTokens;
  }
  if (typeof usage.costRmb === 'number' && Number.isFinite(usage.costRmb)) {
    total.costRmb = usage.costRmb;
  }
  if (typeof usage.model === 'string') {
    total.model = usage.model;
  }
  if (typeof usage.durationMs === 'number' && Number.isFinite(usage.durationMs)) {
    total.durationMs = usage.durationMs;
  }
  return total;
}
