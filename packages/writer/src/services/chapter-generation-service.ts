import { randomUUID } from 'node:crypto';

import type { AIAgentAdapter, NovelMetadata, TokenUsage } from '@novel-eval/shared';
import { addUsage, countChars, zeroUsage } from '@novel-eval/shared';

import { extractStoryState, type ExtractStoryStateResult } from '../chapter/finalizer.ts';
import type { DB } from '../db.ts';
import {
  ChapterQualityRejectedError,
  StaleDependencyError,
  StateExtractionError,
} from '../domain/errors.ts';
import {
  chapterId,
  chapterRevisionId,
  type ChapterRevisionId,
  type OutlineId,
  type ProjectId,
  type StoryStateRevisionId,
} from '../domain/ids.ts';
import { ChapterRepository } from '../repositories/chapter-repository.ts';
import type { ProjectWriteLease } from '../repositories/lease-repository.ts';
import { StoryStateRepository } from '../repositories/story-state-repository.ts';
import { getRuntimeConfig } from '../runtime-config.ts';
import {
  ChapterPublicationService,
  type PublishResult,
} from './chapter-publication-service.ts';
import {
  ContextCompiler,
  type CompiledChapterContext,
} from './context-compiler.ts';
import {
  ChapterReviewerService,
  type ChapterReviewResult,
} from './chapter-reviewer-service.ts';

export interface QualityReviewOptions {
  enabled: boolean;
  maxRevise: number;
  metadata: NovelMetadata;
  profile?: string;
  onProgress?: (msg: string) => void;
  /** Test seam */
  review?: (input: {
    chapter: {
      id: string;
      projectId: string;
      number: number;
      outlineId: string;
      title: string;
      content: string;
      wordCount: number;
      createdAt: string;
      updatedAt: string;
    };
    attempt: number;
  }) => Promise<ChapterReviewResult>;
}

export interface GenerateNextInput {
  projectId: ProjectId;
  outlinePosition: number;
  lease: ProjectWriteLease;
  engine: AIAgentAdapter;
  wordCount: number;
  promptTemplateVersion?: string;
  qualityReview?: QualityReviewOptions;
  /**
   * How many times to attempt story-state extraction before failing.
   * Default 3. Draft candidate is kept on exhaustion (not rejected).
   */
  extractAttempts?: number;
  /**
   * Extend the project write lease before long LLM steps / publish.
   * Required when quality review or extract can exceed the lease TTL.
   */
  renewLease?: () => void;
  onProgress?: (step: string, msg: string) => void;
  generateContent?: (
    context: CompiledChapterContext,
    revision?: { attempt: number; feedback?: string },
  ) => Promise<GeneratedChapterContent>;
  extractState?: (input: {
    context: CompiledChapterContext;
    content: string;
    title: string;
    chapterRevisionId: ChapterRevisionId;
  }) => Promise<ExtractStoryStateResult>;
}

export interface GeneratedChapterContent {
  title: string;
  content: string;
  usage: TokenUsage;
  model: string;
}

export type GenerateChapterOutcome = {
  kind: 'published';
  chapterRevisionId: ChapterRevisionId;
  storyStateRevisionId: StoryStateRevisionId;
  outlineStatus: 'written';
  contextHash: string;
  usage: TokenUsage;
};

function readPartialContent(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('partialContent' in error)) {
    return null;
  }
  const value = (error as { partialContent: unknown }).partialContent;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function buildPrompts(
  context: CompiledChapterContext,
  wordCount: number,
  revisionFeedback?: string,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    '你是畅销小说作家。直接输出正文，不要任何解释、标题或元说明。',
    '',
    '【小说设定】',
    context.bible.compiledText,
  ].join('\n');

  const outline = context.outline.revision;
  const lines = [
    `题材：${context.genreProfile}`,
    `第 ${context.outlinePosition} 章《${outline.title}》`,
    `蓝图摘要：${outline.content.summary}`,
    `节拍：${outline.content.beats.join('、') || '（无）'}`,
    `目标字数：${wordCount}`,
  ];

  if (context.previousState) {
    lines.push('', '【前章状态】', JSON.stringify(context.previousState));
  }
  if (context.arcSummaries.length > 0) {
    lines.push(
      '',
      '【卷摘要】',
      ...context.arcSummaries.map(
        (summary) => `至第${summary.upToPosition}章：${summary.content}`,
      ),
    );
  }
  if (context.recentChapters.length > 0) {
    lines.push(
      '',
      '【最近章节原文】',
      ...context.recentChapters.map(
        (chapter) => `第${chapter.position}章《${chapter.title}》\n${chapter.content}`,
      ),
    );
  }
  if (revisionFeedback && revisionFeedback.trim().length > 0) {
    lines.push('', '【质量审阅反馈——请按此修订重写本章】', revisionFeedback.trim());
  }

  return { systemPrompt, userPrompt: lines.join('\n') };
}

export class ChapterGenerationService {
  private readonly chapters: ChapterRepository;
  private readonly states: StoryStateRepository;
  private readonly compiler: ContextCompiler;
  private readonly publication: ChapterPublicationService;
  private readonly reviewer: ChapterReviewerService;

  constructor(
    private readonly db: DB,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.chapters = new ChapterRepository(db);
    this.states = new StoryStateRepository(db);
    this.compiler = new ContextCompiler(db);
    this.publication = new ChapterPublicationService(db, now);
    this.reviewer = new ChapterReviewerService(db);
  }

  async generateNext(input: GenerateNextInput): Promise<GenerateChapterOutcome> {
    if (input.lease.projectId !== input.projectId) {
      throw new Error('Lease project does not match generateNext project');
    }
    if (!Number.isInteger(input.outlinePosition) || input.outlinePosition <= 0) {
      throw new Error('outlinePosition must be a positive integer');
    }

    this.assertPreviousState(input.projectId, input.outlinePosition);

    const promptTemplateVersion = input.promptTemplateVersion ?? 'chapter-v1';
    const context = this.compiler.compileChapterContext({
      projectId: input.projectId,
      outlinePosition: input.outlinePosition,
      promptTemplateVersion,
    });

    const outline = context.outline;
    const totalUsage: TokenUsage = { ...zeroUsage };
    const quality = input.qualityReview;
    const maxAttempts = quality?.enabled
      ? Math.max(1, Math.floor(quality.maxRevise) + 1)
      : 1;

    let content = '';
    let title = outline.revision.title;
    let candidateRevisionId: ChapterRevisionId | null = null;
    let lastReview: ChapterReviewResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const revisionFeedback = lastReview?.feedback;
      try {
        input.renewLease?.();
        const generated = input.generateContent
          ? await input.generateContent(context, { attempt, feedback: revisionFeedback })
          : await this.defaultGenerateContent(
              input.engine,
              context,
              input.wordCount,
              revisionFeedback,
            );
        content = generated.content;
        title = generated.title;
        addUsage(totalUsage, generated.usage);
      } catch (error: unknown) {
        const partial = readPartialContent(error);
        if (partial !== null) {
          this.persistCandidate({
            outlineId: outline.outline.id,
            outlinePosition: input.outlinePosition,
            projectId: input.projectId,
            title,
            content: partial,
            status: 'rejected',
          });
        }
        throw error;
      }

      const candidate = this.persistCandidate({
        outlineId: outline.outline.id,
        outlinePosition: input.outlinePosition,
        projectId: input.projectId,
        title,
        content,
        status: 'draft',
      });
      candidateRevisionId = candidate.revision.id;

      if (!quality?.enabled) {
        break;
      }

      const chapterForReview = {
        id: candidate.revision.id,
        projectId: input.projectId,
        number: input.outlinePosition,
        outlineId: outline.outline.id,
        title,
        content,
        wordCount: countChars(content),
        createdAt: candidate.revision.createdAt,
        updatedAt: candidate.revision.createdAt,
      };

      input.renewLease?.();
      quality.onProgress?.(
        `质量审阅：第 ${input.outlinePosition} 章 attempt ${attempt}/${maxAttempts}`,
      );
      const review = quality.review
        ? await quality.review({ chapter: chapterForReview, attempt })
        : await this.reviewer.reviewChapter({
            engine: input.engine,
            db: this.db,
            projectId: input.projectId,
            chapter: chapterForReview,
            metadata: quality.metadata,
            profile: quality.profile,
            attempt,
            onProgress: quality.onProgress,
          });
      addUsage(totalUsage, review.usage);
      lastReview = review;

      if (review.verdict === 'accept') {
        quality.onProgress?.(
          `质量审阅通过：${review.grade ?? ''} ${review.score ?? ''}`.trim(),
        );
        break;
      }

      const hardBlock = review.hardBlock === true;
      const softFail = review.verdict === 'revise'
        || (review.verdict === 'reject' && !hardBlock);
      if (softFail && attempt < maxAttempts) {
        this.markRevisionRejected(candidate.revision.id);
        candidateRevisionId = null;
        quality.onProgress?.(
          review.verdict === 'revise'
            ? `质量审阅要求重写：${review.reason}`
            : `质量审阅软挡（${review.grade ?? review.verdict}），尝试重写：${review.reason}`,
        );
        continue;
      }

      // Terminal quality fail: keep draft for finalize / manual review.
      throw new ChapterQualityRejectedError({
        outlinePosition: input.outlinePosition,
        verdict: review.verdict === 'revise' ? 'revise' : 'reject',
        reasons: review.reasons,
        score: review.score,
        grade: review.grade,
        draftRevisionId: candidate.revision.id,
        hardBlock,
      });
    }

    if (candidateRevisionId === null) {
      throw new Error(`Chapter ${input.outlinePosition} has no draft candidate after generation`);
    }

    const extractAttempts = Math.max(1, Math.floor(input.extractAttempts ?? 3));
    let extraction: ExtractStoryStateResult | null = null;
    let lastExtractError: unknown;
    for (let attempt = 1; attempt <= extractAttempts; attempt += 1) {
      try {
        input.renewLease?.();
        if (attempt > 1) {
          input.onProgress?.(
            `chapter:${input.outlinePosition}:extract`,
            `状态抽取重试 ${attempt}/${extractAttempts}…`,
          );
        } else {
          input.onProgress?.(
            `chapter:${input.outlinePosition}:extract`,
            `状态抽取：第 ${input.outlinePosition} 章…`,
          );
        }
        extraction = input.extractState
          ? await input.extractState({
              context,
              content,
              title,
              chapterRevisionId: candidateRevisionId,
            })
          : await extractStoryState({
              engine: input.engine,
              previousState: context.previousState,
              chapterTitle: title,
              chapterContent: content,
              chapterRevisionId: candidateRevisionId,
              outlinePosition: input.outlinePosition,
            });
        break;
      } catch (error: unknown) {
        lastExtractError = error;
        const detail = error instanceof Error ? error.message : 'state extraction failed';
        input.onProgress?.(
          `chapter:${input.outlinePosition}:extract`,
          `状态抽取失败（${attempt}/${extractAttempts}）：${detail}`,
        );
      }
    }

    if (!extraction) {
      // Keep draft so quality-accepted / generated content is not discarded.
      const detail = lastExtractError instanceof Error
        ? lastExtractError.message
        : 'state extraction failed';
      throw new StateExtractionError(detail, {
        draftRevisionId: candidateRevisionId,
        attempts: extractAttempts,
      });
    }
    addUsage(totalUsage, extraction.usage);

    input.renewLease?.();
    const published: PublishResult = this.publication.publishCandidate({
      lease: input.lease,
      candidateRevisionId,
      previousStateRevisionId: context.previousStateRevisionId,
      state: extraction.state,
      delta: extraction.delta,
      model: extraction.model,
      promptVersion: extraction.promptVersion,
      checkpoint: {
        jobId: input.lease.jobId,
        outlinePosition: input.outlinePosition,
      },
    });

    return {
      kind: 'published',
      chapterRevisionId: published.chapterRevisionId,
      storyStateRevisionId: published.storyStateRevisionId,
      outlineStatus: published.outlineStatus,
      contextHash: context.contextHash,
      usage: totalUsage,
    };
  }

  private assertPreviousState(projectId: ProjectId, outlinePosition: number): void {
    if (outlinePosition === 1) return;
    const previous = this.states.getCurrentAtPosition(projectId, outlinePosition - 1);
    if (!previous) {
      throw new StaleDependencyError(
        `Chapter ${outlinePosition} requires the current state from chapter ${outlinePosition - 1}`,
      );
    }
  }

  private async defaultGenerateContent(
    engine: AIAgentAdapter,
    context: CompiledChapterContext,
    wordCount: number,
    revisionFeedback?: string,
  ): Promise<GeneratedChapterContent> {
    const prompts = buildPrompts(context, wordCount, revisionFeedback);
    const temperature = getRuntimeConfig().generation.temperatures.chapter;
    const timeoutMs = getRuntimeConfig().generation.timeouts.chapterMs;
    const result = await engine.run(prompts.userPrompt, {
      systemPrompt: prompts.systemPrompt,
      temperature,
      maxTokens: Math.ceil(wordCount * 2.5),
      timeoutMs,
      enableCache: true,
      disableThinking: true,
    });
    const content = result.text.trim();
    if (content.length === 0) {
      throw new Error(`第 ${context.outlinePosition} 章生成失败：正文为空`);
    }
    return {
      title: context.outline.revision.title,
      content,
      usage: result.usage,
      model: result.usage.model || engine.name,
    };
  }

  private persistCandidate(input: {
    outlineId: OutlineId;
    outlinePosition: number;
    projectId: ProjectId;
    title: string;
    content: string;
    status: 'draft' | 'rejected';
  }) {
    const createdAt = this.now().toISOString();
    const existing = this.chapters.getByOutlinePosition(
      input.projectId,
      input.outlinePosition,
    );

    if (!existing) {
      return this.chapters.saveCandidate({
        chapter: {
          id: chapterId(randomUUID()),
          projectId: input.projectId,
          outlineId: input.outlineId,
          createdAt,
        },
        revision: {
          id: chapterRevisionId(randomUUID()),
          revisionNumber: 1,
          source: 'generated',
          parentRevisionId: null,
          title: input.title,
          content: input.content,
          wordCount: countChars(input.content),
          status: input.status,
          generationRunId: randomUUID(),
          createdAt,
        },
      });
    }

    return this.chapters.appendCandidate({
      chapterId: existing.id,
      revision: {
        id: chapterRevisionId(randomUUID()),
        revisionNumber: this.chapters.nextRevisionNumber(existing.id),
        source: 'generated',
        parentRevisionId: existing.activeRevisionId,
        title: input.title,
        content: input.content,
        wordCount: countChars(input.content),
        status: input.status,
        generationRunId: randomUUID(),
        createdAt,
      },
    });
  }

  private markRevisionRejected(id: ChapterRevisionId): void {
    const updated = this.db.prepare(`
      UPDATE chapter_revision
      SET status = 'rejected'
      WHERE id = ? AND status = 'draft'
    `).run(id);
    if (updated.changes !== 1) {
      throw new Error(`Chapter revision ${id} could not be rejected`);
    }
  }
}

export { buildPrompts as buildChapterPrompts };
