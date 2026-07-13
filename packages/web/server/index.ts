/**
 * Web 后端入口 — Hono + @hono/node-server
 *
 * 启动时：loadEnv（读智谱 key）→ openDb（必须在仓库根目录启动）→ Hono serve。
 * API 路由挂载在 /api 下，前端静态文件在生产模式下由 Hono serve。
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { openDb, closeDb, loadWriterConfig, recoverInterruptedJobs } from '@novel-eval/writer';
import { loadEnv } from '@novel-eval/writer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '..', 'dist');  // packages/web/dist/

// 路由模块
import { projectRoutes } from './routes/projects.ts';
import { bibleRoutes } from './routes/bible.ts';
import { chapterRoutes } from './routes/chapters.ts';
import { outlineRoutes } from './routes/outlines.ts';
import { narrativeRoutes } from './routes/narrative.ts';
import { generateRoutes } from './routes/generate.ts';
import { editRoutes } from './routes/edit.ts';
import { configRoutes } from './routes/config.ts';
import { evalRoutes } from './routes/eval.ts';
import { EngineRegistry } from './engine-registry.ts';

loadEnv();
const db = openDb();
// 启动恢复：把上次进程没正常退出残留的 running job 标成 paused，
// 让用户重启后看到"已暂停"并点继续，而不是永远卡 running（内存 job 已失）。
const recovered = recoverInterruptedJobs(db);
if (recovered > 0) {
  console.log(`[startup] 检测到 ${recovered} 个上次未完成的任务，已标记为已暂停（可点继续恢复）。`);
}
const config = loadWriterConfig();
const registry = new EngineRegistry(config.engines, config.engineName);

const app = new Hono();

// API 路由（只读）
app.route('/api/projects', projectRoutes(db));
app.route('/api/projects', bibleRoutes(db));
app.route('/api/projects', chapterRoutes(db));
app.route('/api/projects', outlineRoutes(db));
app.route('/api/projects', narrativeRoutes(db));
// 生成 + 编辑路由（POST/PUT + SSE）
app.route('/api/projects', generateRoutes(db, registry));
app.route('/api/projects', editRoutes(db));
// 评估历史路由（质量趋势 + 经验学习）
app.route('/api/projects', evalRoutes(db));
// 引擎配置路由（切换引擎/模型/注入 key）
app.route('/api/config', configRoutes(registry));

// 配置端点（兼容旧前端，扩展 engines 信息）
app.get('/api/config', (c) => c.json({
  engine: registry.getActiveName(),
  model: registry.getActiveConfig().model,
  generation: config.generation,
  engines: registry.listEngines(),
}));

// 静态文件（生产模式：Vite 构建后的 dist/）
// serveStatic 的 root 相对于 cwd，用绝对路径避免定位错误
app.use('/assets/*', serveStatic({ root: DIST_DIR }));
app.use('/*', serveStatic({ root: DIST_DIR }));
// SPA fallback：非 /api 且非静态文件的路径返回 index.html
import { readFileSync } from 'node:fs';
app.get('/*', (c) => {
  try {
    const html = readFileSync(resolve(DIST_DIR, 'index.html'), 'utf-8');
    return c.html(html);
  } catch {
    return c.text('前端未构建，请先运行 pnpm web:build', 404);
  }
});

const port = 3000;
console.log(`Novel Eval Web — http://localhost:${port}`);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`服务已启动：http://localhost:${info.port}`);
});

// 优雅关闭
process.on('SIGINT', () => { closeDb(db); process.exit(0); });
process.on('SIGTERM', () => { closeDb(db); process.exit(0); });
