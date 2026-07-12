/** 项目路由 — GET 列表 / GET 详情 */
import { Hono } from 'hono';
import { listProjects, getProject, countOutlines, countChapters, getChapter, type DB } from '@novel-eval/writer';

export function projectRoutes(db: DB) {
  const app = new Hono();

  // 项目列表
  app.get('/', (c) => {
    const projects = listProjects(db);
    return c.json(projects);
  });

  // 项目详情（含进度统计）
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const project = getProject(db, id);
    if (!project) return c.json({ error: '项目不存在' }, 404);
    const outlineCount = countOutlines(db, id);
    const chapterCount = countChapters(db, id);
    const lastChapter = chapterCount > 0 ? getChapter(db, id, chapterCount) : null;
    return c.json({
      ...project,
      outlineCount,
      chapterCount,
      lastChapter: lastChapter ? { number: lastChapter.number, title: lastChapter.title, wordCount: lastChapter.wordCount } : null,
    });
  });

  return app;
}
