/**
 * 章节生成入口 — 顺序生成 + pause/cancel 边界控制。
 *
 * 单章生成委托 ChapterGenerationService；上下文由 ContextCompiler 组装。
 */
import type { AIAgentAdapter } from '@novel-eval/shared';
import { addUsage, zeroUsage } from '@novel-eval/shared';
import type { TokenUsage } from '@novel-eval/shared';

import type { DB } from '../db.ts';
import type { ProjectId } from '../domain/ids.ts';
import { projectId } from '../domain/ids.ts';
import { ChapterRepository } from '../repositories/chapter-repository.ts';
import type { ProjectWriteLease } from '../repositories/lease-repository.ts';
import {
  ChapterGenerationService,
  buildChapterPrompts,
  type GenerateChapterOutcome,
} from '../services/chapter-generation-service.ts';
import type { CompiledChapterContext } from '../services/context-compiler.ts';
import type { ExtractStoryStateResult } from './finalizer.ts';

export { buildChapterPrompts };

export interface GenerateChapterOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  number: number;
  wordCount: number;
  /** 项目写租约；CLI 遗留路径在 Task 7 facade 接入前可暂缺，运行时会失败。 */
  lease?: ProjectWriteLease;
  onProgress?: (step: string, msg: string) => void;
  extractState?: (input: {
    context: CompiledChapterContext;
    content: string;
    title: string;
    chapterRevisionId: import('../domain/ids.ts').ChapterRevisionId;
  }) => Promise<ExtractStoryStateResult>;
  generateContent?: (
    context: CompiledChapterContext,
  ) => Promise<{ title: string; content: string; usage: TokenUsage; model: string }>;
}

export interface GenerateChapterResult {
  number: number;
  title: string;
  content: string;
  wordCount: number;
  usage: TokenUsage;
  outcome: GenerateChapterOutcome;
}

function assertNoQualityGate(opts: object): void {
  if (!('qualityGate' in opts)) return;
  const value = (opts as { qualityGate?: unknown }).qualityGate;
  if (value !== undefined) {
    throw new Error(
      'qualityGate is unsupported until the chapter quality system lands; do not enable it',
    );
  }
}

export async function generateChapter(
  opts: GenerateChapterOptions,
): Promise<GenerateChapterResult> {
  assertNoQualityGate(opts);
  const { engine, db, number, wordCount, lease, onProgress } = opts;
  if (!lease) {
    throw new Error('generateChapter requires a project write lease');
  }
  const id: ProjectId = projectId(opts.projectId);
  onProgress?.(`chapter:${number}`, `生成第 ${number} 章...`);

  const service = new ChapterGenerationService(db);
  const outcome = await service.generateNext({
    projectId: id,
    outlinePosition: number,
    lease,
    engine,
    wordCount,
    extractState: opts.extractState,
    generateContent: opts.generateContent,
  });

  const chapters = new ChapterRepository(db);
  const published = chapters.getRevision(outcome.chapterRevisionId);
  if (!published) {
    throw new Error(`Published revision ${outcome.chapterRevisionId} is missing`);
  }

  return {
    number,
    title: published.revision.title,
    content: published.revision.content,
    wordCount: published.revision.wordCount,
    usage: { ...zeroUsage },
    outcome,
  };
}

/**
 * 生成控制 — 在章节边界检查暂停/取消信号。
 *
 * 只在每章开始前检查（不中断正在进行的单章生成），
 * 保证暂停时当前章会完整写完并落盘，状态与正文永远对齐。
 */
export interface GenerationControl {
  shouldPause?: () => boolean;
  shouldCancel?: () => boolean;
  onChapterComplete?: (n: number) => void;
}

export class JobPausedError extends Error {
  readonly nextChapter: number;
  constructor(nextChapter: number) {
    super(`paused at chapter ${nextChapter}`);
    this.name = 'JobPausedError';
    this.nextChapter = nextChapter;
  }
}

export class JobCancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'JobCancelledError';
  }
}

export interface GenerateRangeOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  from: number;
  to: number;
  wordCount: number;
  /** 项目写租约；CLI 遗留路径在 Task 7 facade 接入前可暂缺，运行时会失败。 */
  lease?: ProjectWriteLease;
  onProgress?: (step: string, msg: string) => void;
  control?: GenerationControl;
  extractState?: GenerateChapterOptions['extractState'];
  generateContent?: GenerateChapterOptions['generateContent'];
}

export async function generateRange(
  opts: GenerateRangeOptions,
): Promise<GenerateChapterResult[]> {
  assertNoQualityGate(opts);
  const results: GenerateChapterResult[] = [];
  const totalUsage = { ...zeroUsage };
  for (let n = opts.from; n <= opts.to; n++) {
    if (opts.control?.shouldCancel?.()) throw new JobCancelledError();
    if (opts.control?.shouldPause?.()) throw new JobPausedError(n);
    const result = await generateChapter({
      engine: opts.engine,
      db: opts.db,
      projectId: opts.projectId,
      number: n,
      wordCount: opts.wordCount,
      lease: opts.lease,
      onProgress: opts.onProgress,
      extractState: opts.extractState,
      generateContent: opts.generateContent,
    });
    addUsage(totalUsage, result.usage);
    opts.control?.onChapterComplete?.(n);
    results.push(result);
  }
  return results;
}
