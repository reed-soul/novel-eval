/**
 * 评估主流程编排
 */
import { randomUUID } from 'node:crypto';
import { createEngine, type AIAgentAdapter } from '@novel-eval/shared';
import { evaluationCoverageFor } from '@novel-eval/shared';
import { runMapPhase } from './map-phase.ts';
import { runReducePhase } from './reduce-phase.ts';
import { splitChaptersWithMeta, countChars } from '@novel-eval/shared';
import { analyzeChapterRule } from '@novel-eval/shared';
import { parseTxt } from '@novel-eval/shared';
import { loadConfig, computeOverall, lookupGrade, loadPlatform, computePlatformGate } from './config.ts';
import type { EvaluationResult, EvaluationTask, NovelMetadata } from './types.ts';

export interface EvaluateOptions {
  filePath: string;
  profile?: string;
  title?: string;
  author?: string;
  metadata: NovelMetadata;
  baselineTaskId?: string;
  onProgress?: (msg: string) => void;
  /** Injected engine (tests / VCR). When omitted, createEngine(config.engine). */
  engine?: AIAgentAdapter;
}

export interface EvaluateResult {
  task: EvaluationTask;
  result: EvaluationResult;
}

export async function evaluate(opts: EvaluateOptions): Promise<EvaluateResult> {
  const config = loadConfig(opts.profile ?? 'default');
  const engine = opts.engine ?? createEngine(config.engine);
  const taskId = randomUUID();
  const createdAt = new Date();
  const platformName = opts.metadata.platform?.trim() || 'general';
  const platform = loadPlatform(platformName); // 未知平台立即失败，不静默当 general

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
      platform: platform.name,
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

    // L1 启发式分章（纯逻辑，不调 LLM）
    const heuristic = splitChaptersWithMeta(doc.text);
    let chapterInputs = heuristic.chapters;
    const strategyLabel =
      heuristic.strategy === 'separator' ? '分隔符模式'
      : heuristic.strategy === 'regex' ? '行首正则模式'
      : '无标志回退';

    // 碎片段防护（对齐 audit 管线）：双层标题导出 md 会切出只有元信息头的碎片段，
    // 跳过后污染覆盖率（森铁 31 单元 16 跳过 → skip rate 0.52 触发覆盖门误报）。
    const MIN_CHAPTER_CHARS = 300;
    const fragmentTitles = chapterInputs
      .filter((c) => countChars(c.content) < MIN_CHAPTER_CHARS)
      .map((c) => c.title);
    if (fragmentTitles.length > 0 && chapterInputs.length - fragmentTitles.length > 0) {
      chapterInputs = chapterInputs
        .filter((c) => countChars(c.content) >= MIN_CHAPTER_CHARS)
        .map((c, i) => ({ ...c, id: `ch${String(i + 1).padStart(3, '0')}` }));
      opts.onProgress?.(`剔除 ${fragmentTitles.length} 个碎片段（书名页/双层标题元信息），章号已重排`);
    }

    // 是否需要 L2 AI 确认：L1 低置信度，或章节数可疑（仅 1 章但字数很大）
    const suspicious = heuristic.confidence === 'low'
      || (chapterInputs.length === 1 && task.sourceWordCount > 50_000);
    if (suspicious) {
      opts.onProgress?.(`L1 ${strategyLabel}（${chapterInputs.length} 章，置信度低）→ AI 确认章节规则...`);
      const analysis = await analyzeChapterRule(engine, doc.text, heuristic);
      task.cost.inputTokens += analysis.usage.inputTokens;
      task.cost.outputTokens += analysis.usage.outputTokens;
      task.cost.totalRmb += analysis.usage.costRmb;
      if (!analysis.useHeuristic && analysis.resplitChapters) {
        chapterInputs = analysis.resplitChapters;
        opts.onProgress?.(`AI 重切：${analysis.pattern}（${chapterInputs.length} 章）`);
      } else {
        opts.onProgress?.(`AI 确认：沿用启发式（${analysis.pattern}）`);
      }
    } else {
      opts.onProgress?.(`L1 ${strategyLabel}（${heuristic.confidence}）→ ${chapterInputs.length} 章`);
    }

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
    const allExcerpts = mapResult.chapters.flatMap((chapter) =>
      chapter.excerpts.map((excerpt, excerptIndex) => ({
        ...excerpt,
        chapterId: excerpt.chapterId || chapter.id,
        excerptIndex,
      })),
    );

    const skippedChapterIds = [...mapResult.skippedChapters];
    const platformGate = computePlatformGate(platform, reduceResult.dimensions);
    if (platformGate.verdict === 'block') {
      opts.onProgress?.(
        `⛔ 投稿门（${platform.displayName}）：${platformGate.reasons.join('；')}——不建议以当前状态投稿`,
      );
    } else if (platform.name !== 'general') {
      opts.onProgress?.(`✅ 投稿门（${platform.displayName}）：红线全部通过`);
    }
    const coverage = evaluationCoverageFor({
      dimensions: reduceResult.dimensions,
      excerpts: allExcerpts,
      chapters: mapResult.chapters,
      task: {
        sourceWordCount: task.sourceWordCount,
        chapterCount: task.chapterCount,
      },
      skippedChapterIds,
    });

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
      platformGate,
      baselineTaskId: opts.baselineTaskId,
      coverage,
      skippedChapterIds,
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
    if (!coverage.complete) {
      opts.onProgress?.(
        `⚠ 覆盖不完整：${(coverage.incompleteReasons ?? []).join('; ') || 'unknown'}`,
      );
    }
    opts.onProgress?.(`✓ 评估完成：总分 ${totalScore}（${grade}），费用 ¥${task.cost.totalRmb.toFixed(4)}`);

    return { task, result };
  } catch (e) {
    task.status = 'failed';
    task.error = e as Error;
    opts.onProgress?.(`✗ 评估失败: ${(e as Error).message}`);
    throw e;
  }
}
