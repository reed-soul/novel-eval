/**
 * 章节相关数据访问层 — chapter_outline / chapter / narrative_state 三张表的 CRUD
 *
 * generator/finalizer/blueprint 都通过这里读写，保持 SQL 集中。
 */
import { randomUUID } from 'node:crypto';
import type { DB } from '../db.ts';
import type { ChapterOutline, ChapterContent, NarrativeState, OpenForeshadow, ArcSummary } from './types.ts';
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
