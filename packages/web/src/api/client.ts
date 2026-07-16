/** API 客户端封装 */
const BASE = '/api';

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// 类型定义（与后端对齐）
export interface Project {
  id: string; title: string; genreProfile: string; targetAudience: string; premise: string;
  status: string; createdAt: string; updatedAt: string;
  outlineCount?: number; chapterCount?: number;
  lastChapter?: { number: number; title: string; wordCount: number } | null;
}

export interface ChapterListItem {
  number: number; title: string; act: number; beat: string;
  outlineStatus: string; wordCount: number; written: boolean;
  suspenseLevel: number; twistLevel: number;
}

export interface ChapterDetail {
  number: number; title: string;
  outline: { act: number; beat: string; role: string; purpose: string;
    suspenseLevel: number; foreshadowing: string; twistLevel: number; summary: string; };
  content: string | null; wordCount: number; written: boolean;
  hasNext: boolean; hasPrev: boolean;
}

export interface NarrativeState {
  projectId: string; macroSummary: string;
  openForeshadows: Array<{ description: string; setupChapter: number; resolveChapter: number | null }>;
  arcSummaries: Array<{ upToChapter: number; content: string }>;
  upToChapter: number; updatedAt: string;
}

export interface BibleRaw {
  coreSeed: { premise: string } | null;
  characterDynamics: { characters: unknown[] } | null;
  characterState: { characters: Array<{ name: string; items: string[]; abilities: string[]; status: string; relationships: string[]; events: string[] }> } | null;
  worldBuilding: unknown | null;
  plotArchitecture: { act1: unknown; act2: unknown; act3: unknown; foreshadows: unknown[] } | null;
  fullText: string | null;
}

// ─── 引擎配置 ─────────────────────────────────────────────────────

export interface EngineInfo {
  name: string;
  provider: 'bigmodel' | 'deepseek';
  model: string;
  hasKey: boolean;
}

export interface EngineConfigResponse {
  engines: EngineInfo[];
  active: string;
}

// ─── 评估历史 ─────────────────────────────────────────────────────

export interface ChapterScore {
  chapter: number;
  score: number;
  grade: string;
  model: string | null;
}

export interface LessonItem {
  pattern: string;
  dimension: string | null;
  avgScore: number;
  commonIssues: string[];
  effectiveFixes: string[];
  occurrenceCount: number;
}

// ─── 单章评估详情（ChapterReader 质量速览用）──────────────────────

export interface EvalDimension {
  score: number;
  subscores?: Record<string, number>;
  analysis: string;
}

export interface EvalHistoryRecord {
  id: string;
  chapterNumber: number;
  attempt: number;
  verdict: 'pass' | 'revise' | 'block';
  totalScore: number | null;
  grade: string | null;
  dimensions: Record<string, EvalDimension> | null;
  suggestions: Array<{ dimension?: string; content: string }> | null;
  repetition: { within: number; cross: number; hotspots: string[] } | null;
  model: string | null;
  evaluatorModel: string | null;
  createdAt: string;
}

export async function getChapterEval(projectId: string, chapterNumber: number): Promise<{ chapter: number; history: EvalHistoryRecord[] }> {
  return api(`/projects/${projectId}/eval/${chapterNumber}`);
}

export async function getLessons(projectId: string, pattern?: string): Promise<{ lessons: LessonItem[] }> {
  const q = pattern ? `?pattern=${encodeURIComponent(pattern)}` : '';
  return api(`/projects/${projectId}/lessons${q}`);
}

// ─── 单章诊断（只读：本章得分+重复检测+推荐策略，零 LLM）─────────

export interface DiagnosisIssue {
  dimension: string;
  dimensionLabel: string;
  score: number;
  type: CorrectionStrategy;
  lessonRef: string | null;
}

export interface ChapterDiagnosis {
  strategy: CorrectionStrategy;
  issues: DiagnosisIssue[];
  repetition: { within: number; cross: number; hotspots: string[]; verdict: string };
  pattern: string;
}

export async function diagnoseChapter(projectId: string, chapterNumber: number): Promise<{ diagnose: ChapterDiagnosis }> {
  return api(`/projects/${projectId}/chapters/${chapterNumber}/diagnose`);
}

// ─── Job（写作任务 — 暂停/继续/取消）──────────────────────────────

export type JobType = 'bible' | 'outline' | 'chapter' | 'correction';
export type JobStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface JobInfo {
  id: string;
  type: JobType;
  projectId: string;
  status: JobStatus;
  events?: number;
  lastChapter?: number;
  fromChapter?: number;
  toChapter?: number;
  result?: unknown;
  error?: string | null;
}

export interface ActiveJobResponse {
  job: (JobInfo & {
    fromChapter: number | null;
    toChapter: number | null;
    qualityGate: boolean;
    maxRevise: number;
    lastChapter: number;
    createdAt: string;
    updatedAt: string;
  }) | null;
}

export async function getActiveJob(projectId: string): Promise<ActiveJobResponse> {
  return api<ActiveJobResponse>(`/projects/${projectId}/active-job`);
}

export async function pauseJob(jobId: string): Promise<void> {
  await apiPost(`/projects/jobs/${jobId}/pause`);
}

export async function resumeJob(jobId: string): Promise<{ jobId: string }> {
  return apiPost<{ jobId: string }>(`/projects/jobs/${jobId}/resume`);
}

export async function cancelJob(jobId: string): Promise<void> {
  await apiPost(`/projects/jobs/${jobId}/cancel`);
}

export async function getJobStatus(jobId: string): Promise<JobInfo> {
  return api<JobInfo>(`/projects/jobs/${jobId}`);
}

// ─── 经验驱动的局部修正（M5）──────────────────────────────────────

export type CorrectionStrategy = 'surgical' | 'rewrite';

export interface CorrectionIssue {
  dimension: string;
  dimensionLabel: string;
  score: number;
  type: CorrectionStrategy;
  lessonRef: string | null;
}

export interface CorrectionChange {
  original: string;
  revised: string;
  reason: string;
}

export interface CorrectionDraft {
  id: string;
  projectId: string;
  chapterNumber: number;
  strategy: CorrectionStrategy;
  originalContent: string;
  revisedContent: string;
  originalScore: number | null;
  revisedScore: number | null;
  issues: CorrectionIssue[];
  changes: CorrectionChange[];
  revisedResult?: {
    grade: string | null;
    dimensions: Record<string, EvalDimension> | null;
    suggestions: Array<{ dimension?: string; content: string }> | null;
    repetition: { within: number; cross: number; hotspots: string[] } | null;
  } | null;
  status: 'pending' | 'adopted' | 'discarded';
  engine: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 触发单章修正，返回 jobId（进度走现有 SSE）*/
export async function correctChapter(
  projectId: string,
  chapterNumber: number,
  opts?: { engineName?: string; model?: string; strategy?: CorrectionStrategy },
): Promise<{ jobId: string }> {
  return apiPost<{ jobId: string }>(`/projects/${projectId}/chapters/${chapterNumber}/correct`, opts);
}

/** 取某章最新 pending 草稿（diff 预览用）*/
export async function getPendingCorrection(
  projectId: string,
  chapterNumber: number,
): Promise<{ draft: CorrectionDraft | null }> {
  return api<{ draft: CorrectionDraft | null }>(`/projects/${projectId}/chapters/${chapterNumber}/correction`);
}

export async function adoptCorrection(projectId: string, draftId: string): Promise<{ ok: boolean; chapterNumber: number }> {
  return apiPost<{ ok: boolean; chapterNumber: number }>(`/projects/${projectId}/corrections/${draftId}/adopt`);
}

export async function discardCorrection(projectId: string, draftId: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/projects/${projectId}/corrections/${draftId}/discard`);
}
