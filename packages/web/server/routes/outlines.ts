/** 蓝图路由 — GET 全部章节蓝图 */
import { Hono } from 'hono';
import { getAllOutlines, countOutlines, type DB } from '@novel-eval/writer';

export function outlineRoutes(db: DB) {
  const app = new Hono();

  app.get('/:id/outlines', (c) => {
    const id = c.req.param('id');
    const outlines = getAllOutlines(db, id);
    if (outlines.length === 0) return c.json({ error: '蓝图未生成' }, 404);
    // 按幕分组统计
    const byAct = { 1: 0, 2: 0, 3: 0 };
    for (const o of outlines) byAct[o.act as 1 | 2 | 3]++;
    return c.json({ outlines, total: outlines.length, byAct });
  });

  return app;
}
