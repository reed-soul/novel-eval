/**
 * 生成路由 — POST 发起生成 + SSE 进度流 + job 状态查询 + 暂停/继续/取消
 *
 * 端点：
 *   POST /api/projects            新建项目（可选 generate bible）
 *   POST /api/projects/:id/bible/generate
 *   POST /api/projects/:id/outline/generate
 *   POST /api/projects/:id/chapters/generate
 *   POST /api/jobs/:jobId/pause           暂停（章节边界生效）
 *   POST /api/jobs/:jobId/resume          从断点继续（新建 job 续跑）
 *   POST /api/jobs/:jobId/cancel          取消
 *   GET  /api/jobs/:jobId                 查 job 状态
 *   GET  /api/jobs/:jobId/events          SSE 进度流（含 paused/cancelled 事件）
 *   GET  /api/projects/:id/active-job     查项目活动 job（running/paused）
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createEngine, type NovelMetadata } from '@novel-eval/shared';
import {
  type DB, loadWriterConfig,
  createProject, getProject, updateProjectStatus,
  generateBible, generateBlueprint, generateRange,
  getBibleForChapter, countOutlines,
  ensureChapterConsistency,
  getActiveJob, getJobRow as getJobRowDb,
  type CharacterDynamic,
} from '@novel-eval/writer';
import {
  createJob, getJob, hydrateJobFromDb, requestPause, requestCancel,
  type JobRunnerContext,
} from '../jobs.ts';
import type { EngineRegistry } from '../engine-registry.ts';

export function generateRoutes(db: DB, registry: EngineRegistry) {
  const app = new Hono();

  function resolveEngine(body: { engineName?: string; model?: string }) {
    if (body.engineName) {
      const baseConfig = registry.getEngineConfig(body.engineName);
      if (baseConfig) {
        return createEngine({
          ...baseConfig,
          model: body.model ?? baseConfig.model,
        });
      }
    }
    return registry.getEngine();
  }

  // ─── 新建项目（可选同时生成 bible）──────────────────────────────
  app.post('/', async (c) => {
    const body = await c.req.json<{
      title: string; genre: string; audience: string; topic: string;
      generate?: boolean;
      engineName?: string;
      model?: string;
    }>();
    const project = createProject(db, { title: body.title, genre: body.genre, audience: body.audience, topic: body.topic });

    if (!body.generate) {
      return c.json({ project });
    }

    // 同时生成 bible
    const jobId = createJob(db, { type: 'bible', projectId: project.id }, async ({ onProgress }: JobRunnerContext) => {
      const { bible, usage } = await generateBible({
        engine: resolveEngine(body), db, projectId: project.id,
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

    const body = await c.req.json<{ engineName?: string; model?: string }>().catch(() => ({}));
    const jobId = createJob(db, { type: 'bible', projectId: id }, async ({ onProgress }: JobRunnerContext) => {
      const { bible, usage } = await generateBible({
        engine: resolveEngine(body), db, projectId: id,
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

    const body = await c.req.json<{ chapters?: number; engineName?: string; model?: string }>().catch(() => ({} as { chapters?: number; engineName?: string; model?: string }));
    const config = loadWriterConfig();
    const totalChapters = body.chapters ?? config.generation.defaultChapters;

    const { plotArchitecture, characterState: _ } = getBibleForChapter(db, id);
    void _;
    const bibleRow = db.prepare('SELECT character_dynamics FROM bible WHERE project_id = ?').get(id) as { character_dynamics: string } | undefined;
    if (!bibleRow?.character_dynamics) return c.json({ error: 'bible 未完成' }, 400);
    const characters = (JSON.parse(bibleRow.character_dynamics) as { characters: CharacterDynamic[] }).characters;

    const jobId = createJob(db, { type: 'outline', projectId: id }, async ({ onProgress }: JobRunnerContext) => {
      const { outlines, usage } = await generateBlueprint({
        engine: resolveEngine(body), db, projectId: id, plot: plotArchitecture, characters, totalChapters, onProgress,
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

    const body = await c.req.json<{ from: number; to: number; qualityGate?: boolean; maxRevise?: number; engineName?: string; model?: string; wordCount?: number }>();
    const config = loadWriterConfig();
    const metadata: NovelMetadata = { genre: project.genre, targetAudience: project.audience };
    const useGate = !!body.qualityGate;
    const wordCount = body.wordCount ?? config.generation.chapterWordCount;

    const jobId = createJob(db, {
      type: 'chapter', projectId: id,
      fromChapter: body.from, toChapter: body.to,
      qualityGate: useGate, maxRevise: body.maxRevise ?? 0,
    }, async (ctx: JobRunnerContext) => {
      const { onProgress, control } = ctx;
      updateProjectStatus(db, id, 'writing');
      const results = await generateRange({
        engine: resolveEngine(body), db, projectId: id, from: body.from, to: body.to,
        wordCount,
        qualityGate: useGate ? { metadata, maxRevise: body.maxRevise ?? 2 } : undefined,
        onProgress,
        control,  // 暂停/取消信号在此注入
      });
      const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
      const totalCost = results.reduce((s, r) => s + r.usage.costRmb, 0);
      // 全部写完 → completed
      const outlineMax = countOutlines(db, id);
      if (body.to >= outlineMax) updateProjectStatus(db, id, 'completed');
      return { chapters: results.length, totalWords, totalCost };
    });
    return c.json({ jobId });
  });

  // ─── 暂停 job（章节边界生效）──────────────────────────────────
  app.post('/jobs/:jobId/pause', (c) => {
    const jobId = c.req.param('jobId');
    const ok = requestPause(db, jobId);
    if (!ok) return c.json({ error: 'job 不存在或不在 running 状态' }, 400);
    return c.json({ jobId, status: 'paused' });
  });

  // ─── 继续 job（从断点新建 job 续跑）────────────────────────────
  app.post('/jobs/:jobId/resume', async (c) => {
    const oldJobId = c.req.param('jobId');
    const oldRow = getJobRowDb(db, oldJobId);
    if (!oldRow) return c.json({ error: 'job 不存在' }, 404);
    if (oldRow.type !== 'chapter') return c.json({ error: '仅 chapter 类型支持 resume' }, 400);

    const project = getProject(db, oldRow.projectId);
    if (!project) return c.json({ error: '项目不存在' }, 404);

    const body = await c.req.json<{ engineName?: string; model?: string; maxRevise?: number; wordCount?: number }>().catch(() => ({} as { engineName?: string; model?: string; maxRevise?: number; wordCount?: number }));
    const config = loadWriterConfig();
    const metadata: NovelMetadata = { genre: project.genre, targetAudience: project.audience };
    const useGate = !!oldRow.qualityGate;
    const maxRevise = body.maxRevise ?? oldRow.maxRevise;
    const wordCount = body.wordCount ?? config.generation.chapterWordCount;

    // 先把原 job 标 cancelled（如果还是 paused 的话），避免 active-job 查到两个
    if (oldRow.status === 'paused') {
      requestCancel(db, oldJobId);
    }

    const jobId = createJob(db, {
      type: 'chapter', projectId: oldRow.projectId,
      fromChapter: oldRow.toChapter ?? undefined, toChapter: oldRow.toChapter ?? undefined,  // 临时占位，consistency 后定真实 from
      qualityGate: useGate, maxRevise,
    }, async (ctx: JobRunnerContext) => {
      const { onProgress, control } = ctx;
      updateProjectStatus(db, oldRow.projectId, 'writing');
      // 一致性检查 + 算真实 resume 起点
      const { from, to, finalizedGap } = await ensureChapterConsistency(
        resolveEngine(body), db, oldRow.projectId, onProgress,
      );
      if (finalizedGap > 0) {
        onProgress('resume', `已补全 ${finalizedGap} 章半成品叙事状态`);
      }
      if (from > to) {
        updateProjectStatus(db, oldRow.projectId, 'completed');
        return { chapters: 0, totalWords: 0, totalCost: 0, message: '全部章节已完成' };
      }
      const results = await generateRange({
        engine: resolveEngine(body), db, projectId: oldRow.projectId, from, to,
        wordCount,
        qualityGate: useGate ? { metadata, maxRevise: maxRevise || 2 } : undefined,
        onProgress,
        control,
      });
      const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
      const totalCost = results.reduce((s, r) => s + r.usage.costRmb, 0);
      if (to >= countOutlines(db, oldRow.projectId)) updateProjectStatus(db, oldRow.projectId, 'completed');
      return { chapters: results.length, totalWords, totalCost };
    });
    return c.json({ jobId, resumedFrom: oldJobId });
  });

  // ─── 取消 job ──────────────────────────────────────────────────
  app.post('/jobs/:jobId/cancel', (c) => {
    const jobId = c.req.param('jobId');
    const ok = requestCancel(db, jobId);
    if (!ok) return c.json({ error: 'job 不存在或已终态' }, 400);
    return c.json({ jobId, status: 'cancelled' });
  });

  // ─── 项目活动 job（详情页刷新后重连用）──────────────────────────
  app.get('/:id/active-job', (c) => {
    const id = c.req.param('id');
    const row = getActiveJob(db, id);
    if (!row) return c.json({ job: null });
    return c.json({ job: row });
  });

  // ─── job 状态查询 ──────────────────────────────────────────────
  app.get('/jobs/:jobId', (c) => {
    const jobId = c.req.param('jobId');
    // 优先内存（有实时状态），否则 DB
    const job = getJob(jobId) ?? hydrateJobFromDb(db, jobId);
    if (!job) {
      const row = getJobRowDb(db, jobId);
      if (!row) return c.json({ error: 'job 不存在' }, 404);
      return c.json({ id: row.id, type: row.type, projectId: row.projectId, status: row.status, lastChapter: row.lastChapter, fromChapter: row.fromChapter, toChapter: row.toChapter, result: row.result, error: row.error });
    }
    return c.json({
      id: job.id, type: job.type, projectId: job.projectId, status: job.status,
      events: job.events.length,
      lastChapter: job.lastChapter,
      fromChapter: job.fromChapter, toChapter: job.toChapter,
      result: job.result, error: job.error,
    });
  });

  // ─── SSE 进度流 ────────────────────────────────────────────────
  app.get('/jobs/:jobId/events', (c) => {
    const jobId = c.req.param('jobId');
    // 内存 job 优先；进程重启后从 DB hydrate（只能拿到非 running 的历史态）
    let job = getJob(jobId);
    if (!job) job = hydrateJobFromDb(db, jobId);
    if (!job) {
      // 最后兜底：DB 有记录但没 hydrate（比如 running 态重启后）→ 推终态
      const row = getJobRowDb(db, jobId);
      if (!row) return c.json({ error: 'job 不存在' }, 404);
      return streamSSE(c, async (stream) => {
        if (row.status === 'paused') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'paused' }) });
        } else if (row.status === 'cancelled') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'cancelled' }) });
        } else if (row.status === 'done') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'done', result: row.result }) });
        } else if (row.status === 'error') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'error', error: row.error }) });
        }
      });
    }

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
      if (job.status === 'paused') {
        await stream.writeSSE({ data: JSON.stringify({ event: 'paused' }) });
        return;
      }
      if (job.status === 'cancelled') {
        await stream.writeSSE({ data: JSON.stringify({ event: 'cancelled' }) });
        return;
      }

      // running：订阅后续 events
      const onProgress = (evt: { step: string; msg: string; ts: number }) => {
        stream.writeSSE({ data: JSON.stringify(evt) }).catch(() => {});
      };
      const onDone = (result: unknown) => {
        stream.writeSSE({ data: JSON.stringify({ event: 'done', result }) }).catch(() => {});
      };
      const onError = (error: string) => {
        stream.writeSSE({ data: JSON.stringify({ event: 'error', error }) }).catch(() => {});
      };
      const onPaused = () => {
        stream.writeSSE({ data: JSON.stringify({ event: 'paused' }) }).catch(() => {});
      };
      const onCancelled = () => {
        stream.writeSSE({ data: JSON.stringify({ event: 'cancelled' }) }).catch(() => {});
      };

      job.emitter.on('progress', onProgress);
      job.emitter.once('done', onDone);
      job.emitter.once('error', onError);
      job.emitter.once('paused', onPaused);
      job.emitter.once('cancelled', onCancelled);

      // 等待流关闭（客户端断开）再清理
      stream.onAbort(() => {
        job.emitter.off('progress', onProgress);
        job.emitter.off('done', onDone);
        job.emitter.off('error', onError);
        job.emitter.off('paused', onPaused);
        job.emitter.off('cancelled', onCancelled);
      });
    });
  });

  return app;
}
