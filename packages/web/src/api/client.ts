/** API 客户端封装 */
const BASE = '/api';

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
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
