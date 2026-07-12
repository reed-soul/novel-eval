/** Bible 路由 — GET bible 设定 */
import { Hono } from 'hono';
import { getBibleForChapter, type DB } from '@novel-eval/writer';
import type { CharacterState, PlotArchitecture } from '@novel-eval/writer';

export function bibleRoutes(db: DB) {
  const app = new Hono();

  app.get('/:id/bible', (c) => {
    const id = c.req.param('id');
    try {
      const { fullText, characterState, plotArchitecture } = getBibleForChapter(db, id);
      return c.json({ fullText, characterState, plotArchitecture });
    } catch {
      return c.json({ error: 'bible 未完成' }, 404);
    }
  });

  // 直接读 bible 表的全部 JSON 字段（含 character_dynamics/world_building 等）
  app.get('/:id/bible/raw', (c) => {
    const id = c.req.param('id');
    const row = db.prepare(
      'SELECT core_seed, character_dynamics, character_state, world_building, plot_architecture, full_text FROM bible WHERE project_id = ?',
    ).get(id) as Record<string, string | null> | undefined;
    if (!row) return c.json({ error: 'bible 不存在' }, 404);
    const parse = (v: string | null) => v ? JSON.parse(v) : null;
    return c.json({
      coreSeed: parse(row.core_seed),
      characterDynamics: parse(row.character_dynamics),
      characterState: parse(row.character_state) as CharacterState | null,
      worldBuilding: parse(row.world_building),
      plotArchitecture: parse(row.plot_architecture) as PlotArchitecture | null,
      fullText: row.full_text,
    });
  });

  return app;
}
