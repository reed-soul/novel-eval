/**
 * 修正路由 — 经验驱动的局部修正（单章）
 *
 * adopt 经 WriterApplication.adoptCorrectionDraft（持有 lease + publication）。
 */
import { Hono } from 'hono';
import { createEngine, type NovelMetadata } from '@novel-eval/shared';
import {
  type DB,
  getProject,
  countChapters,
  getChapter,
  correctChapter,
  discardCorrectionDraft,
  getPendingDraft,
  getDraft,
  diagnoseChapter,
  WriterApplication,
  projectId,
  type CorrectionStrategy,
  type StoryState,
  type StoryStateDelta,
} from '@novel-eval/writer';
import { createJob, hasActiveJobForProject, type JobRunnerContext } from '../jobs.ts';
import type { EngineRegistry } from '../engine-registry.ts';

function isStoryState(value: unknown): value is StoryState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.characters)
    && Array.isArray(record.facts)
    && Array.isArray(record.foreshadows)
    && Array.isArray(record.timeline)
    && typeof record.summary === 'string';
}

function isStoryStateDelta(value: unknown): value is StoryStateDelta {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.characterChanges)
    && Array.isArray(record.factChanges)
    && Array.isArray(record.foreshadowChanges)
    && Array.isArray(record.timelineEvents)
    && typeof record.summary === 'string';
}

export function correctionRoutes(
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
        return createEngine({ ...baseConfig, model: body.model ?? baseConfig.model });
      }
    }
    return registry.getEngine();
  }

  app.get('/:id/chapters/:n/diagnose', (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    if (isNaN(n)) return c.json({ error: '章号无效' }, 400);
    try {
      const diag = diagnoseChapter(db, id, n);
      return c.json({ diagnose: diag });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/:id/chapters/:n/correct', async (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    if (isNaN(n)) return c.json({ error: '章号无效' }, 400);

    const project = getProject(db, id);
    if (!project) return c.json({ error: '项目不存在' }, 404);
    if (countChapters(db, id) === 0) return c.json({ error: '项目尚无章节' }, 400);
    const chapter = getChapter(db, id, n);
    if (!chapter) return c.json({ error: `第 ${n} 章不存在，无法修正` }, 404);
    if (hasActiveJobForProject(id)) return c.json({ error: '项目有正在运行的任务' }, 409);

    const body = await c.req.json<{ engineName?: string; model?: string; strategy?: CorrectionStrategy }>()
      .catch(() => ({}) as { engineName?: string; model?: string; strategy?: CorrectionStrategy });
    const metadata: NovelMetadata = { genre: project.genreProfile, targetAudience: project.targetAudience };
    const engine = resolveEngine(body);

    const jobId = createJob(db, {
      type: 'correction',
      projectId: id,
      fromChapter: n,
      toChapter: n,
      engine: engine.name,
      model: body.model ?? engine.name,
    }, async ({ onProgress }: JobRunnerContext) => {
      const result = await correctChapter({
        engine,
        db,
        projectId: id,
        chapterNumber: n,
        metadata,
        strategy: body.strategy,
        onProgress,
      });
      return result;
    });
    return c.json({ jobId });
  });

  app.get('/:id/chapters/:n/correction', (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    if (isNaN(n)) return c.json({ error: '章号无效' }, 400);
    const draft = getPendingDraft(db, id, n);
    if (!draft) return c.json({ draft: null });
    return c.json({ draft });
  });

  app.post('/:id/corrections/:draftId/adopt', async (c) => {
    const id = c.req.param('id');
    const draftId = c.req.param('draftId');
    const draft = getDraft(db, draftId);
    if (!draft || draft.projectId !== id) return c.json({ error: '草稿不存在' }, 404);

    const body = await c.req.json<{
      state?: unknown;
      delta?: unknown;
      model?: string;
      promptVersion?: string;
    }>().catch(() => ({} as {
      state?: unknown;
      delta?: unknown;
      model?: string;
      promptVersion?: string;
    }));

    if (!isStoryState(body.state) || !isStoryStateDelta(body.delta)) {
      return c.json({
        error: '采纳必须提供有效的 state 与 delta；禁止缺省写入空壳 story state',
      }, 400);
    }

    try {
      const result = await writer.adoptCorrectionDraft({
        projectId: projectId(id),
        draftId,
        state: body.state,
        delta: body.delta,
        model: body.model ?? draft.engine ?? 'correction',
        promptVersion: body.promptVersion ?? 'state-v1',
        ownerId: 'web',
      });
      return c.json({
        ok: true,
        chapterNumber: result.chapterNumber,
        chapterRevisionId: result.publish.chapterRevisionId,
        storyStateRevisionId: result.publish.storyStateRevisionId,
        staleImpact: result.publish.staleImpact,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/:id/corrections/:draftId/discard', (c) => {
    const id = c.req.param('id');
    const draftId = c.req.param('draftId');
    const draft = getDraft(db, draftId);
    if (!draft || draft.projectId !== id) return c.json({ error: '草稿不存在' }, 404);
    try {
      discardCorrectionDraft(db, draftId);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  return app;
}
