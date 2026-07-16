/** @internal Temporary types for the mutable chapter pipeline pending removal. */

export type BeatPosition = '铺垫' | '推进' | '转折' | '高潮';

export interface Beat {
  position: BeatPosition;
  goal: string;
  foreshadows: string[];
  tension: number;
}

export interface ChapterOutline {
  id: string;
  projectId: string;
  number: number;
  title: string;
  act: 1 | 2 | 3;
  beat: string;
  role: string;
  purpose: string;
  suspenseLevel: number;
  foreshadowing: string;
  twistLevel: number;
  summary: string;
  status: 'pending' | 'written';
}

export interface ChapterContent {
  id: string;
  projectId: string;
  number: number;
  outlineId: string;
  title: string;
  content: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArcSummary {
  upToChapter: number;
  content: string;
}

export interface OpenForeshadow {
  description: string;
  setupChapter: number;
  resolveChapter: number | null;
}

export interface NarrativeState {
  projectId: string;
  macroSummary: string;
  openForeshadows: OpenForeshadow[];
  arcSummaries: ArcSummary[];
  upToChapter: number;
  updatedAt: string;
}
