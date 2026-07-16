/**
 * Web 后端入口 — Hono + @hono/node-server
 *
 * 启动时：loadEnv → openDb(WRITER_DB_PATH) → Hono serve。
 * API 路由挂载在 /api 下，前端静态文件在生产模式下由 Hono serve。
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolveServicePort } from '@novel-eval/shared';
import { openDb, closeDb, loadWriterConfig, recoverInterruptedJobs, loadEnv } from '@novel-eval/writer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '..', 'dist');

import { projectRoutes } from './routes/projects.ts';
import { bibleRoutes } from './routes/bible.ts';
import { chapterRoutes } from './routes/chapters.ts';
import { outlineRoutes } from './routes/outlines.ts';
import { generateRoutes } from './routes/generate.ts';
import { editRoutes } from './routes/edit.ts';
import { correctionRoutes } from './routes/correction.ts';
import { configRoutes } from './routes/config.ts';
import { evalRoutes } from './routes/eval.ts';
import { evalTasksRouter } from './routes/eval-tasks.ts';
import { storyStateRoutes } from './routes/story-state.ts';
import { rebuildRoutes } from './routes/rebuilds.ts';
import { revisionRoutes } from './routes/revisions.ts';
import { EngineRegistry } from './engine-registry.ts';
import { httpErrorJson, toHttpError } from './middleware/error-mapper.ts';

loadEnv();
const databasePath = process.env.WRITER_DB_PATH;
if (typeof databasePath !== 'string' || databasePath.trim() === '') {
  throw new Error('WRITER_DB_PATH must be set to an explicit database path');
}
const db = openDb({ path: databasePath });
const recovered = recoverInterruptedJobs(db);
if (recovered > 0) {
  console.log(`[startup] 检测到 ${recovered} 个上次未完成的任务，已标记为已暂停（可点继续恢复）。`);
}
const config = loadWriterConfig();
const registry = new EngineRegistry(config.engines, config.engineName);

const app = new Hono();

app.onError((err, c) => {
  const mapped = toHttpError(err);
  return c.json(httpErrorJson(mapped), mapped.status as 400 | 402 | 409 | 422 | 500);
});

app.route('/api/projects', projectRoutes(db));
app.route('/api/projects', bibleRoutes(db));
app.route('/api/projects', chapterRoutes(db));
app.route('/api/projects', outlineRoutes(db));
app.route('/api/projects', generateRoutes(db, registry));
app.route('/api/projects', editRoutes(db));
app.route('/api/projects', correctionRoutes(db, registry));
app.route('/api/projects', storyStateRoutes(db));
app.route('/api/projects', rebuildRoutes(db, { registry }));
app.route('/api/projects', evalRoutes(db));
app.route('/api/chapters', revisionRoutes(db));
app.route('/api/eval', evalTasksRouter);
app.route('/api/config', configRoutes(registry));

app.get('/api/config', (c) => c.json({
  engine: registry.getActiveName(),
  model: registry.getActiveConfig().model,
  generation: config.generation,
  engines: registry.listEngines(),
}));

app.use('/assets/*', serveStatic({ root: DIST_DIR }));
app.use('/*', serveStatic({ root: DIST_DIR }));
app.get('/*', (c) => {
  try {
    const html = readFileSync(resolve(DIST_DIR, 'index.html'), 'utf-8');
    return c.html(html);
  } catch {
    return c.text('前端未构建，请先运行 pnpm web:build', 404);
  }
});

const port = resolveServicePort(process.env);
console.log(`Novel Eval Web — http://127.0.0.1:${port}`);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`服务已启动：http://127.0.0.1:${info.port}`);
});

process.on('SIGINT', () => { closeDb(db); process.exit(0); });
process.on('SIGTERM', () => { closeDb(db); process.exit(0); });
