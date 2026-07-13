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
  id: string; title: string; genre: string; audience: string; topic: string;
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

// ─── Job（写作任务 — 暂停/继续/取消）──────────────────────────────

export type JobType = 'bible' | 'outline' | 'chapter';
export type JobStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled';

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
