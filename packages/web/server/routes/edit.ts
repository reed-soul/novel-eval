/**
 * 编辑路由 — PUT 章节正文
 *
 * 端点：
 *   PUT /api/projects/:id/chapters/:n  body: {content}
 */
import { Hono } from 'hono';
import { saveChapter, getOutline, type DB } from '@novel-eval/writer';
import { countChars } from '@novel-eval/shared';

export function editRoutes(db: DB) {
  const app = new Hono();

  app.put('/:id/chapters/:n', async (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    const body = await c.req.json<{ content: string }>();

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: '正文不能为空' }, 400);
    }

    const outline = getOutline(db, id, n);
    if (!outline) return c.json({ error: '蓝图不存在' }, 404);

    const wordCount = countChars(body.content);
    saveChapter(db, id, n, {
      outlineId: outline.id,
      title: outline.title,
      content: body.content,
      wordCount,
    });

    return c.json({ number: n, wordCount, saved: true });
  });

  return app;
}
