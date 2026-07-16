import { Hono } from 'hono';
import {
  chapterId,
  ChapterRepository,
  type ChapterRevision,
  type DB,
} from '@novel-eval/writer';

export interface ChapterRevisionDto {
  id: string;
  chapterId: string;
  revisionNumber: number;
  source: ChapterRevision['source'];
  parentRevisionId: string | null;
  title: string;
  content: string;
  wordCount: number;
  status: ChapterRevision['status'];
  generationRunId: string | null;
  createdAt: string;
  active: boolean;
}

function toChapterRevisionDto(
  revision: ChapterRevision,
  activeRevisionId: string | null,
): ChapterRevisionDto {
  return {
    id: revision.id,
    chapterId: revision.chapterId,
    revisionNumber: revision.revisionNumber,
    source: revision.source,
    parentRevisionId: revision.parentRevisionId,
    title: revision.title,
    content: revision.content,
    wordCount: revision.wordCount,
    status: revision.status,
    generationRunId: revision.generationRunId,
    createdAt: revision.createdAt,
    active: revision.id === activeRevisionId,
  };
}

export function revisionRoutes(db: DB) {
  const app = new Hono();
  const chapters = new ChapterRepository(db);

  app.get('/:chapterId/revisions', (c) => {
    const id = chapterId(c.req.param('chapterId'));
    const chapter = chapters.getChapter(id);
    if (!chapter) {
      return c.json({ error: '章节不存在', code: 'NotFound', message: '章节不存在' }, 404);
    }

    const activeRevisionId = chapter.activeRevisionId ?? null;
    const revisions = chapters
      .listRevisions(id)
      .map((revision) => toChapterRevisionDto(revision, activeRevisionId));
    return c.json({
      chapterId: id,
      activeRevisionId,
      revisions,
    });
  });

  return app;
}
