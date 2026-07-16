/**
 * 评估历史路由 — 质量趋势 + 评估详情 + 经验学习
 *
 * 端点：
 *   GET /api/projects/:id/scores       每章 pass 分数（趋势图用）
 *   GET /api/projects/:id/eval/:n      某章的评估历史（多轮 attempt）
 *   GET /api/projects/:id/lessons      经验学习表内容
 */
import { Hono } from 'hono';
import type { DB } from '@novel-eval/writer';
import {
  getChapterScores, getEvalHistory, getLessons,
} from '@novel-eval/writer';

export function evalRoutes(db: DB) {
  const app = new Hono();

  // 每章 pass 分数（趋势图 X=章节号 Y=分数）
  app.get('/:id/scores', (c) => {
    const id = c.req.param('id');
    const scores = getChapterScores(db, id);
    return c.json({ scores });
  });

  // 某章的评估历史（含所有 revise 轮次）
  app.get('/:id/eval/:n', (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    if (isNaN(n)) return c.json({ error: '章号无效' }, 400);
    const history = getEvalHistory(db, id, n);
    return c.json({ chapter: n, history });
  });

  // 经验学习表内容（可按 pattern 过滤）
  app.get('/:id/lessons', (c) => {
    const id = c.req.param('id');
    const pattern = c.req.query('pattern');
    const lessons = getLessons(db, id, pattern);
    return c.json({ lessons });
  });

  // 仪表盘聚合数据：scores + 伏笔状态 + 角色，前端一次拉取
  app.get('/:id/dashboard', (c) => {
    const id = c.req.param('id');
    const scores = getChapterScores(db, id);
    // narrative_state 含 openForeshadows（伏笔回收追踪）
    let narrative: { macroSummary?: string; openForeshadows?: unknown[] } = {};
    let characters: { name: string; status?: string }[] = [];
    try {
      const { getNarrativeState, getBibleForChapter } = require('@novel-eval/writer');
      const ns = getNarrativeState(db, id);
      if (ns) narrative = { macroSummary: ns.macroSummary, openForeshadows: ns.openForeshadows ?? [] };
      const bible = getBibleForChapter(db, id);
      if (bible.characterState?.characters) {
        characters = bible.characterState.characters.map((ch: { name: string; status?: string }) => ({ name: ch.name, status: ch.status }));
      }
    } catch { /* narrative/bible 未生成时忽略 */ }
    return c.json({ scores, narrative, characters });
  });

  return app;
}
