/**
 * 章节相关数据访问层 — 遗留读写适配（Task 8 将删除可变路径）
 *
 * 规划读路径已切到 PlanningRepository / story_bible_revision。
 */
import { randomUUID } from 'node:crypto';

import type { DB } from '../db.ts';
import type { Bible, CharacterState, PlotArchitecture } from '../bible/types.ts';
import { projectId } from '../domain/ids.ts';
import { ChapterRepository } from '../repositories/chapter-repository.ts';
import { PlanningRepository } from '../repositories/planning-repository.ts';
import type {
  ChapterContent,
  ChapterOutline,
  NarrativeState,
} from './legacy-types.ts';

// ─── bible（读 active story_bible_revision）──────────────────────

/** 读取 active bible 关键字段（M2 只需要 fullText/characterState/plotArchitecture）*/
export function getBibleForChapter(db: DB, rawProjectId: string): {
  fullText: string;
  characterState: CharacterState;
  plotArchitecture: PlotArchitecture;
} {
  const planning = new PlanningRepository(db);
  const active = planning.getActiveBibleForProject(projectId(rawProjectId));
  if (!active) {
    throw new Error('bible 未完成，无法生成章节。请先运行 write init 完成 bible 生成。');
  }
  const doc = active.bible;
  const fullTextValue = doc.fullText;
  const fullText = typeof fullTextValue === 'string' && fullTextValue.length > 0
    ? fullTextValue
    : active.compiledText;
  const characterState = doc.characterState;
  const plotArchitecture = doc.plotArchitecture;
  if (
    typeof characterState !== 'object'
    || characterState === null
    || Array.isArray(characterState)
    || typeof plotArchitecture !== 'object'
    || plotArchitecture === null
    || Array.isArray(plotArchitecture)
  ) {
    throw new Error('bible 未完成，无法生成章节。请先运行 write init 完成 bible 生成。');
  }
  return {
    fullText,
    characterState: characterState as unknown as CharacterState,
    plotArchitecture: plotArchitecture as unknown as PlotArchitecture,
  };
}

/** @deprecated 角色状态已迁入 story_state_revision；保留抛错以免静默写旧表 */
export function updateCharacterState(_db: DB, _projectId: string, _state: CharacterState): void {
  throw new Error('updateCharacterState was removed; use story state publication instead');
}

// 用 Bible 类型避免未用 import 警告（getBibleForChapter 返回的是 Bible 的子集）
export type { Bible };

// ─── chapter_outline ─────────────────────────────────────────────

export function saveOutlines(_db: DB, _projectId: string, _outlines: Omit<ChapterOutline, 'id' | 'projectId' | 'status'>[]): void {
  throw new Error('saveOutlines was removed; use PlanningRepository.saveApprovedOutline via blueprint generation');
}

export function getOutline(db: DB, rawProjectId: string, number: number): ChapterOutline | null {
  const outlines = new PlanningRepository(db).listOutlinesForCli(projectId(rawProjectId));
  return outlines.find((outline) => outline.number === number) ?? null;
}

export function getAllOutlines(db: DB, rawProjectId: string): ChapterOutline[] {
  return new PlanningRepository(db).listOutlinesForCli(projectId(rawProjectId));
}

export function countOutlines(db: DB, rawProjectId: string): number {
  return new PlanningRepository(db).countOutlines(projectId(rawProjectId));
}

export function markOutlineWritten(db: DB, rawProjectId: string, number: number): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE chapter_outline
    SET status = 'written', updated_at = ?
    WHERE project_id = ? AND position = ?
  `).run(now, rawProjectId, number);
}

// ─── chapter（正文，只读适配新 schema）────────────────────────────

export function saveChapter(
  _db: DB,
  _projectId: string,
  _number: number,
  _opts: { outlineId?: string; title: string; content: string; wordCount: number },
): void {
  throw new Error('saveChapter was removed; use WriterApplication / ChapterPublicationService');
}

export function getChapter(db: DB, rawProjectId: string, number: number): ChapterContent | null {
  const chapters = new ChapterRepository(db);
  const chapter = chapters.getByOutlinePosition(projectId(rawProjectId), number);
  if (!chapter || !chapter.activeRevisionId) return null;
  const active = chapters.getActiveRevision(chapter.id);
  if (!active) return null;
  return {
    id: chapter.id,
    projectId: chapter.projectId,
    number,
    outlineId: chapter.outlineId,
    title: active.title,
    content: active.content,
    wordCount: active.wordCount,
    createdAt: chapter.createdAt,
    updatedAt: active.createdAt,
  };
}

/** 删除章节 — 旧可变路径已移除 */
export function deleteChapter(
  _db: DB,
  _projectId: string,
  _number: number,
): void {
  throw new Error('deleteChapter was removed; use revision publication instead');
}

export function getRecentChapters(
  db: DB,
  rawProjectId: string,
  beforeNumber: number,
  count: number,
): ChapterContent[] {
  const recent = new ChapterRepository(db).listRecentActiveRevisions(
    projectId(rawProjectId),
    beforeNumber,
    count,
  );
  return recent.map((item) => ({
    id: item.revisionId,
    projectId: rawProjectId,
    number: item.position,
    outlineId: '',
    title: item.title,
    content: item.content,
    wordCount: item.content.length,
    createdAt: '',
    updatedAt: '',
  }));
}

export function countChapters(db: DB, rawProjectId: string): number {
  const row: unknown = db.prepare(`
    SELECT COUNT(*) AS n
    FROM chapter c
    WHERE c.project_id = ? AND c.active_revision_id IS NOT NULL
  `).get(rawProjectId);
  if (typeof row !== 'object' || row === null || !('n' in row)) return 0;
  return Number((row as { n: number }).n);
}

// ─── narrative_state（已移除）────────────────────────────────────

export function getNarrativeState(_db: DB, _projectId: string): NarrativeState | null {
  return null;
}

export function saveNarrativeState(_db: DB, _state: NarrativeState): void {
  throw new Error('saveNarrativeState was removed; use story_state_revision ledger');
}

// ─── eval_history（M4：评估数据持久化）─────────────────────────────

export interface EvalHistoryRecord {
  id: string;
  projectId: string;
  chapterNumber: number;
  attempt: number;
  verdict: 'pass' | 'revise' | 'block';
  totalScore: number | null;
  grade: string | null;
  dimensions: Record<string, { score: number; analysis: string }> | null;
  suggestions: Array<{ dimension?: string; content: string }> | null;
  repetition: { within: number; cross: number; hotspots: string[] } | null;
  model: string | null;
  evaluatorModel: string | null;
  createdAt: string;
}

interface EvalHistoryRow {
  id: string; project_id: string; chapter_number: number; attempt: number;
  verdict: string; total_score: number | null; grade: string | null;
  dimensions: string | null; suggestions: string | null; repetition: string | null;
  model: string | null; evaluator_model: string | null; created_at: string;
}

function rowToEvalHistory(row: EvalHistoryRow): EvalHistoryRecord {
  return {
    id: row.id, projectId: row.project_id, chapterNumber: row.chapter_number,
    attempt: row.attempt, verdict: row.verdict as EvalHistoryRecord['verdict'],
    totalScore: row.total_score, grade: row.grade,
    dimensions: row.dimensions ? JSON.parse(row.dimensions) : null,
    suggestions: row.suggestions ? JSON.parse(row.suggestions) : null,
    repetition: row.repetition ? JSON.parse(row.repetition) : null,
    model: row.model, evaluatorModel: row.evaluator_model,
    createdAt: row.created_at,
  };
}

export function saveEvalHistory(db: DB, record: Omit<EvalHistoryRecord, 'id' | 'createdAt'>): void {
  db.prepare(
    `INSERT INTO eval_history (id, project_id, chapter_number, attempt, verdict,
       total_score, grade, dimensions, suggestions, repetition, model, evaluator_model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(), record.projectId, record.chapterNumber, record.attempt, record.verdict,
    record.totalScore, record.grade,
    record.dimensions ? JSON.stringify(record.dimensions) : null,
    record.suggestions ? JSON.stringify(record.suggestions) : null,
    record.repetition ? JSON.stringify(record.repetition) : null,
    record.model, record.evaluatorModel,
    new Date().toISOString(),
  );
}

/** 取某章的全部评估历史（按 attempt 排序）*/
export function getEvalHistory(db: DB, projectId: string, chapterNumber: number): EvalHistoryRecord[] {
  const rows = db.prepare(
    `SELECT * FROM eval_history WHERE project_id = ? AND chapter_number = ? ORDER BY attempt`,
  ).all(projectId, chapterNumber) as EvalHistoryRow[];
  return rows.map(rowToEvalHistory);
}

/** 取项目全部评估历史（用于质量趋势分析）*/
export function getAllEvalHistory(db: DB, projectId: string): EvalHistoryRecord[] {
  const rows = db.prepare(
    `SELECT * FROM eval_history WHERE project_id = ? ORDER BY chapter_number, attempt`,
  ).all(projectId) as EvalHistoryRow[];
  return rows.map(rowToEvalHistory);
}

/** 取每章最终 pass 的分数（用于趋势图）*/
export function getChapterScores(db: DB, projectId: string): Array<{
  chapter: number; score: number; grade: string; model: string | null;
}> {
  const rows = db.prepare(
    `SELECT chapter_number, total_score, grade, model FROM eval_history
     WHERE project_id = ? AND verdict = 'pass'
     ORDER BY chapter_number`,
  ).all(projectId) as Array<{ chapter_number: number; total_score: number; grade: string; model: string | null }>;
  return rows.map((r) => ({ chapter: r.chapter_number, score: r.total_score, grade: r.grade, model: r.model }));
}

// ─── lesson_learned（M4：经验聚合）─────────────────────────────────

export interface LessonLearned {
  id: string;
  projectId: string | null;
  pattern: string;
  dimension: string | null;
  avgScore: number;
  commonIssues: string[];
  effectiveFixes: string[];
  occurrenceCount: number;
  updatedAt: string;
}

interface LessonRow {
  id: string; project_id: string | null; pattern: string; dimension: string | null;
  avg_score: number; common_issues: string | null; effective_fixes: string | null;
  occurrence_count: number; updated_at: string;
}

function rowToLesson(row: LessonRow): LessonLearned {
  return {
    id: row.id, projectId: row.project_id, pattern: row.pattern, dimension: row.dimension,
    avgScore: row.avg_score,
    commonIssues: row.common_issues ? JSON.parse(row.common_issues) : [],
    effectiveFixes: row.effective_fixes ? JSON.parse(row.effective_fixes) : [],
    occurrenceCount: row.occurrence_count, updatedAt: row.updated_at,
  };
}

/** 查询经验（先查项目级，回退全局）*/
export function getLessons(db: DB, projectId: string, pattern?: string): LessonLearned[] {
  const conditions = ['(project_id = ? OR project_id IS NULL)'];
  const params: unknown[] = [projectId];
  if (pattern) { conditions.push('pattern = ?'); params.push(pattern); }
  const rows = db.prepare(
    `SELECT * FROM lesson_learned WHERE ${conditions.join(' AND ')} ORDER BY project_id DESC, avg_score ASC`,
  ).all(...params) as LessonRow[];
  return rows.map(rowToLesson);
}

export function getLessonsByPattern(db: DB, pattern: string, projectId?: string): LessonLearned[] {
  if (projectId) {
    const rows = db.prepare(
      `SELECT * FROM lesson_learned WHERE pattern = ? AND (project_id = ? OR project_id IS NULL)
       ORDER BY project_id DESC`,
    ).all(pattern, projectId) as LessonRow[];
    return rows.map(rowToLesson);
  }
  const rows = db.prepare('SELECT * FROM lesson_learned WHERE pattern = ?').all(pattern) as LessonRow[];
  return rows.map(rowToLesson);
}

/** 插入或更新经验（同 pattern+dimension 合并）*/
export function upsertLesson(db: DB, lesson: {
  projectId: string | null;
  pattern: string;
  dimension: string | null;
  avgScore: number;
  commonIssues: string[];
  effectiveFixes: string[];
}): void {
  const now = new Date().toISOString();
  // 查找现有
  const existing = db.prepare(
    `SELECT id, occurrence_count FROM lesson_learned
     WHERE pattern = ? AND dimension IS ? AND COALESCE(project_id, '') = COALESCE(?, '')`,
  ).get(lesson.pattern, lesson.dimension, lesson.projectId) as { id: string; occurrence_count: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE lesson_learned SET avg_score = ?, common_issues = ?, effective_fixes = ?,
       occurrence_count = ?, updated_at = ? WHERE id = ?`,
    ).run(
      lesson.avgScore,
      JSON.stringify(lesson.commonIssues),
      JSON.stringify(lesson.effectiveFixes),
      existing.occurrence_count + 1, now, existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO lesson_learned (id, project_id, pattern, dimension, avg_score, common_issues, effective_fixes, occurrence_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      randomUUID(), lesson.projectId, lesson.pattern, lesson.dimension,
      lesson.avgScore, JSON.stringify(lesson.commonIssues),
      JSON.stringify(lesson.effectiveFixes), now,
    );
  }
}

// ─── correction_draft（M5：经验驱动局部修正，采纳前原章不动）─────────

export type CorrectionStrategy = 'surgical' | 'rewrite';
export type DraftStatus = 'pending' | 'adopted' | 'discarded';

export interface CorrectionDraft {
  id: string;
  projectId: string;
  chapterNumber: number;
  strategy: CorrectionStrategy;
  originalContent: string;
  revisedContent: string;
  originalScore: number | null;
  revisedScore: number | null;
  /** 诊断出的问题清单（JSON 解析后）*/
  issues: unknown[];
  /** 模型标注的改动点（surgical 才有）*/
  changes: unknown[];
  revisedResult: unknown | null;
  status: DraftStatus;
  engine: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DraftRow {
  id: string; project_id: string; chapter_number: number; strategy: string;
  original_content: string; revised_content: string;
  original_score: number | null; revised_score: number | null;
  issues_json: string | null; changes_json: string | null;
  revised_result_json: string | null;
  status: string; engine: string | null; job_id: string | null;
  created_at: string; updated_at: string;
}

function rowToDraft(row: DraftRow): CorrectionDraft {
  return {
    id: row.id, projectId: row.project_id, chapterNumber: row.chapter_number,
    strategy: row.strategy as CorrectionStrategy,
    originalContent: row.original_content, revisedContent: row.revised_content,
    originalScore: row.original_score, revisedScore: row.revised_score,
    issues: row.issues_json ? JSON.parse(row.issues_json) : [],
    changes: row.changes_json ? JSON.parse(row.changes_json) : [],
    revisedResult: row.revised_result_json ? JSON.parse(row.revised_result_json) : null,
    status: row.status as DraftStatus,
    engine: row.engine, jobId: row.job_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** 保存修正草稿。同一章先前的 pending 自动标 discarded（同一章只留最新 pending）*/
export function saveCorrectionDraft(db: DB, draft: {
  projectId: string;
  chapterNumber: number;
  strategy: CorrectionStrategy;
  originalContent: string;
  revisedContent: string;
  originalScore?: number | null;
  revisedScore?: number | null;
  issues?: unknown[];
  changes?: unknown[];
  revisedResult?: unknown;
  engine?: string | null;
  jobId?: string | null;
}): string {
  const now = new Date().toISOString();
  const id = randomUUID();
  // 先把该章旧的 pending 标 discarded
  db.prepare(
    `UPDATE correction_draft SET status = 'discarded', updated_at = ? 
     WHERE project_id = ? AND chapter_number = ? AND status = 'pending'`,
  ).run(now, draft.projectId, draft.chapterNumber);
  db.prepare(
    `INSERT INTO correction_draft 
       (id, project_id, chapter_number, strategy, original_content, revised_content,
        original_score, revised_score, issues_json, changes_json, revised_result_json, status, engine, job_id,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  ).run(
    id, draft.projectId, draft.chapterNumber, draft.strategy,
    draft.originalContent, draft.revisedContent,
    draft.originalScore ?? null, draft.revisedScore ?? null,
    JSON.stringify(draft.issues ?? []), JSON.stringify(draft.changes ?? []),
    draft.revisedResult ? JSON.stringify(draft.revisedResult) : null,
    draft.engine ?? null, draft.jobId ?? null,
    now, now,
  );
  return id;
}

/** 取某章最新的 pending 草稿（无则 null）*/
export function getPendingDraft(db: DB, projectId: string, chapterNumber: number): CorrectionDraft | null {
  const row = db.prepare(
    `SELECT * FROM correction_draft 
     WHERE project_id = ? AND chapter_number = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
  ).get(projectId, chapterNumber) as DraftRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function getDraft(db: DB, draftId: string): CorrectionDraft | null {
  const row = db.prepare('SELECT * FROM correction_draft WHERE id = ?').get(draftId) as DraftRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function updateDraftStatus(db: DB, draftId: string, status: DraftStatus): void {
  db.prepare('UPDATE correction_draft SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), draftId);
}
