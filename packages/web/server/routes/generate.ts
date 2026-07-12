/**
 * 生成路由 — POST 发起生成 + SSE 进度流 + job 状态查询
 *
 * 端点：
 *   POST /api/projects            新建项目（可选 generate bible）
 *   POST /api/projects/:id/bible/generate
 *   POST /api/projects/:id/outline/generate
 *   POST /api/projects/:id/chapters/generate
 *   GET  /api/jobs/:jobId          查 job 状态
 *   GET  /api/jobs/:jobId/events   SSE 进度流
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { NovelMetadata } from '@novel-eval/shared';
import {
  type DB, loadWriterConfig,
  createProject, getProject, updateProjectStatus,
  generateBible, generateBlueprint, generateRange,
  getBibleForChapter, countOutlines,
  type CharacterDynamic,
} from '@novel-eval/writer';
import { createJob, getJob } from '../jobs.ts';
import type { EngineRegistry } from '../engine-registry.ts';

export function generateRoutes(db: DB, registry: EngineRegistry) {
  const app = new Hono();

  // ─── 新建项目（可选同时生成 bible）──────────────────────────────
  app.post('/', async (c) => {
    const body = await c.req.json<{
      title: string; genre: string; audience: string; topic: string;
      generate?: boolean;
    }>();
    const project = createProject(db, { title: body.title, genre: body.genre, audience: body.audience, topic: body.topic });

    if (!body.generate) {
      return c.json({ project });
    }

    // 同时生成 bible
    const jobId = createJob('bible', async (onProgress) => {
      const { bible, usage } = await generateBible({
        engine: registry.getEngine(), db, projectId: project.id,
        topic: body.topic, genre: body.genre, audience: body.audience, onProgress,
      });
      updateProjectStatus(db, project.id, 'bible_done');
      return { bible: { characters: bible.characterDynamics.length, foreshadows: bible.plotArchitecture.foreshadows.length }, usage };
    });
    return c.json({ project, jobId });
  });

  // ─── 生成 bible ────────────────────────────────────────────────────
  app.post('/:id/bible/generate', async (c) => {
    const id = c.req.param('id');
    const project = getProject(db, id);
    if (!project) return c.json({ error: '项目不存在' }, 404);

    const jobId = createJob('bible', async (onProgress) => {
      const { bible, usage } = await generateBible({
        engine: registry.getEngine(), db, projectId: id,
        topic: project.topic, genre: project.genre, audience: project.audience, onProgress,
      });
      updateProjectStatus(db, id, 'bible_done');
      return { characters: bible.characterDynamics.length, foreshadows: bible.plotArchitecture.foreshadows.length, usage };
    });
    return c.json({ jobId });
  });

  // ─── 生成蓝图 ──────────────────────────────────────────────────────
  app.post('/:id/outline/generate', async (c) => {
    const id = c.req.param('id');
    const project = getProject(db, id);
    if (!project) return c.json({ error: '项目不存在' }, 404);

    const body = await c.req.json<{ chapters?: number }>().catch(() => ({}) as { chapters?: number });
    const config = loadWriterConfig();
    const totalChapters = body.chapters ?? config.generation.defaultChapters;

    const { plotArchitecture, characterState: _ } = getBibleForChapter(db, id);
    void _;
    const bibleRow = db.prepare('SELECT character_dynamics FROM bible WHERE project_id = ?').get(id) as { character_dynamics: string } | undefined;
    if (!bibleRow?.character_dynamics) return c.json({ error: 'bible 未完成' }, 400);
    const characters = (JSON.parse(bibleRow.character_dynamics) as { characters: CharacterDynamic[] }).characters;

    const jobId = createJob('outline', async (onProgress) => {
      const { outlines, usage } = await generateBlueprint({
        engine: registry.getEngine(), db, projectId: id, plot: plotArchitecture, characters, totalChapters, onProgress,
      });
      updateProjectStatus(db, id, 'outlining');
      return { chapters: outlines.length, usage };
    });
    return c.json({ jobId });
  });

  // ─── 生成章节 ──────────────────────────────────────────────────────
  app.post('/:id/chapters/generate', async (c) => {
    const id = c.req.param('id');
    const project = getProject(db, id);
    if (!project) return c.json({ error: '项目不存在' }, 404);
    if (countOutlines(db, id) === 0) return c.json({ error: '蓝图未生成' }, 400);

    const body = await c.req.json<{ from: number; to: number; qualityGate?: boolean; maxRevise?: number }>();
    const config = loadWriterConfig();
    const metadata: NovelMetadata = { genre: project.genre, targetAudience: project.audience };

    const jobId = createJob('chapter', async (onProgress) => {
      updateProjectStatus(db, id, 'writing');
      const results = await generateRange({
        engine: registry.getEngine(), db, projectId: id, from: body.from, to: body.to,
        wordCount: config.generation.chapterWordCount,
        qualityGate: body.qualityGate ? { metadata, maxRevise: body.maxRevise ?? 2 } : undefined,
        onProgress,
      });
      const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
      const totalCost = results.reduce((s, r) => s + r.usage.costRmb, 0);
      return { chapters: results.length, totalWords, totalCost };
    });
    return c.json({ jobId });
  });

  // ─── job 状态查询 ──────────────────────────────────────────────
  app.get('/jobs/:jobId', (c) => {
    const job = getJob(c.req.param('jobId'));
    if (!job) return c.json({ error: 'job 不存在' }, 404);
    return c.json({ id: job.id, type: job.type, status: job.status, events: job.events.length, result: job.result, error: job.error });
  });

  // ─── SSE 进度流 ────────────────────────────────────────────────
  app.get('/jobs/:jobId/events', (c) => {
    const job = getJob(c.req.param('jobId'));
    if (!job) return c.json({ error: 'job 不存在' }, 404);

    return streamSSE(c, async (stream) => {
      // 推历史 events（客户端可能晚连接）
      for (const evt of job.events) {
        await stream.writeSSE({ data: JSON.stringify(evt) });
      }

      // 如果已完成/失败，推终态
      if (job.status === 'done') {
        await stream.writeSSE({ data: JSON.stringify({ event: 'done', result: job.result }) });
        return;
      }
      if (job.status === 'error') {
        await stream.writeSSE({ data: JSON.stringify({ event: 'error', error: job.error }) });
        return;
      }

      // 订阅后续 events
      const onProgress = (evt: { step: string; msg: string; ts: number }) => {
        stream.writeSSE({ data: JSON.stringify(evt) }).catch(() => {});
      };
      const onDone = (result: unknown) => {
        stream.writeSSE({ data: JSON.stringify({ event: 'done', result }) }).catch(() => {});
      };
      const onError = (error: string) => {
        stream.writeSSE({ data: JSON.stringify({ event: 'error', error }) }).catch(() => {});
      };

      job.emitter.on('progress', onProgress);
      job.emitter.once('done', onDone);
      job.emitter.once('error', onError);

      // 等待流关闭（客户端断开）再清理
      stream.onAbort(() => {
        job.emitter.off('progress', onProgress);
        job.emitter.off('done', onDone);
        job.emitter.off('error', onError);
      });
    });
  });

  return app;
}
