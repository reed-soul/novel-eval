import { randomUUID } from 'node:crypto';

import type { AIAgentAdapter, TokenUsage } from '@novel-eval/shared';
import { countChars } from '@novel-eval/shared';

import { extractStoryState, type ExtractStoryStateResult } from '../chapter/finalizer.ts';
import type { DB } from '../db.ts';
import { StaleDependencyError, StateExtractionError } from '../domain/errors.ts';
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

export interface GenerateNextInput {
  projectId: ProjectId;
  outlinePosition: number;
  lease: ProjectWriteLease;
  engine: AIAgentAdapter;
  wordCount: number;
  promptTemplateVersion?: string;
  generateContent?: (context: CompiledChapterContext) => Promise<GeneratedChapterContent>;
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

export type GenerateChapterOutcome =
  | {
      kind: 'published';
      chapterRevisionId: ChapterRevisionId;
      storyStateRevisionId: StoryStateRevisionId;
      outlineStatus: 'written';
      contextHash: string;
    }
  | {
      kind: 'rejected';
      chapterRevisionId: ChapterRevisionId;
      reason: string;
      contextHash: string;
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

  return { systemPrompt, userPrompt: lines.join('\n') };
}

export class ChapterGenerationService {
  private readonly chapters: ChapterRepository;
  private readonly states: StoryStateRepository;
  private readonly compiler: ContextCompiler;
  private readonly publication: ChapterPublicationService;

  constructor(
    private readonly db: DB,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.chapters = new ChapterRepository(db);
    this.states = new StoryStateRepository(db);
    this.compiler = new ContextCompiler(db);
    this.publication = new ChapterPublicationService(db, now);
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
    let content: string;
    let title = outline.revision.title;

    try {
      const generated = input.generateContent
        ? await input.generateContent(context)
        : await this.defaultGenerateContent(input.engine, context, input.wordCount);
      content = generated.content;
      title = generated.title;
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

    let extraction: ExtractStoryStateResult;
    try {
      extraction = input.extractState
        ? await input.extractState({
            context,
            content,
            title,
            chapterRevisionId: candidate.revision.id,
          })
        : await extractStoryState({
            engine: input.engine,
            previousState: context.previousState,
            chapterTitle: title,
            chapterContent: content,
            chapterRevisionId: candidate.revision.id,
            outlinePosition: input.outlinePosition,
          });
    } catch (error: unknown) {
      this.markRevisionRejected(candidate.revision.id);
      const message = error instanceof Error ? error.message : 'state extraction failed';
      throw new StateExtractionError(message);
    }

    const published: PublishResult = this.publication.publishCandidate({
      lease: input.lease,
      candidateRevisionId: candidate.revision.id,
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
  ): Promise<GeneratedChapterContent> {
    const prompts = buildPrompts(context, wordCount);
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
