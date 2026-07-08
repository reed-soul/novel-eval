/**
 * 评估主流程编排
 */
import { randomUUID } from 'node:crypto';
import { createEngine } from '../engine/factory.ts';
import { runMapPhase } from './map-phase.ts';
import { runReducePhase } from './reduce-phase.ts';
import { splitChapters, countChars } from './chapter-splitter.ts';
import { parseTxt } from '../parser/txt-parser.ts';
import { loadConfig, computeOverall, lookupGrade } from '../config.ts';
import type { EvaluationResult, EvaluationTask, NovelMetadata } from '../types.ts';

export interface EvaluateOptions {
  filePath: string;
  profile?: string;
  title?: string;
  author?: string;
  metadata: NovelMetadata;
  baselineTaskId?: string;
  onProgress?: (msg: string) => void;
}

export interface EvaluateResult {
  task: EvaluationTask;
  result: EvaluationResult;
}

export async function evaluate(opts: EvaluateOptions): Promise<EvaluateResult> {
  const config = loadConfig(opts.profile ?? 'default');
  const engine = createEngine(config.engine);
  const taskId = randomUUID();
  const createdAt = new Date();

  const task: EvaluationTask = {
    id: taskId,
    filePath: opts.filePath,
    fileName: opts.filePath.split('/').pop() ?? opts.filePath,
    format: 'txt',
    status: 'parsing',
    progress: { current: 0, total: 0, message: '解析文档' },
    error: null,
    engine: engine.name,
    configSnapshot: {
      profile: config.profileName,
      model: config.engine.model,
      metadata: opts.metadata,
    },
    cost: { inputTokens: 0, outputTokens: 0, totalRmb: 0 },
    checkpoint: null,
    sourceWordCount: 0,
    chapterCount: 0,
    createdAt,
  };

  try {
    opts.onProgress?.('解析文档...');
    task.status = 'parsing';
    const doc = parseTxt(opts.filePath);
    task.sourceWordCount = countChars(doc.text);

    opts.onProgress?.('分章...');
    task.status = 'splitting';
    const chapterInputs = splitChapters(doc.text);
    task.chapterCount = chapterInputs.length;
    task.progress.total = chapterInputs.length;
    opts.onProgress?.(`识别到 ${chapterInputs.length} 章`);

    opts.onProgress?.(`Map 阶段：逐章评估 ${chapterInputs.length} 章（5 并发）...`);
    task.status = 'mapping';
    const mapResult = await runMapPhase(engine, chapterInputs, (done, total, chId, status) => {
      task.progress.current = done;
      opts.onProgress?.(`Map [${done}/${total}] ${chId} ${status}`);
    });
    task.cost.inputTokens += mapResult.usage.inputTokens;
    task.cost.outputTokens += mapResult.usage.outputTokens;
    task.cost.totalRmb += mapResult.usage.costRmb;
    opts.onProgress?.(`Map 完成（跳过 ${mapResult.skippedChapters.length} 章）`);

    opts.onProgress?.('Reduce：R1→R2→R3→R4→R5...');
    task.status = 'reducing';
    const reduceResult = await runReducePhase(
      engine, mapResult.chapters, config.profile.weights, config.profileName,
      opts.metadata,
      (step, status) => opts.onProgress?.(`Reduce ${step.toUpperCase()} ${status}`),
    );
    task.cost.inputTokens += reduceResult.usage.inputTokens;
    task.cost.outputTokens += reduceResult.usage.outputTokens;
    task.cost.totalRmb += reduceResult.usage.costRmb;
    if (reduceResult.failures.length) {
      opts.onProgress?.(`Reduce 非致命失败: ${reduceResult.failures.join(', ')}`);
    }

    opts.onProgress?.('聚合评分...');
    const totalScore = computeOverall(reduceResult.dimensions, config.profile.weights);
    const grade = lookupGrade(totalScore, config.gradeThresholds);
    const allExcerpts = mapResult.chapters.flatMap((c) => c.excerpts);

    const result: EvaluationResult = {
      schemaVersion: '1.1.0',
      novel: {
        title: opts.title ?? doc.title ?? opts.filePath.split('/').pop() ?? '未命名',
        author: opts.author ?? doc.author ?? '未知',
        totalChapters: mapResult.chapters.length,
        wordCount: task.sourceWordCount,
        genre: opts.metadata.genre,
        targetAudience: opts.metadata.targetAudience,
        platform: opts.metadata.platform,
      },
      overall: { totalScore, grade },
      dimensions: reduceResult.dimensions,
      chapters: mapResult.chapters,
      characters: reduceResult.characters,
      emotionalCurve: reduceResult.emotionalCurve,
      excerpts: allExcerpts,
      suggestions: reduceResult.suggestions,
      marketBenchmark: reduceResult.marketBenchmark,
      baselineTaskId: opts.baselineTaskId,
      task: {
        id: taskId,
        error: null,
        engine: engine.name,
        configSnapshot: task.configSnapshot,
        cost: task.cost,
        checkpoint: null,
        sourceWordCount: task.sourceWordCount,
        chapterCount: task.chapterCount,
        createdAt: createdAt.toISOString(),
        completedAt: new Date().toISOString(),
      },
    };

    task.status = 'completed';
    task.completedAt = new Date();
    opts.onProgress?.(`✓ 评估完成：总分 ${totalScore}（${grade}），费用 ¥${task.cost.totalRmb.toFixed(4)}`);

    return { task, result };
  } catch (e) {
    task.status = 'failed';
    task.error = e as Error;
    opts.onProgress?.(`✗ 评估失败: ${(e as Error).message}`);
    throw e;
  }
}
