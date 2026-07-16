import type {
  ChapterId,
  ChapterRevisionId,
  OutlineId,
  ProjectId,
} from './ids.ts';

export type ChapterRevisionSource = 'generated' | 'manual' | 'correction' | 'import';
export type ChapterRevisionStatus = 'draft' | 'published' | 'rejected';

export interface Chapter {
  id: ChapterId;
  projectId: ProjectId;
  outlineId: OutlineId;
  activeRevisionId: ChapterRevisionId | null;
  createdAt: string;
}

export interface ChapterRevision {
  id: ChapterRevisionId;
  chapterId: ChapterId;
  revisionNumber: number;
  source: ChapterRevisionSource;
  parentRevisionId: ChapterRevisionId | null;
  title: string;
  content: string;
  wordCount: number;
  status: ChapterRevisionStatus;
  generationRunId: string | null;
  createdAt: string;
}

export interface ChapterCandidate {
  chapter: Chapter;
  revision: ChapterRevision;
}

export interface SaveChapterCandidateInput {
  chapter: Omit<Chapter, 'activeRevisionId'>;
  revision: Omit<ChapterRevision, 'chapterId'>;
}
