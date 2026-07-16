/**
 * 章节相关数据访问层 — chapter_outline / chapter / narrative_state 三张表的 CRUD
 *
 * generator/finalizer/blueprint 都通过这里读写，保持 SQL 集中。
 */
import { randomUUID } from 'node:crypto';
import type { DB } from '../db.ts';
import type {
  ArcSummary,
  ChapterContent,
  ChapterOutline,
  NarrativeState,
  OpenForeshadow,
} from './legacy-types.ts';
import type { Bible, CharacterState, PlotArchitecture } from '../bible/types.ts';

// ─── bible（读 M1 产物）──────────────────────────────────────────

interface BibleRow {
  project_id: string; full_text: string | null; character_state: string | null;
  plot_architecture: string | null;
}

/** 读取 M1 生成的 bible 关键字段（M2 只需要 fullText/characterState/plotArchitecture）*/
export function getBibleForChapter(db: DB, projectId: string): {
  fullText: string;
  characterState: CharacterState;
  plotArchitecture: PlotArchitecture;
} {
  const row = db.prepare('SELECT full_text, character_state, plot_architecture FROM bible WHERE project_id = ?')
    .get(projectId) as BibleRow | undefined;
  if (!row || !row.full_text || !row.character_state || !row.plot_architecture) {
    throw new Error('bible 未完成，无法生成章节。请先运行 write init 完成 bible 生成。');
  }
  return {
    fullText: row.full_text,
    characterState: JSON.parse(row.character_state) as CharacterState,
    plotArchitecture: JSON.parse(row.plot_architecture) as PlotArchitecture,
  };
}

/** 覆盖更新 character_state（finalizer 每章调用）*/
export function updateCharacterState(db: DB, projectId: string, state: CharacterState): void {
  const now = new Date().toISOString();
  db.prepare('UPDATE bible SET character_state = ?, updated_at = ? WHERE project_id = ?')
    .run(JSON.stringify(state), now, projectId);
}

// 用 Bible 类型避免未用 import 警告（getBibleForChapter 返回的是 Bible 的子集）
export type { Bible };

// ─── chapter_outline ─────────────────────────────────────────────

interface OutlineRow {
  id: string; project_id: string; number: number; title: string | null;
  act: number; beat: string | null; role: string | null; purpose: string | null;
  suspense_level: number | null; foreshadowing: string | null;
  twist_level: number | null; summary: string | null; status: string;
  created_at: string; updated_at: string;
}

function rowToOutline(row: OutlineRow): ChapterOutline {
  return {
    id: row.id, projectId: row.project_id, number: row.number,
    title: row.title ?? '', act: row.act as 1 | 2 | 3, beat: row.beat ?? '',
    role: row.role ?? '', purpose: row.purpose ?? '',
    suspenseLevel: row.suspense_level ?? 5,
    foreshadowing: row.foreshadowing ?? '',
    twistLevel: row.twist_level ?? 0,
    summary: row.summary ?? '', status: row.status as 'pending' | 'written',
  };
}

export function saveOutlines(db: DB, projectId: string, outlines: Omit<ChapterOutline, 'id' | 'projectId' | 'status'>[]): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO chapter_outline (id, project_id, number, title, act, beat, role, purpose,
       suspense_level, foreshadowing, twist_level, summary, status, created_at, updated_at)
     VALUES (@id, @project_id, @number, @title, @act, @beat, @role, @purpose,
       @suspense_level, @foreshadowing, @twist_level, @summary, 'pending', @ts, @ts)`,
  );
  const tx = db.transaction((items: typeof outlines) => {
    for (const o of items) {
      stmt.run({
        id: randomUUID(), project_id: projectId, number: o.number, title: o.title,
        act: o.act, beat: o.beat, role: o.role, purpose: o.purpose,
        suspense_level: o.suspenseLevel, foreshadowing: o.foreshadowing,
        twist_level: o.twistLevel, summary: o.summary, ts: now,
      });
    }
  });
  tx(outlines);
}

export function getOutline(db: DB, projectId: string, number: number): ChapterOutline | null {
  const row = db.prepare('SELECT * FROM chapter_outline WHERE project_id = ? AND number = ?')
    .get(projectId, number) as OutlineRow | undefined;
  return row ? rowToOutline(row) : null;
}

export function getAllOutlines(db: DB, projectId: string): ChapterOutline[] {
  const rows = db.prepare('SELECT * FROM chapter_outline WHERE project_id = ? ORDER BY number')
    .all(projectId) as OutlineRow[];
  return rows.map(rowToOutline);
}

export function countOutlines(db: DB, projectId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM chapter_outline WHERE project_id = ?')
    .get(projectId) as { n: number };
  return row.n;
}

export function markOutlineWritten(db: DB, projectId: string, number: number): void {
  db.prepare('UPDATE chapter_outline SET status = ?, updated_at = ? WHERE project_id = ? AND number = ?')
    .run('written', new Date().toISOString(), projectId, number);
}

// ─── chapter（正文）──────────────────────────────────────────────

interface ChapterRow {
  id: string; project_id: string; number: number; outline_id: string | null;
  title: string | null; content: string; word_count: number | null;
  created_at: string; updated_at: string;
}

export function saveChapter(
  db: DB, projectId: string, number: number,
  opts: { outlineId?: string; title: string; content: string; wordCount: number },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chapter (id, project_id, number, outline_id, title, content, word_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, number) DO UPDATE SET
       title = excluded.title, content = excluded.content,
       word_count = excluded.word_count, updated_at = excluded.updated_at`,
  ).run(randomUUID(), projectId, number, opts.outlineId ?? null, opts.title, opts.content, opts.wordCount, now, now);
}

export function getChapter(db: DB, projectId: string, number: number): ChapterContent | null {
  const row = db.prepare('SELECT * FROM chapter WHERE project_id = ? AND number = ?')
    .get(projectId, number) as ChapterRow | undefined;
  if (!row) return null;
  return {
    id: row.id, projectId: row.project_id, number: row.number,
    outlineId: row.outline_id ?? '', title: row.title ?? '', content: row.content,
    wordCount: row.word_count ?? 0, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** 删除章节（revise 重写前调用，清除 checkpoint）*/
export function deleteChapter(db: DB, projectId: string, number: number): void {
  db.prepare('DELETE FROM chapter WHERE project_id = ? AND number = ?').run(projectId, number);
  // 重置 outline 状态为 pending
  db.prepare('UPDATE chapter_outline SET status = ? WHERE project_id = ? AND number = ?')
    .run('pending', projectId, number);
}

export function getRecentChapters(db: DB, projectId: string, beforeNumber: number, count: number): ChapterContent[] {
  const rows = db.prepare(
    `SELECT * FROM chapter WHERE project_id = ? AND number < ? ORDER BY number DESC LIMIT ?`,
  ).all(projectId, beforeNumber, count) as ChapterRow[];
  // DB 取的是倒序（最近的在前），这里反转为正序（时间先后）
  return rows.reverse().map((row) => ({
    id: row.id, projectId: row.project_id, number: row.number,
    outlineId: row.outline_id ?? '', title: row.title ?? '', content: row.content,
    wordCount: row.word_count ?? 0, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export function countChapters(db: DB, projectId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM chapter WHERE project_id = ?')
    .get(projectId) as { n: number };
  return row.n;
}

// ─── narrative_state ─────────────────────────────────────────────

interface NarrativeRow {
  project_id: string; macro_summary: string | null;
  open_foreshadows: string | null; arc_summaries: string | null;
  up_to_chapter: number; updated_at: string;
}

export function getNarrativeState(db: DB, projectId: string): NarrativeState | null {
  const row = db.prepare('SELECT * FROM narrative_state WHERE project_id = ?')
    .get(projectId) as NarrativeRow | undefined;
  if (!row) return null;
  return {
    projectId: row.project_id,
    macroSummary: row.macro_summary ?? '',
    openForeshadows: row.open_foreshadows ? JSON.parse(row.open_foreshadows) as OpenForeshadow[] : [],
    arcSummaries: row.arc_summaries ? JSON.parse(row.arc_summaries) as ArcSummary[] : [],
    upToChapter: row.up_to_chapter,
    updatedAt: row.updated_at,
  };
}

export function saveNarrativeState(db: DB, state: NarrativeState): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO narrative_state (project_id, macro_summary, open_foreshadows, arc_summaries, up_to_chapter, updated_at)
     VALUES (@project_id, @macro_summary, @open_foreshadows, @arc_summaries, @up_to_chapter, @updated_at)
     ON CONFLICT(project_id) DO UPDATE SET
       macro_summary = excluded.macro_summary,
       open_foreshadows = excluded.open_foreshadows,
       arc_summaries = excluded.arc_summaries,
       up_to_chapter = excluded.up_to_chapter,
       updated_at = excluded.updated_at`,
  ).run({
    project_id: state.projectId,
    macro_summary: state.macroSummary,
    open_foreshadows: JSON.stringify(state.openForeshadows),
    arc_summaries: JSON.stringify(state.arcSummaries),
    up_to_chapter: state.upToChapter,
    updated_at: now,
  });
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
