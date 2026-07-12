/** 章节路由 — GET 章节列表 / GET 单章正文 */
import { Hono } from 'hono';
import { getAllOutlines, getChapter, countChapters, type DB } from '@novel-eval/writer';

export function chapterRoutes(db: DB) {
  const app = new Hono();

  // 章节列表（含蓝图状态和字数，不含正文）
  app.get('/:id/chapters', (c) => {
    const id = c.req.param('id');
    const outlines = getAllOutlines(db, id);
    const chapters = outlines.map((o) => {
      const ch = getChapter(db, id, o.number);
      return {
        number: o.number,
        title: o.title,
        act: o.act,
        beat: o.beat,
        outlineStatus: o.status,
        wordCount: ch?.wordCount ?? 0,
        written: !!ch,
        suspenseLevel: o.suspenseLevel,
        twistLevel: o.twistLevel,
      };
    });
    return c.json({ chapters, total: chapters.length, written: countChapters(db, id) });
  });

  // 单章正文 + 蓝图
  app.get('/:id/chapters/:n', (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    const ch = getChapter(db, id, n);
    const outlines = getAllOutlines(db, id);
    const outline = outlines.find((o) => o.number === n);
    if (!outline) return c.json({ error: '蓝图不存在' }, 404);
    return c.json({
      number: n,
      title: outline.title,
      outline: {
        act: outline.act, beat: outline.beat, role: outline.role,
        purpose: outline.purpose, suspenseLevel: outline.suspenseLevel,
        foreshadowing: outline.foreshadowing, twistLevel: outline.twistLevel,
        summary: outline.summary,
      },
      content: ch?.content ?? null,
      wordCount: ch?.wordCount ?? 0,
      written: !!ch,
      hasNext: outlines.some((o) => o.number === n + 1),
      hasPrev: n > 1,
    });
  });

  return app;
}
