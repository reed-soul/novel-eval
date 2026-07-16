/**
 * 经验驱动的局部修正器 — 对已写好的章节按历史经验做针对性修正
 *
 * 把 lesson_learned 从「只前馈（写新章时注入）」变成「也能回溯修补已写的弱章」。
 *
 * 流程（单章）：
 *   1. diagnoseChapter()  诊断：读最新 eval_history + 重复检测 + 经验，按得分选策略
 *   2. correctChapter()   编排：选 prompt → 生成修正稿 → 重新评估 → 暂存（原章不动）
 *   3. 预览 diff（前端）
 *   4. applyCorrectionDraft()    采纳：发布 correction revision + 失效下游 + 可选 rebuild
 *      discardCorrectionDraft()  放弃：无副作用
 *
 * 核心原则：采纳前原章零修改，所有改动先进 correction_draft 暂存表。
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIAgentAdapter, NovelMetadata, TokenUsage } from '@novel-eval/shared';
import { loadPrompt, addUsage, zeroUsage, countChars } from '@novel-eval/shared';
import { assessChapters } from '@novel-eval/eval';
import type { DimensionKey, DimensionScore } from '@novel-eval/eval';
import { DIMENSION_LABELS } from '@novel-eval/eval';
import type { DB } from '../db.ts';
import {
  getOutline, getChapter, getRecentChapters, getNarrativeState, getBibleForChapter,
  countOutlines, getEvalHistory,
  getLessonsByPattern, saveCorrectionDraft, getDraft, updateDraftStatus,
  type CorrectionStrategy,
} from './store.ts';
import { classifyChapter } from './lesson-aggregator.ts';
import { aggregateLessons } from './lesson-aggregator.ts';
import { detectRepetition } from './repetition.ts';
import { getRuntimeConfig } from '../runtime-config.ts';
import { chapterRevisionId, projectId } from '../domain/ids.ts';
import type { StoryState, StoryStateDelta } from '../domain/story-state.ts';
import { ChapterRepository } from '../repositories/chapter-repository.ts';
import type { ProjectWriteLease } from '../repositories/lease-repository.ts';
import { StoryStateRepository } from '../repositories/story-state-repository.ts';
import {
  ChapterPublicationService,
  type PublishResult,
} from '../services/chapter-publication-service.ts';
import {
  StateRebuildService,
  type RebuildFromInput,
  type RebuildResult,
} from '../services/state-rebuild-service.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

const RECENT_WINDOW = 5;
/** 低分门槛（与 qualityGate.minDimScore 一致）*/
const LOW_DIM_THRESHOLD = 65;

// ─── 策略路由 ─────────────────────────────────────────────────────

/** 走外科手术的维度集合：文笔/节奏类问题，局部改即可 */
const SURGICAL_DIMS: ReadonlySet<DimensionKey> = new Set(['writingQuality', 'pacingRetention']);

export type { CorrectionStrategy };

/** 诊断出的单条问题 */
export interface DiagnosisIssue {
  dimension: DimensionKey;
  dimensionLabel: string;
  score: number;
  /** 该问题对应的修正策略 */
  type: CorrectionStrategy;
  /** 来自经验的依据（common_issues / effective_fixes），可空 */
  lessonRef: string | null;
}

/** 诊断结果 */
export interface DiagnosisResult {
  strategy: CorrectionStrategy;
  issues: DiagnosisIssue[];
  /** 重复检测报告（hotspots 非空也会触发 surgical）*/
  repetition: { within: number; cross: number; hotspots: string[]; verdict: string };
  /** 章节模式（开局/推进/转折/高潮/结局/默认）*/
  pattern: string;
}

// ─── 诊断（纯 DB + 算法，无 LLM）──────────────────────────────────

/**
 * 诊断某章的问题并给出推荐策略。
 * 数据来源：最新 eval_history 的维度得分 + 重复检测 + lesson_learned 经验。
 */
export function diagnoseChapter(db: DB, projectId: string, chapterNumber: number): DiagnosisResult {
  const chapter = getChapter(db, projectId, chapterNumber);
  if (!chapter) throw new Error(`第 ${chapterNumber} 章不存在，无法诊断`);

  // 章节模式分类
  const outline = getOutline(db, projectId, chapterNumber);
  const totalChapters = countOutlines(db, projectId);
  const pattern = outline
    ? classifyChapter(outline, totalChapters)
    : '默认';

  // 取最新评估的维度得分
  const history = getEvalHistory(db, projectId, chapterNumber);
  const latest = history[history.length - 1];
  const dimensions = (latest?.dimensions ?? null) as Record<DimensionKey, DimensionScore> | null;

  // 重复检测（无论有无 eval_history 都跑一遍——经验表明确记了重复片段）
  const recent = getRecentChapters(db, projectId, chapterNumber, RECENT_WINDOW);
  const rep = detectRepetition(chapter.content, recent.map((c) => c.content));

  // 取该 pattern 的经验
  const lessons = getLessonsByPattern(db, pattern, projectId);
  const lessonByDim = new Map<string, { commonIssues: string[]; effectiveFixes: string[] }>();
  for (const l of lessons) {
    if (l.dimension) lessonByDim.set(l.dimension, { commonIssues: l.commonIssues, effectiveFixes: l.effectiveFixes });
  }

  // 收集低分维度问题
  const issues: DiagnosisIssue[] = [];
  if (dimensions) {
    for (const dim of Object.keys(dimensions) as DimensionKey[]) {
      const score = dimensions[dim].score;
      if (score < LOW_DIM_THRESHOLD) {
        const lesson = lessonByDim.get(dim);
        issues.push({
          dimension: dim,
          dimensionLabel: DIMENSION_LABELS[dim] ?? dim,
          score,
          type: SURGICAL_DIMS.has(dim) ? 'surgical' : 'rewrite',
          lessonRef: lesson ? [...lesson.commonIssues, ...lesson.effectiveFixes].join('；') || null : null,
        });
      }
    }
    issues.sort((a, b) => a.score - b.score);
  }

  // 策略路由：得分驱动
  let strategy: CorrectionStrategy;
  const lowDims = new Set(issues.map((i) => i.dimension));
  const hasSurgicalLow = issues.some((i) => i.type === 'surgical');
  const hasRewriteLow = issues.some((i) => i.type === 'rewrite');
  const hasHotspots = rep.hotspots.length > 0;

  if (hasSurgicalLow || hasHotspots) {
    // writingQuality 低分 或 有重复 hotspots → 外科手术（即使同时有 rewrite 低分，也优先 surgical 合并处理重复）
    strategy = 'surgical';
  } else if (hasRewriteLow) {
    strategy = 'rewrite';
  } else if (lowDims.size === 0) {
    // 没有低分维度：仍检查经验表里是否有 writingQuality 的重复记录
    const wqLesson = lessonByDim.get('writingQuality');
    if (wqLesson?.commonIssues.some((s) => s.includes('重复片段'))) {
      strategy = 'surgical';
    } else {
      // 实在没有明确问题，默认 rewrite（让模型按经验整体提升）
      strategy = 'rewrite';
    }
  } else {
    strategy = 'rewrite';
  }

  return {
    strategy,
    issues,
    repetition: {
      within: rep.withinChapter, cross: rep.crossChapter,
      hotspots: rep.hotspots, verdict: rep.verdict,
    },
    pattern,
  };
}

// ─── 修正编排（LLM 生成 + 重新评估）──────────────────────────────

export interface CorrectChapterOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  chapterNumber: number;
  metadata: NovelMetadata;
  /** 强制策略（覆盖自动诊断）。不传则自动判断 */
  strategy?: CorrectionStrategy;
  onProgress?: (step: string, msg: string) => void;
}

export interface CorrectResult {
  draftId: string;
  strategy: CorrectionStrategy;
  originalScore: number | null;
  revisedScore: number | null;
  issues: DiagnosisIssue[];
  changes: Array<{ original: string; revised: string; reason: string }>;
}

export async function correctChapter(opts: CorrectChapterOptions): Promise<CorrectResult> {
  const { engine, db, projectId, chapterNumber, metadata, onProgress } = opts;
  const totalUsage: TokenUsage = { ...zeroUsage };

  // 1. 诊断（或用强制策略）
  onProgress?.('diagnose', '诊断章节问题...');
  const diag = diagnoseChapter(db, projectId, chapterNumber);
  const strategy: CorrectionStrategy = opts.strategy ?? diag.strategy;
  onProgress?.('diagnose', `策略：${strategy === 'surgical' ? '外科手术式局部改写' : '整章重写'}（${diag.issues.length} 个问题）`);

  const chapter = getChapter(db, projectId, chapterNumber);
  if (!chapter) throw new Error(`第 ${chapterNumber} 章不存在`);
  const outline = getOutline(db, projectId, chapterNumber);
  if (!outline) throw new Error(`第 ${chapterNumber} 章蓝图不存在`);

  // 2. 组装 prompt 并生成
  const wordCount = getRuntimeConfig().generation.chapterWordCount;
  onProgress?.('generate', `生成修正稿（${strategy}）...`);
  const { revisedContent, rawOutput } = await generateRevision({
    engine, db, projectId, chapterNumber, strategy, wordCount, diag,
    title: chapter.title, originalContent: chapter.content, outline, totalUsage, onProgress,
  });
  addUsage(totalUsage, { ...zeroUsage });

  if (revisedContent.trim().length === 0) {
    throw new Error(`第 ${chapterNumber} 章修正失败：正文为空`);
  }

  // 3. 解析改动点（仅 surgical 有结构化改动说明）
  const changes = strategy === 'surgical' ? parseChangeLog(rawOutput) : [];

  // 4. 重新评估修正稿
  onProgress?.('assess', '重新评估修正稿...');
  const assessResult = await assessChapters({
    engine,
    chapters: [{ id: `ch${chapterNumber}`, title: chapter.title, content: revisedContent }],
    metadata,
    onProgress: (msg) => onProgress?.('assess', `  ${msg}`),
  });
  addUsage(totalUsage, assessResult.usage);

  const revisedScore = assessResult.totalScore;
  // 原始分：取最新 eval_history
  const history = getEvalHistory(db, projectId, chapterNumber);
  const originalScore = history[history.length - 1]?.totalScore ?? null;

  // 运行对修正稿的重复率检测
  const recent = getRecentChapters(db, projectId, chapterNumber, RECENT_WINDOW);
  const rep = detectRepetition(revisedContent, recent.map((c) => c.content));

  const revisedResult = {
    grade: assessResult.grade,
    dimensions: assessResult.dimensions,
    suggestions: assessResult.suggestions,
    repetition: {
      within: rep.withinChapter,
      cross: rep.crossChapter,
      hotspots: rep.hotspots,
    },
  };

  // 5. 暂存（原章不动）
  const draftId = saveCorrectionDraft(db, {
    projectId, chapterNumber, strategy,
    originalContent: chapter.content, revisedContent,
    originalScore, revisedScore,
    issues: diag.issues,
    changes,
    revisedResult,
    engine: engine.name,
  });

  onProgress?.('done', `修正完成：原 ${originalScore ?? '?'} → 新 ${revisedScore}`);

  return { draftId, strategy, originalScore, revisedScore, issues: diag.issues, changes };
}

// ─── prompt 组装 + 生成 ──────────────────────────────────────────

interface GenerateRevisionArgs {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  chapterNumber: number;
  strategy: CorrectionStrategy;
  wordCount: number;
  diag: DiagnosisResult;
  title: string;
  originalContent: string;
  outline: { act: number; suspenseLevel: number; twistLevel: number; role: string; purpose: string; foreshadowing: string; summary: string };
  totalUsage: TokenUsage;
  onProgress?: (step: string, msg: string) => void;
}

async function generateRevision(args: GenerateRevisionArgs): Promise<{ revisedContent: string; rawOutput: string }> {
  const { engine, db, projectId, strategy, diag, title, originalContent, outline } = args;

  const { fullText, characterState } = getBibleForChapter(db, projectId);
  const systemPrompt = `你是资深小说编辑，擅长在保持故事内核的前提下打磨文字。\n\n【小说设定】\n${fullText}`;

  let userPrompt: string;

  if (strategy === 'surgical') {
    // 外科手术：只解决重复/措辞
    const issuesText = diag.repetition.hotspots.length
      ? diag.repetition.hotspots.join('\n')
      : '（未检测到明显重复，按经验提示处理）';
    const lessonIssues = collectLessonIssues(diag);
    userPrompt = loadPrompt('correct-surgical', PROMPTS_DIR)
      .replace('{NUMBER}', String(args.chapterNumber))
      .replace('{TITLE}', title)
      .replace('{CURRENT_CONTENT}', originalContent)
      .replace('{ISSUES}', issuesText)
      .replace('{LESSON_ISSUES}', lessonIssues);
  } else {
    // 整章重写：注入上下文 + 修正依据
    const recent = getRecentChapters(db, projectId, args.chapterNumber, getRuntimeConfig().generation.recentWindow);
    const narrative = getNarrativeState(db, projectId);
    const macroSummary = narrative?.macroSummary ?? '（尚无前情摘要）';
    const recentText = recent.length
      ? recent.map((c) => `第${c.number}章《${c.title}》\n${c.content}`).join('\n\n---\n\n')
      : '（无前序章节）';
    const stateText = characterState.characters.map((c) =>
      `${c.name}：[${c.items.join('、')}] 能力[${c.abilities.join('、')}] 状态：${c.status} 事件[${c.events.join('；')}]`,
    ).join('\n');
    const feedback = buildCorrectionFeedback(diag, args.db, projectId);

    userPrompt = loadPrompt('correct-rewrite', PROMPTS_DIR)
      .replace('{MACRO_SUMMARY}', macroSummary)
      .replace('{CHARACTER_STATE}', stateText)
      .replace('{RECENT_CHAPTERS}', recentText)
      .replace('{NUMBER}', String(args.chapterNumber))
      .replace('{TITLE}', title)
      .replace('{ROLE}', outline.role)
      .replace('{PURPOSE}', outline.purpose)
      .replace('{SUSPENSE}', String(outline.suspenseLevel))
      .replace('{FORESHADOWING}', outline.foreshadowing || '（本章无显式伏笔操作）')
      .replace('{TWIST}', String(outline.twistLevel))
      .replace('{SUMMARY}', outline.summary)
      .replace('{CURRENT_CONTENT}', originalContent)
      .replace('{FEEDBACK}', feedback)
      .replace('{WORD_COUNT}', String(args.wordCount));
  }

  // 引擎调用（复用 generator 的重试/温度/超时模式）
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await engine.run(userPrompt, {
        systemPrompt,
        temperature: getRuntimeConfig().generation.temperatures.chapter,
        maxTokens: Math.ceil(args.wordCount * 3),
        timeoutMs: getRuntimeConfig().generation.timeouts.chapterMs,
        enableCache: true,
        disableThinking: true,
      });
      break;
    } catch (error) {
      args.onProgress?.('generate', `LLM 调用失败 (尝试 ${attempt}/3): ${(error as Error).message}`);
      if (attempt === 3) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (!res) throw new Error('LLM 返回为空');
  addUsage(args.totalUsage, res.usage);

  const revisedContent = extractRevisedContent(res.text);
  return { revisedContent, rawOutput: res.text };
}

/** 从 surgical 输出里抽取【修正后全文】段落，并清洗 */
function extractRevisedContent(raw: string): string {
  let text = raw.trim();
  // 去 markdown 包裹
  text = text.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');

  // surgical 模板要求先输出【修正后全文】再输出【改动说明】
  // 兼容不同的括号（【】/[]）和标题格式
  const fullTextMatch = text.match(/(?:【修正后全文】|\[修正后全文\]|###?\s*修正后全文)\s*([\s\S]*?)(?:\n(?:【改动说明】|\[改动说明\]|###?\s*改动说明)|$)/);
  if (fullTextMatch) {
    text = fullTextMatch[1].trim();
  }

  // 二次清理：如果在【修正后全文】内部依然有 markdown 包裹，去掉它
  text = text.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '').trim();

  // 去开头的章节标题重复
  text = text.replace(/^[#\s]*第[一二三四五六七八九十百零\d]+章[^\n]*\n/, '').trim();
  return text;
}

/** 解析 surgical 输出的【改动说明】段为结构化 changes */
function parseChangeLog(raw: string): Array<{ original: string; revised: string; reason: string }> {
  const changes: Array<{ original: string; revised: string; reason: string }> = [];
  const logMatch = raw.match(/(?:【改动说明】|\[改动说明\]|###?\s*改动说明)\s*([\s\S]*?)$/);
  if (!logMatch) return changes;
  const logText = logMatch[1].trim();
  if (!logText || logText === '（无）') return changes;

  // 每行形如：原文：「…」→ 改为：「…」｜原因：… (其中原因可选)
  const lineRe = /原文[：:]\s*「([^」]*)」\s*→\s*改为[：:]\s*「([^」]*)」(?:\s*[|｜]\s*原因[：:]\s*([^\n]*))?/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(logText)) !== null) {
    changes.push({
      original: m[1].trim(),
      revised: m[2].trim(),
      reason: m[3] ? m[3].trim() : '',
    });
  }
  // 兜底：按行切，并自动清洗前缀
  if (changes.length === 0) {
    for (const line of logText.split('\n')) {
      const arrow = line.indexOf('→');
      if (arrow > 0) {
        let orig = line.slice(0, arrow).trim();
        let rev = line.slice(arrow + 1).trim();
        let reason = '';

        // 尝试解析 ｜原因：
        const reasonIdx = rev.search(/[|｜]\s*原因[：:]/);
        if (reasonIdx > 0) {
          reason = rev.slice(reasonIdx).replace(/^[|｜]\s*原因[：:]\s*/, '').trim();
          rev = rev.slice(0, reasonIdx).trim();
        }

        // 清洗 原文：「」 和 改为：「」
        orig = orig.replace(/^原文[：:]\s*/, '').replace(/^「/, '').replace(/」$/, '').trim();
        rev = rev.replace(/^改为[：:]\s*/, '').replace(/^「/, '').replace(/」$/, '').trim();

        changes.push({ original: orig, revised: rev, reason });
      }
    }
  }
  return changes.slice(0, 30);
}

/** 汇总该 pattern 经验里的问题文案（surgical prompt 用）*/
function collectLessonIssues(diag: DiagnosisResult): string {
  const wqIssue = diag.issues.find((i) => i.dimension === 'writingQuality');
  if (wqIssue?.lessonRef) return wqIssue.lessonRef;
  if (diag.repetition.hotspots.length) return `高频重复：${diag.repetition.hotspots.join('、')}`;
  return '（无特定经验提示）';
}

/** 构造 rewrite 策略的修正依据（经验 + 本次评估低分维度）*/
function buildCorrectionFeedback(diag: DiagnosisResult, db: DB, projectId: string): string {
  // 取经验里的 effective_fixes + common_issues
  const lessons = getLessonsByPattern(db, diag.pattern, projectId);
  const parts: string[] = [];

  const lowDims = diag.issues.map((i) => `${i.dimensionLabel}（${i.score}）`);
  if (lowDims.length) {
    parts.push('【本次评估低分维度】');
    parts.push(`  ${lowDims.join('、')}`);
  }

  const fixes = lessons.filter((l) => l.effectiveFixes.length > 0).slice(0, 3);
  if (fixes.length) {
    parts.push('【已验证有效的改进方向（历史经验）】');
    for (const l of fixes) parts.push(`  ${l.dimension ?? '综合'}：${l.effectiveFixes.join('；')}`);
  }

  const lowLessonIssues = lessons
    .filter((l) => l.commonIssues.length > 0)
    .slice(0, 3);
  if (lowLessonIssues.length) {
    parts.push('【同类章节高频问题（历史经验）】');
    for (const l of lowLessonIssues) parts.push(`  ${l.dimension ?? '综合'}：${l.commonIssues.join('；')}`);
  }

  if (diag.repetition.hotspots.length) {
    parts.push('【重复片段（避免再次使用）】');
    for (const h of diag.repetition.hotspots) parts.push(`  - ${h}`);
  }

  return parts.join('\n') || '（无具体修正依据）';
}

// ─── 采纳 / 放弃 ─────────────────────────────────────────────────

export interface ApplyCorrectionDraftInput {
  db: DB;
  draftId: string;
  lease: ProjectWriteLease;
  state: StoryState;
  delta: StoryStateDelta;
  model: string;
  promptVersion: string;
  /** When provided, rebuilds from the edited outline position after publication. */
  extractState?: RebuildFromInput['extractState'];
  now?: () => Date;
}

export interface ApplyCorrectionDraftResult {
  chapterNumber: number;
  publish: PublishResult;
  rebuild: RebuildResult | null;
}

/**
 * 采纳修正稿：
 *   1. append correction chapter revision（不 upsert 覆盖）
 *   2. publishHistoricalRevision（失效下游状态，后文 revision 保留）
 *   3. 可选 rebuildFrom
 *   4. 标记 draft adopted + 反哺经验
 */
export async function applyCorrectionDraft(
  input: ApplyCorrectionDraftInput,
): Promise<ApplyCorrectionDraftResult> {
  const draft = getDraft(input.db, input.draftId);
  if (!draft) throw new Error('修正草稿不存在');
  if (draft.status !== 'pending') throw new Error(`草稿状态为 ${draft.status}，无法采纳`);

  const brandedProjectId = projectId(draft.projectId);
  if (input.lease.projectId !== brandedProjectId) {
    throw new Error('Lease project does not match correction draft project');
  }

  const chapters = new ChapterRepository(input.db);
  const states = new StoryStateRepository(input.db);
  const now = input.now ?? (() => new Date());
  const createdAt = now().toISOString();

  const chapter = chapters.getByOutlinePosition(brandedProjectId, draft.chapterNumber);
  if (!chapter) {
    throw new Error(`第 ${draft.chapterNumber} 章不存在，无法采纳修正`);
  }

  const active = chapter.activeRevisionId
    ? chapters.getActiveRevision(chapter.id)
    : null;
  const title = active?.title ?? `第${draft.chapterNumber}章`;

  const candidate = chapters.appendCandidate({
    chapterId: chapter.id,
    revision: {
      id: chapterRevisionId(randomUUID()),
      revisionNumber: chapters.nextRevisionNumber(chapter.id),
      source: 'correction',
      parentRevisionId: chapter.activeRevisionId,
      title,
      content: draft.revisedContent,
      wordCount: countChars(draft.revisedContent),
      status: 'draft',
      generationRunId: null,
      createdAt,
    },
  });

  const previousState = draft.chapterNumber === 1
    ? null
    : states.getCurrentAtPosition(brandedProjectId, draft.chapterNumber - 1);
  if (draft.chapterNumber > 1 && !previousState) {
    throw new Error(
      `Chapter ${draft.chapterNumber} requires the current state from chapter ${draft.chapterNumber - 1}`,
    );
  }

  const publication = new ChapterPublicationService(input.db, now);
  const publish = publication.publishHistoricalRevision({
    lease: input.lease,
    candidateRevisionId: candidate.revision.id,
    previousStateRevisionId: previousState?.id ?? null,
    state: input.state,
    delta: input.delta,
    model: input.model,
    promptVersion: input.promptVersion,
    checkpoint: {
      jobId: input.lease.jobId,
      outlinePosition: draft.chapterNumber,
    },
  });

  let rebuild: RebuildResult | null = null;
  if (input.extractState) {
    const rebuildService = new StateRebuildService(input.db, now);
    rebuild = await rebuildService.rebuildFrom({
      projectId: brandedProjectId,
      fromOutlinePosition: draft.chapterNumber,
      lease: input.lease,
      extractState: input.extractState,
    });
  }

  updateDraftStatus(input.db, input.draftId, 'adopted');
  aggregateLessons(input.db, draft.projectId);

  return {
    chapterNumber: draft.chapterNumber,
    publish,
    rebuild,
  };
}

/** 放弃修正稿：仅标记状态，无副作用 */
export function discardCorrectionDraft(db: DB, draftId: string): void {
  const draft = getDraft(db, draftId);
  if (!draft) throw new Error('修正草稿不存在');
  if (draft.status !== 'pending') throw new Error(`草稿状态为 ${draft.status}，无需放弃`);
  updateDraftStatus(db, draftId, 'discarded');
}
