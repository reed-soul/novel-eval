/**
 * Web 后端入口 — Hono + @hono/node-server
 *
 * 启动时：loadEnv（读智谱 key）→ openDb（必须在仓库根目录启动）→ Hono serve。
 * API 路由挂载在 /api 下，前端静态文件在生产模式下由 Hono serve。
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { openDb, closeDb, loadWriterConfig } from '@novel-eval/writer';
import { loadEnv } from '@novel-eval/writer';

// 路由模块
import { projectRoutes } from './routes/projects.ts';
import { bibleRoutes } from './routes/bible.ts';
import { chapterRoutes } from './routes/chapters.ts';
import { outlineRoutes } from './routes/outlines.ts';
import { narrativeRoutes } from './routes/narrative.ts';

loadEnv();
const db = openDb();
const config = loadWriterConfig();

const app = new Hono();

// API 路由
app.route('/api/projects', projectRoutes(db));
app.route('/api/projects', bibleRoutes(db));
app.route('/api/projects', chapterRoutes(db));
app.route('/api/projects', outlineRoutes(db));
app.route('/api/projects', narrativeRoutes(db));

// 配置端点
app.get('/api/config', (c) => c.json({
  engine: config.engineName,
  model: config.engine.model,
  generation: config.generation,
}));

// 静态文件（生产模式：Vite 构建后的 dist/）
app.use('/*', serveStatic({ root: './dist' }));
// SPA fallback：非 /api 路径都返回 index.html
app.get('/*', serveStatic({ root: './dist', path: 'index.html' }));

const port = 3000;
console.log(`Novel Eval Web — http://localhost:${port}`);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`服务已启动：http://localhost:${info.port}`);
});

// 优雅关闭
process.on('SIGINT', () => { closeDb(db); process.exit(0); });
process.on('SIGTERM', () => { closeDb(db); process.exit(0); });
