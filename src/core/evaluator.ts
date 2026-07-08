/**
 * 评估主流程编排（对齐设计文档 v2.2 第三章）
 *
 * 流程：解析文档 → 分章 → Map → Reduce → 聚合总分 → 生成结果 JSON
 */
import { randomUUID } from 'node:crypto';
import { createEngine } from '../engine/factory.ts';
import { runMapPhase } from './map-phase.ts';
import { runReducePhase } from './reduce-phase.ts';
import { splitChapters, countChars } from './chapter-splitter.ts';
import { parseTxt } from '../parser/txt-parser.ts';
import { loadConfig, computeOverall, lookupGrade } from '../config.ts';
import { DIMENSION_KEYS } from '../types.ts';
import type { EvaluationResult, EvaluationTask, Chapter } from '../types.ts';

export interface EvaluateOptions {
  filePath: string;
  profile?: string;
  title?: string;
  author?: string;
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
    configSnapshot: { profile: config.profileName, model: config.engine.model },
    cost: { inputTokens: 0, outputTokens: 0, totalRmb: 0 },
    checkpoint: null,
    sourceWordCount: 0,
    chapterCount: 0,
    createdAt,
  };

  try {
    // 1. 解析文档
    opts.onProgress?.('解析文档...');
    task.status = 'parsing';
    const doc = parseTxt(opts.filePath);
    task.sourceWordCount = countChars(doc.text);

    // 2. 分章
    opts.onProgress?.('分章...');
    task.status = 'splitting';
    const chapterInputs = splitChapters(doc.text);
    task.chapterCount = chapterInputs.length;
    task.progress.total = chapterInputs.length;
    opts.onProgress?.(`识别到 ${chapterInputs.length} 章`);

    // 3. Map 阶段
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

    // 4. Reduce 阶段
    opts.onProgress?.('Reduce 阶段：R1 人物归一化 → R2 五维评分 → R3 情绪曲线 → R4 改进建议...');
    task.status = 'reducing';
    const reduceResult = await runReducePhase(
      engine, mapResult.chapters, config.profile.weights, config.profileName,
      (step, status) => opts.onProgress?.(`Reduce ${step.toUpperCase()} ${status}`),
    );
    task.cost.inputTokens += reduceResult.usage.inputTokens;
    task.cost.outputTokens += reduceResult.usage.outputTokens;
    task.cost.totalRmb += reduceResult.usage.costRmb;
    if (reduceResult.failures.length) {
      opts.onProgress?.(`Reduce 非致命失败: ${reduceResult.failures.join(', ')}`);
    }

    // 5. 聚合总分
    opts.onProgress?.('聚合评分...');
    const totalScore = computeOverall(reduceResult.dimensions, config.profile.weights);
    const grade = lookupGrade(totalScore, config.gradeThresholds);

    // 展平所有 excerpts（供前端检索）
    const allExcerpts = mapResult.chapters.flatMap((c) => c.excerpts);

    const result: EvaluationResult = {
      schemaVersion: '1.0.0',
      novel: {
        title: opts.title ?? doc.title ?? opts.filePath.split('/').pop() ?? '未命名',
        author: opts.author ?? doc.author ?? '未知',
        totalChapters: mapResult.chapters.length,
        wordCount: task.sourceWordCount,
      },
      overall: { totalScore, grade },
      dimensions: reduceResult.dimensions,
      chapters: mapResult.chapters,
      characters: reduceResult.characters,
      emotionalCurve: reduceResult.emotionalCurve,
      excerpts: allExcerpts,
      suggestions: reduceResult.suggestions,
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
