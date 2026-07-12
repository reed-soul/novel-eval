/** 叙事状态路由 — GET narrative_state */
import { Hono } from 'hono';
import { getNarrativeState, type DB } from '@novel-eval/writer';

export function narrativeRoutes(db: DB) {
  const app = new Hono();

  app.get('/:id/narrative', (c) => {
    const id = c.req.param('id');
    const state = getNarrativeState(db, id);
    if (!state) return c.json({ error: '叙事状态未初始化' }, 404);
    return c.json(state);
  });

  return app;
}
