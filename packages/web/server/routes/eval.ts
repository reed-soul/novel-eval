/**
 * 评估历史路由 — 质量趋势 + 评估详情 + 经验学习
 */
import { Hono } from 'hono';
import type { DB } from '@novel-eval/writer';
import {
  getChapterScores,
  getEvalHistory,
  getLessons,
  getBibleForChapter,
  projectId,
  StoryStateRepository,
} from '@novel-eval/writer';

export function evalRoutes(db: DB) {
  const app = new Hono();

  app.get('/:id/scores', (c) => {
    const id = c.req.param('id');
    const scores = getChapterScores(db, id);
    return c.json({ scores });
  });

  app.get('/:id/eval/:n', (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    if (isNaN(n)) return c.json({ error: '章号无效' }, 400);
    const history = getEvalHistory(db, id, n);
    return c.json({ chapter: n, history });
  });

  app.get('/:id/lessons', (c) => {
    const id = c.req.param('id');
    const pattern = c.req.query('pattern');
    const lessons = getLessons(db, id, pattern);
    return c.json({ lessons });
  });

  app.get('/:id/dashboard', (c) => {
    const id = c.req.param('id');
    const scores = getChapterScores(db, id);
    const narrative: { macroSummary?: string; openForeshadows?: unknown[] } = {
      openForeshadows: [],
    };
    let characters: { name: string; status?: string }[] = [];
    const currentState = new StoryStateRepository(db).getCurrent(projectId(id));
    if (currentState) {
      narrative.macroSummary = currentState.summary;
      narrative.openForeshadows = currentState.state.foreshadows
        .filter((foreshadow) => foreshadow.status === 'open')
        .map((foreshadow) => ({
          id: foreshadow.id,
          description: foreshadow.description,
          openedAtChapterRevisionId: foreshadow.openedAtChapterRevisionId,
          status: foreshadow.status,
        }));
      characters = currentState.state.characters.map((character) => ({
        name: character.name,
        status: character.status,
      }));
    }
    try {
      const bible = getBibleForChapter(db, id);
      if (characters.length === 0 && bible.characterState?.characters) {
        characters = bible.characterState.characters.map((ch) => ({
          name: ch.name,
          status: ch.status,
        }));
      }
    } catch {
      /* bible 未生成时忽略 */
    }
    return c.json({ scores, narrative, characters });
  });

  return app;
}
