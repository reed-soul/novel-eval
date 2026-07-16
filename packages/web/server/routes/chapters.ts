/** 章节路由 — GET 章节列表 / GET 单章正文（仅 active published revision） */
import { Hono } from 'hono';
import {
  getAllOutlines,
  getChapter,
  countChapters,
  ChapterRepository,
  projectId,
  type DB,
} from '@novel-eval/writer';

export function chapterRoutes(db: DB) {
  const app = new Hono();
  const chapters = new ChapterRepository(db);

  // 章节列表（含蓝图状态和字数，不含正文）
  app.get('/:id/chapters', (c) => {
    const id = c.req.param('id');
    const branded = projectId(id);
    const outlines = getAllOutlines(db, id);
    const rows = outlines.map((o) => {
      const ch = getChapter(db, id, o.number);
      const entity = chapters.getByOutlinePosition(branded, o.number);
      const activeRevisionId = entity?.activeRevisionId ?? null;
      return {
        number: o.number,
        title: ch?.title ?? o.title,
        act: o.act,
        beat: o.beat,
        outlineStatus: o.status,
        wordCount: ch?.wordCount ?? 0,
        written: !!ch,
        activeRevisionId,
        suspenseLevel: o.suspenseLevel,
        twistLevel: o.twistLevel,
      };
    });
    return c.json({ chapters: rows, total: rows.length, written: countChapters(db, id) });
  });

  // 单章正文 + 蓝图（仅 active published）
  app.get('/:id/chapters/:n', (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    const ch = getChapter(db, id, n);
    const outlines = getAllOutlines(db, id);
    const outline = outlines.find((o) => o.number === n);
    if (!outline) return c.json({ error: '蓝图不存在' }, 404);
    const entity = chapters.getByOutlinePosition(projectId(id), n);
    return c.json({
      number: n,
      title: ch?.title ?? outline.title,
      outline: {
        act: outline.act, beat: outline.beat, role: outline.role,
        purpose: outline.purpose, suspenseLevel: outline.suspenseLevel,
        foreshadowing: outline.foreshadowing, twistLevel: outline.twistLevel,
        summary: outline.summary,
      },
      content: ch?.content ?? null,
      wordCount: ch?.wordCount ?? 0,
      written: !!ch,
      activeRevisionId: entity?.activeRevisionId ?? null,
      hasNext: outlines.some((o) => o.number === n + 1),
      hasPrev: n > 1,
    });
  });

  return app;
}
