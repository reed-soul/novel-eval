/**
 * 修正路由 — 经验驱动的局部修正（单章）
 *
 * 端点：
 *   GET  /api/projects/:id/chapters/:n/diagnose           只读诊断（本章得分+重复+经验，零 LLM）
 *   POST /api/projects/:id/chapters/:n/correct            触发修正 job（返回 jobId，走现有 SSE）
 *   GET  /api/projects/:id/chapters/:n/correction         取该章最新 pending 草稿（diff 预览用）
 *   POST /api/projects/:id/corrections/:draftId/adopt     采纳（覆盖原文 + 反哺经验）
 *   POST /api/projects/:id/corrections/:draftId/discard   放弃（无副作用）
 *
 * 进度/完成事件复用现有 GET /api/jobs/:jobId/events。
 */
import { Hono } from 'hono';
import { createEngine, type NovelMetadata } from '@novel-eval/shared';
import {
  type DB, getProject, countChapters, getChapter,
  correctChapter, applyCorrectionDraft, discardCorrectionDraft,
  getPendingDraft, getDraft, diagnoseChapter,
  type CorrectionStrategy,
} from '@novel-eval/writer';
import { createJob, hasActiveJobForProject, type JobRunnerContext } from '../jobs.ts';
import type { EngineRegistry } from '../engine-registry.ts';

export function correctionRoutes(db: DB, registry: EngineRegistry) {
  const app = new Hono();

  function resolveEngine(body: { engineName?: string; model?: string }) {
    if (body.engineName) {
      const baseConfig = registry.getEngineConfig(body.engineName);
      if (baseConfig) {
        return createEngine({ ...baseConfig, model: body.model ?? baseConfig.model });
      }
    }
    return registry.getEngine();
  }

  // ─── 只读诊断（本章：得分+重复检测+推荐策略，零 LLM）──────────────
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

  // ─── 触发修正 job ──────────────────────────────────────────────────
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

    const jobId = createJob(db, {
      type: 'correction', projectId: id,
      fromChapter: n, toChapter: n,
    }, async ({ onProgress }: JobRunnerContext) => {
      const result = await correctChapter({
        engine: resolveEngine(body), db, projectId: id, chapterNumber: n,
        metadata, strategy: body.strategy, onProgress,
      });
      return result;
    });
    return c.json({ jobId });
  });

  // ─── 取该章最新 pending 草稿 ───────────────────────────────────────
  app.get('/:id/chapters/:n/correction', (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    if (isNaN(n)) return c.json({ error: '章号无效' }, 400);
    const draft = getPendingDraft(db, id, n);
    if (!draft) return c.json({ draft: null });
    return c.json({ draft });
  });

  // ─── 采纳 ──────────────────────────────────────────────────────────
  app.post('/:id/corrections/:draftId/adopt', (c) => {
    const id = c.req.param('id');
    const draftId = c.req.param('draftId');
    const draft = getDraft(db, draftId);
    if (!draft || draft.projectId !== id) return c.json({ error: '草稿不存在' }, 404);
    try {
      const { chapterNumber } = applyCorrectionDraft(db, draftId);
      return c.json({ ok: true, chapterNumber });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  // ─── 放弃 ──────────────────────────────────────────────────────────
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
