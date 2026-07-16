/**
 * WriterApplication — CLI / Web 共用的写作门面。
 *
 * 所有写路径必须持有 project write lease；调用方不直接拼装 repositories。
 */
import { randomUUID } from 'node:crypto';

import type { AIAgentAdapter } from '@novel-eval/shared';
import { countChars } from '@novel-eval/shared';

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
  type ChapterRevisionId,
  type ProjectId,
} from '../domain/ids.ts';
import type { StoryState, StoryStateDelta } from '../domain/story-state.ts';
import {
  createJobRow,
  getJobRow,
  readJobResumeConfig,
  updateJobStatus,
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

export interface GenerateChapterRangeInput {
  projectId: ProjectId;
  from: number;
  to: number;
  engine: AIAgentAdapter;
  wordCount: number;
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

  generateBible(opts: Omit<GenerateBibleOptions, 'db'>): Promise<GenerateBibleResult> {
    return generateBibleImpl({ ...opts, db: this.db });
  }

  importBible(opts: Omit<ImportBibleOptions, 'db'>): ImportBibleResult {
    return importBibleImpl({ ...opts, db: this.db });
  }

  generateBlueprint(opts: Omit<GenerateBlueprintOptions, 'db'>): Promise<GenerateBlueprintResult> {
    return generateBlueprintImpl({ ...opts, db: this.db });
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
    return {
      affectedOutlinePositions: this.states
        .listStale(id)
        .filter((revision) => revision.sequence >= fromOutlinePosition)
        .map((revision) => revision.sequence)
        .sort((a, b) => a - b),
    };
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
    if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from <= 0 || input.to < input.from) {
      throw new Error('from/to must be positive integers with to >= from');
    }

    for (let position = input.from; position <= input.to; position += 1) {
      if (!this.planning.hasOutlineAtPosition(input.projectId, position)) {
        throw new Error(`章节范围存在缺口：缺少第 ${position} 章蓝图（请求 ${input.from}-${input.to}）`);
      }
    }

    const approvedPositions: number[] = [];
    for (let position = input.from; position <= input.to; position += 1) {
      const approved = this.planning.getApprovedOutlineAtPosition(input.projectId, position);
      if (approved) approvedPositions.push(position);
    }

    const ownerId = input.ownerId ?? this.defaultOwnerId;
    const ttlMs = input.ttlMs ?? this.leaseTtlMs;
    const engineName = input.engineName ?? input.engine.name;
    const model = input.model ?? input.engine.name;

    const jobId = createJobRow(this.db, {
      projectId: input.projectId,
      type: 'chapter',
      scope: { from: input.from, to: input.to },
      engine: engineName,
      model,
      wordCount: input.wordCount,
      qualityProfile: input.qualityProfile ?? 'default',
      budget: input.budget ?? {},
      promptVersion: input.promptVersion ?? 'chapter-v1',
      input: {
        from: input.from,
        to: input.to,
        wordCount: input.wordCount,
      },
    });

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
    try {
      for (const position of approvedPositions) {
        if (input.control?.shouldCancel?.()) {
          throw new JobCancelledError();
        }
        if (input.control?.shouldPause?.()) {
          throw new JobPausedError(position);
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
          wordCount: input.wordCount,
          promptTemplateVersion: input.promptVersion ?? 'chapter-v1',
          generateContent: input.generateContent,
          extractState: input.extractState,
        });
        outcomes.push(outcome);
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
}
