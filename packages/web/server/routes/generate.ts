/**
 * 生成路由 — POST 发起生成 + SSE 进度流 + job 状态查询 + 暂停/继续/取消
 *
 * 全部写路径经 WriterApplication；禁止直连 SQL 与旧 store 可变写入。
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createEngine } from '@novel-eval/shared';
import {
  type DB,
  loadWriterConfig,
  createProject,
  getProject,
  updateProjectStatus,
  getBibleForChapter,
  countOutlines,
  getActiveJob,
  getJobRow as getJobRowDb,
  readJobResumeConfig,
  listJobEventsAfter,
  WriterApplication,
  PlanningRepository,
  projectId,
  completeProjectIfFullyWritten,
  finalizeExhaustedResumeJob,
  type CharacterDynamic,
  type PlotArchitecture,
} from '@novel-eval/writer';
import {
  createJob,
  getJob,
  hydrateJobFromDb,
  requestPause,
  requestCancel,
  hasActiveJobForProject,
  attachJobRunner,
  jobToClientPayload,
  parseAfterSeq,
  type JobRunnerContext,
} from '../jobs.ts';
import type { EngineRegistry } from '../engine-registry.ts';

function readCharacterDynamics(bibleDoc: Record<string, unknown>): CharacterDynamic[] {
  const dynamics = bibleDoc.characterDynamics;
  if (!Array.isArray(dynamics)) return [];
  return dynamics as CharacterDynamic[];
}

function readPlotArchitecture(value: PlotArchitecture): PlotArchitecture {
  return value;
}

export function generateRoutes(
  db: DB,
  registry: EngineRegistry,
  application?: WriterApplication,
) {
  const app = new Hono();
  const writer = application ?? new WriterApplication(db, { defaultOwnerId: 'web' });

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
    const project = createProject(db, {
      title: body.title,
      genreProfile: body.genre,
      targetAudience: body.audience,
      premise: body.topic,
    });

    if (!body.generate) {
      return c.json({ project });
    }

    if (hasActiveJobForProject(db, project.id)) {
      return c.json({ error: '项目有正在运行的任务，请稍后再试' }, 409);
    }

    const engine = resolveEngine(body);
    const jobId = createJob(db, {
      type: 'bible',
      projectId: project.id,
      engine: engine.name,
      model: body.model ?? engine.name,
      input: {
        title: body.title,
        genre: body.genre,
        audience: body.audience,
        topic: body.topic,
        engineName: body.engineName ?? engine.name,
        model: body.model ?? engine.name,
      },
      budget: {},
    }, async (ctx: JobRunnerContext) => {
      const { bible, usage } = await writer.generateBible({
        engine,
        projectId: project.id,
        topic: body.topic,
        genre: body.genre,
        audience: body.audience,
        onProgress: ctx.onProgress,
        existingJobId: ctx.job.id,
        ownerId: 'web',
      });
      updateProjectStatus(db, project.id, 'planning');
      return {
        bible: {
          characters: bible.characterDynamics.length,
          foreshadows: bible.plotArchitecture.foreshadows.length,
        },
        usage,
      };
    });
    return c.json({ project, jobId });
  });

  // ─── 生成 bible ────────────────────────────────────────────────────
  app.post('/:id/bible/generate', async (c) => {
    const id = c.req.param('id');
    const project = getProject(db, id);
    if (!project) return c.json({ error: '项目不存在' }, 404);
    if (hasActiveJobForProject(db, id)) return c.json({ error: '项目有正在运行的任务' }, 409);

    const body = await c.req.json<{ engineName?: string; model?: string }>()
      .catch(() => ({} as { engineName?: string; model?: string }));
    const engine = resolveEngine(body);
    const jobId = createJob(db, {
      type: 'bible',
      projectId: id,
      engine: engine.name,
      model: body.model ?? engine.name,
      input: {
        topic: project.premise,
        genre: project.genreProfile,
        audience: project.targetAudience,
        engineName: body.engineName ?? engine.name,
        model: body.model ?? engine.name,
      },
      budget: {},
    }, async (ctx: JobRunnerContext) => {
      const { bible, usage } = await writer.generateBible({
        engine,
        projectId: id,
        topic: project.premise,
        genre: project.genreProfile,
        audience: project.targetAudience,
        onProgress: ctx.onProgress,
        existingJobId: ctx.job.id,
        ownerId: 'web',
      });
      updateProjectStatus(db, id, 'planning');
      return {
        characters: bible.characterDynamics.length,
        foreshadows: bible.plotArchitecture.foreshadows.length,
        usage,
      };
    });
    return c.json({ jobId });
  });

  // ─── 生成蓝图 ──────────────────────────────────────────────────────
  app.post('/:id/outline/generate', async (c) => {
    const id = c.req.param('id');
    const project = getProject(db, id);
    if (!project) return c.json({ error: '项目不存在' }, 404);
    if (hasActiveJobForProject(db, id)) return c.json({ error: '项目有正在运行的任务' }, 409);

    const body = await c.req.json<{ chapters?: number; engineName?: string; model?: string }>()
      .catch(() => ({} as { chapters?: number; engineName?: string; model?: string }));
    const config = loadWriterConfig();
    const totalChapters = body.chapters ?? config.generation.defaultChapters;

    let plotArchitecture: PlotArchitecture;
    try {
      const bible = getBibleForChapter(db, id);
      plotArchitecture = readPlotArchitecture(bible.plotArchitecture);
    } catch {
      return c.json({ error: 'bible 未完成' }, 400);
    }

    const activeBible = new PlanningRepository(db).getActiveBibleForProject(projectId(id));
    if (!activeBible) return c.json({ error: 'bible 未完成' }, 400);
    const characters = readCharacterDynamics(activeBible.bible as Record<string, unknown>);
    if (characters.length === 0) return c.json({ error: 'bible 未完成' }, 400);

    const engine = resolveEngine(body);
    const jobId = createJob(db, {
      type: 'outline',
      projectId: id,
      engine: engine.name,
      model: body.model ?? engine.name,
      input: {
        chapters: totalChapters,
        engineName: body.engineName ?? engine.name,
        model: body.model ?? engine.name,
      },
      budget: {},
    }, async (ctx: JobRunnerContext) => {
      const { outlines, usage } = await writer.generateBlueprint({
        engine,
        projectId: id,
        plot: plotArchitecture,
        characters,
        totalChapters,
        onProgress: ctx.onProgress,
        existingJobId: ctx.job.id,
        ownerId: 'web',
      });
      updateProjectStatus(db, id, 'planning');
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
    if (hasActiveJobForProject(db, id)) return c.json({ error: '项目有正在运行的任务' }, 409);

    const body = await c.req.json<{
      from: number;
      to: number;
      qualityGate?: boolean;
      maxRevise?: number;
      engineName?: string;
      model?: string;
      wordCount?: number;
      maxCostRmb?: number;
    }>();
    if (body.qualityGate) {
      return c.json({ error: 'qualityGate is unsupported until the chapter quality system lands' }, 400);
    }

    const config = loadWriterConfig();
    const wordCount = body.wordCount ?? config.generation.chapterWordCount;
    const engine = resolveEngine(body);
    const budget: { [key: string]: boolean | number } = {
      qualityGate: false,
      maxRevise: body.maxRevise ?? 0,
    };
    if (typeof body.maxCostRmb === 'number' && Number.isFinite(body.maxCostRmb)) {
      budget.maxCostRmb = body.maxCostRmb;
    }

    const jobId = createJob(db, {
      type: 'chapter',
      projectId: id,
      fromChapter: body.from,
      toChapter: body.to,
      qualityGate: false,
      maxRevise: body.maxRevise ?? 0,
      engine: engine.name,
      model: body.model ?? engine.name,
      wordCount,
      promptVersion: 'chapter-v1',
      input: {
        from: body.from,
        to: body.to,
        wordCount,
        engineName: body.engineName ?? engine.name,
        model: body.model ?? engine.name,
        promptVersion: 'chapter-v1',
      },
      budget,
    }, async (ctx: JobRunnerContext) => {
      const { onProgress, control } = ctx;
      updateProjectStatus(db, id, 'writing');
      const { outcomes } = await writer.generateChapterRange({
        projectId: projectId(id),
        from: body.from,
        to: body.to,
        engine,
        wordCount,
        existingJobId: ctx.job.id,
        engineName: body.engineName ?? engine.name,
        model: body.model ?? engine.name,
        budget,
        onProgress,
        control,
        ownerId: 'web',
      });
      completeProjectIfFullyWritten(db, id);
      return { chapters: outcomes.length };
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

  // ─── 继续 job（同 jobId 经 WriterApplication.resumeJobId；配置绑定快照）──
  app.post('/jobs/:jobId/resume', async (c) => {
    const oldJobId = c.req.param('jobId');
    const oldRow = getJobRowDb(db, oldJobId);
    if (!oldRow) return c.json({ error: 'job 不存在' }, 404);
    if (oldRow.type !== 'chapter') return c.json({ error: '仅 chapter 类型支持 resume' }, 400);

    const project = getProject(db, oldRow.projectId);
    if (!project) return c.json({ error: '项目不存在' }, 404);

    // Body overrides are ignored; resume binds to the stored job snapshot.
    await c.req.json().catch(() => ({}));

    let snapshot;
    try {
      snapshot = readJobResumeConfig(db, oldJobId);
    } catch (error: unknown) {
      return c.json({ error: error instanceof Error ? error.message : '无法读取 job 配置' }, 400);
    }

    const resumeFrom = Math.max(snapshot.scope.from, snapshot.lastOutlinePosition + 1);
    const resumeTo = snapshot.scope.to;
    if (resumeFrom > resumeTo) {
      const { projectCompleted } = finalizeExhaustedResumeJob(db, {
        projectId: oldRow.projectId,
        jobId: oldJobId,
      });
      return c.json({
        error: '全部章节已完成',
        jobId: oldJobId,
        projectCompleted,
      }, 400);
    }

    const engine = resolveEngine({
      engineName: snapshot.engine,
      model: snapshot.model,
    });

    const attached = attachJobRunner(db, oldJobId, async (ctx: JobRunnerContext) => {
      const { onProgress, control } = ctx;
      updateProjectStatus(db, oldRow.projectId, 'writing');
      const { outcomes } = await writer.generateChapterRange({
        projectId: projectId(oldRow.projectId),
        from: snapshot.scope.from,
        to: snapshot.scope.to,
        resumeJobId: oldJobId,
        engine,
        wordCount: snapshot.wordCount,
        onProgress,
        control,
        ownerId: 'web',
      });
      completeProjectIfFullyWritten(db, oldRow.projectId);
      return { chapters: outcomes.length, resumedFrom: oldJobId };
    });
    if (!attached) return c.json({ error: '无法恢复 job' }, 400);
    return c.json({ jobId: oldJobId, resumedFrom: oldJobId });
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
    return c.json({ job: jobToClientPayload(row) });
  });

  // ─── job 状态查询 ──────────────────────────────────────────────
  app.get('/jobs/:jobId', (c) => {
    const jobId = c.req.param('jobId');
    const job = getJob(jobId) ?? hydrateJobFromDb(db, jobId);
    if (!job) {
      const row = getJobRowDb(db, jobId);
      if (!row) return c.json({ error: 'job 不存在' }, 404);
      return c.json(jobToClientPayload(row));
    }
    return c.json(jobToClientPayload(job));
  });

  // ─── SSE 进度流 ────────────────────────────────────────────────
  app.get('/jobs/:jobId/events', (c) => {
    const jobId = c.req.param('jobId');
    const afterSeq = Math.max(
      parseAfterSeq(c.req.query('after')),
      parseAfterSeq(c.req.header('Last-Event-ID') ?? undefined),
    );

    let job = getJob(jobId);
    if (!job) job = hydrateJobFromDb(db, jobId);
    if (!job) {
      const row = getJobRowDb(db, jobId);
      if (!row) return c.json({ error: 'job 不存在' }, 404);
      return streamSSE(c, async (stream) => {
        const persisted = listJobEventsAfter(db, jobId, afterSeq);
        for (const evt of persisted) {
          await stream.writeSSE({
            id: String(evt.seq),
            data: JSON.stringify({
              seq: evt.seq,
              step: evt.step,
              msg: evt.msg,
              ts: evt.ts,
            }),
          });
        }
        if (row.status === 'paused') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'paused' }) });
        } else if (row.status === 'cancelled') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'cancelled' }) });
        } else if (row.status === 'completed') {
          await stream.writeSSE({
            data: JSON.stringify({
              event: 'completed',
              result: jobToClientPayload(row).result,
            }),
          });
        } else if (row.status === 'failed') {
          await stream.writeSSE({
            data: JSON.stringify({ event: 'failed', error: row.errorType }),
          });
        }
      });
    }

    return streamSSE(c, async (stream) => {
      const persisted = listJobEventsAfter(db, jobId, afterSeq);
      const seen = new Set<number>();
      for (const evt of persisted) {
        seen.add(evt.seq);
        await stream.writeSSE({
          id: String(evt.seq),
          data: JSON.stringify({
            seq: evt.seq,
            step: evt.step,
            msg: evt.msg,
            ts: evt.ts,
          }),
        });
      }
      for (const evt of job.events) {
        if (evt.seq <= afterSeq || seen.has(evt.seq)) continue;
        await stream.writeSSE({
          id: String(evt.seq),
          data: JSON.stringify(evt),
        });
      }

      const onProgress = (evt: { seq: number; step: string; msg: string; ts: number }) => {
        if (evt.seq <= afterSeq) return;
        stream.writeSSE({
          id: String(evt.seq),
          data: JSON.stringify(evt),
        }).catch(() => {});
      };
      const onCompleted = (result: unknown) => {
        stream.writeSSE({ data: JSON.stringify({ event: 'completed', result }) }).catch(() => {});
      };
      const onFailed = (error: string) => {
        stream.writeSSE({ data: JSON.stringify({ event: 'failed', error }) }).catch(() => {});
      };
      const onPaused = () => {
        stream.writeSSE({ data: JSON.stringify({ event: 'paused' }) }).catch(() => {});
      };
      const onCancelled = () => {
        stream.writeSSE({ data: JSON.stringify({ event: 'cancelled' }) }).catch(() => {});
      };

      job.emitter.on('progress', onProgress);
      job.emitter.once('completed', onCompleted);
      job.emitter.once('failed', onFailed);
      job.emitter.once('paused', onPaused);
      job.emitter.once('cancelled', onCancelled);

      if (job.status !== 'running') {
        if (job.status === 'completed') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'completed', result: job.result }) });
        } else if (job.status === 'failed') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'failed', error: job.error }) });
        } else if (job.status === 'paused') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'paused' }) });
        } else if (job.status === 'cancelled') {
          await stream.writeSSE({ data: JSON.stringify({ event: 'cancelled' }) });
        }

        job.emitter.off('progress', onProgress);
        job.emitter.off('completed', onCompleted);
        job.emitter.off('failed', onFailed);
        job.emitter.off('paused', onPaused);
        job.emitter.off('cancelled', onCancelled);
        return;
      }

      stream.onAbort(() => {
        job.emitter.off('progress', onProgress);
        job.emitter.off('completed', onCompleted);
        job.emitter.off('failed', onFailed);
        job.emitter.off('paused', onPaused);
        job.emitter.off('cancelled', onCancelled);
      });
    });
  });

  return app;
}
