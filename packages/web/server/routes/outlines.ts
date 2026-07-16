/** 蓝图路由 — GET 全部章节蓝图 */
import { Hono } from 'hono';
import { getAllOutlines, projectId, WriterApplication, type DB } from '@novel-eval/writer';
import { httpErrorJson, toHttpError } from '../middleware/error-mapper.ts';

export function outlineRoutes(db: DB) {
  const app = new Hono();
  const writer = new WriterApplication(db, { defaultOwnerId: 'web' });

  app.get('/:id/outlines', (c) => {
    const id = c.req.param('id');
    const outlines = getAllOutlines(db, id);
    if (outlines.length === 0) return c.json({ error: '蓝图未生成' }, 404);
    // 按幕分组统计
    const byAct = { 1: 0, 2: 0, 3: 0 };
    for (const o of outlines) byAct[o.act as 1 | 2 | 3]++;
    return c.json({ outlines, total: outlines.length, byAct });
  });

  app.post('/:id/outlines/approve', async (c) => {
    const id = projectId(c.req.param('id'));
    const body = await c.req.json<{ from?: number; to?: number }>()
      .catch(() => ({} as { from?: number; to?: number }));
    const outlines = getAllOutlines(db, id);
    const from = body.from ?? 1;
    const to = body.to ?? outlines.length;
    try {
      const result = writer.approveOutlines({
        projectId: id,
        from,
        to,
        ownerId: 'web',
      });
      return c.json({
        approved: result.outlines.length,
        outlines: result.outlines.map((outline) => ({
          id: outline.outline.id,
          position: outline.outline.position,
          status: outline.outline.status,
          revisionId: outline.revision.id,
          revisionStatus: outline.revision.status,
        })),
      });
    } catch (error: unknown) {
      const mapped = toHttpError(error);
      return c.json(httpErrorJson(mapped), mapped.status as 400 | 402 | 409 | 422 | 500);
    }
  });

  return app;
}
