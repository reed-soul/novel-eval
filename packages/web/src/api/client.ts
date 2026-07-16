/** API 客户端封装 */
import type {
  EvaluationReportResponse,
  JobStatusResponse,
  EditChapterRequest,
  GenerateChaptersRequest,
  StoryStateDto,
  StoryStateDeltaDto,
} from '@novel-eval/shared';

export type {
  EvaluationReportResponse,
  JobStatusResponse,
  EditChapterRequest,
  GenerateChaptersRequest,
  StoryStateDto,
  StoryStateDeltaDto,
};

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

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
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
  number: number; title: string; chapterId: string | null; act: number; beat: string;
  outlineStatus: string; wordCount: number; written: boolean;
  activeRevisionId?: string | null;
  suspenseLevel: number; twistLevel: number;
}

export interface ChapterDetail {
  number: number; title: string; chapterId: string | null;
  outline: { act: number; beat: string; role: string; purpose: string;
    suspenseLevel: number; foreshadowing: string; twistLevel: number; summary: string; };
  content: string | null; wordCount: number; written: boolean;
  activeRevisionId?: string | null;
  hasNext: boolean; hasPrev: boolean;
}

export interface StoryStateRevision {
  storyStateRevisionId: string;
  projectId: string;
  chapterId: string;
  chapterRevisionId: string;
  previousStateRevisionId: string | null;
  outlinePosition: number;
  status: 'current' | 'stale' | 'failed';
  state: StoryStateDto;
  delta: StoryStateDeltaDto;
  summary: string;
  model: string;
  promptVersion: string;
  createdAt: string;
}

export interface StoryStateResponse {
  projectId: string;
  latestWrittenOutlinePosition: number | null;
  current: StoryStateRevision | null;
  currentStates: StoryStateRevision[];
}

export interface StaleImpactResponse {
  projectId: string;
  fromOutlinePosition: number;
  affectedOutlinePositions: number[];
}

export interface RebuildStoryStateRequest {
  fromOutlinePosition?: number;
  engineName?: string;
  model?: string;
}

export interface RebuildStoryStateResponse {
  projectId: string;
  fromOutlinePosition: number;
  latestWrittenOutlinePosition: number | null;
  rebuiltOutlinePositions: number[];
  failedAtOutlinePosition: number | null;
  currentStateRevisionId: string | null;
  currentStates: StoryStateRevision[];
}

export interface ChapterRevision {
  id: string;
  chapterId: string;
  revisionNumber: number;
  source: 'generated' | 'manual' | 'correction' | 'import';
  parentRevisionId: string | null;
  title: string;
  content: string;
  wordCount: number;
  status: 'draft' | 'published' | 'rejected';
  generationRunId: string | null;
  createdAt: string;
  active: boolean;
}

export interface ChapterRevisionsResponse {
  chapterId: string;
  activeRevisionId: string | null;
  revisions: ChapterRevision[];
}

export async function getStoryState(projectId: string): Promise<StoryStateResponse> {
  return api<StoryStateResponse>(`/projects/${projectId}/story-state`);
}

export async function getStaleImpact(
  projectId: string,
  fromOutlinePosition?: number,
): Promise<StaleImpactResponse> {
  const q = fromOutlinePosition === undefined
    ? ''
    : `?fromOutlinePosition=${encodeURIComponent(String(fromOutlinePosition))}`;
  return api<StaleImpactResponse>(`/projects/${projectId}/stale-impact${q}`);
}

export async function rebuildStoryState(
  projectId: string,
  request: RebuildStoryStateRequest = {},
): Promise<RebuildStoryStateResponse> {
  return apiPost<RebuildStoryStateResponse>(`/projects/${projectId}/rebuilds`, request);
}

export async function getChapterRevisions(chapterId: string): Promise<ChapterRevisionsResponse> {
  return api<ChapterRevisionsResponse>(`/chapters/${chapterId}/revisions`);
}

export interface EditChapterExtractResponse {
  number: number;
  wordCount: number;
  saved: boolean;
  chapterRevisionId: string;
  storyStateRevisionId: string;
  staleImpact: { affectedOutlinePositions: number[] };
}

export async function editChapterWithExtract(
  projectId: string,
  chapterNumber: number,
  input: { content: string; title?: string },
): Promise<EditChapterExtractResponse> {
  return apiPut<EditChapterExtractResponse>(`/projects/${projectId}/chapters/${chapterNumber}`, {
    ...input,
    extract: true,
  });
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
  revisionId?: string;
  revisionNumber?: number;
  status?: 'draft' | 'approved' | 'superseded';
}

export interface OutlineListItem {
  id: string;
  number: number;
  title: string;
  status: string;
  revisionId?: string | null;
  revisionStatus?: string | null;
}

export interface OutlinesResponse {
  outlines: OutlineListItem[];
  total: number;
}

export async function approveBibleRevision(projectId: string, revisionId: string): Promise<void> {
  await apiPost(`/projects/${projectId}/bible-revisions/${revisionId}/approve`);
}

export async function getProjectOutlines(projectId: string): Promise<OutlinesResponse> {
  return api<OutlinesResponse>(`/projects/${projectId}/outlines`);
}

export async function approveOutlines(projectId: string, from: number, to: number): Promise<void> {
  await apiPost(`/projects/${projectId}/outlines/approve`, { from, to });
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

export type JobType = JobStatusResponse['type'];
export type JobStatus = JobStatusResponse['status'];

/** @deprecated Prefer JobStatusResponse from shared DTOs */
export type JobInfo = JobStatusResponse;

export interface ActiveJobResponse {
  job: (JobStatusResponse & {
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

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  return api<JobStatusResponse>(`/projects/jobs/${jobId}`);
}

export async function getEvaluationReport(taskId: string): Promise<EvaluationReportResponse> {
  return api<EvaluationReportResponse>(`/eval/${taskId}/result`);
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
  return apiPost<{ ok: boolean; chapterNumber: number }>(`/projects/${projectId}/corrections/${draftId}/adopt`, {
    extract: true,
  });
}

export async function discardCorrection(projectId: string, draftId: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/projects/${projectId}/corrections/${draftId}/discard`);
}
