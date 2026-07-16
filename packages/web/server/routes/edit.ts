/**
 * 编辑路由 — PUT 章节正文（经 WriterApplication.publishChapterEdit）
 *
 * 端点：
 *   PUT /api/projects/:id/chapters/:n
 *     body: EditChapterRequest { content, title?, state, delta, model?, promptVersion? }
 *       或 { content, title?, extract: true, model?, promptVersion? }
 *
 * 普通编辑必须由客户端显式提供 state + delta；extract=true 时由服务端抽取，仍不得写空壳。
 */
import { Hono } from 'hono';
import { createEngine, parseEditChapterRequest, countChars } from '@novel-eval/shared';
import {
  extractStoryState,
  getOutline,
  projectId,
  WriterApplication,
  ValidationError,
  type DB,
  type StoryState,
  type StoryStateDelta,
} from '@novel-eval/writer';
import type { EngineRegistry } from '../engine-registry.ts';
import { httpErrorJson, toHttpError } from '../middleware/error-mapper.ts';

type ExtractState = Parameters<WriterApplication['publishChapterEditWithExtract']>[0]['extractState'];

export interface EditRoutesOptions {
  extractState?: ExtractState;
  registry?: EngineRegistry;
}

function defaultExtractState(
  registry: EngineRegistry | undefined,
  model: string | undefined,
  promptVersion: string,
): ExtractState {
  if (!registry) {
    throw new ValidationError('extract edit requires an engine registry or injected extractState');
  }
  const activeConfig = registry.getActiveConfig();
  const engine = model === undefined
    ? registry.getEngine()
    : createEngine({ ...activeConfig, model });
  return async (input) => extractStoryState({
    engine,
    previousState: input.previousState,
    chapterTitle: input.title,
    chapterContent: input.content,
    chapterRevisionId: input.chapterRevisionId,
    outlinePosition: input.outlinePosition,
    promptVersion,
  });
}

export function editRoutes(db: DB, application?: WriterApplication, options: EditRoutesOptions = {}) {
  const app = new Hono();
  const writer = application ?? new WriterApplication(db, { defaultOwnerId: 'web' });

  app.put('/:id/chapters/:n', async (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      const mapped = toHttpError(new ValidationError('请求体必须是合法 JSON'));
      return c.json(httpErrorJson(mapped), mapped.status as 400);
    }

    const parsed = parseEditChapterRequest(raw);
    if (!parsed.ok) {
      const mapped = toHttpError(new ValidationError(parsed.message));
      return c.json(httpErrorJson(mapped), mapped.status as 400);
    }
    const body = parsed.data;

    const outline = getOutline(db, id, n);
    if (!outline) return c.json({ error: '蓝图不存在', code: 'NotFound', message: '蓝图不存在' }, 404);

    try {
      const promptVersion = body.promptVersion ?? 'state-v1';
      const title = body.title?.trim() || outline.title;
      const brandedProjectId = projectId(id);
      const published = body.extract === true
        ? await writer.publishChapterEditWithExtract({
            projectId: brandedProjectId,
            outlinePosition: n,
            title,
            content: body.content,
            extractState: options.extractState ?? defaultExtractState(options.registry, body.model, promptVersion),
            model: body.model ?? 'manual-edit',
            promptVersion,
            source: 'manual',
            ownerId: 'web',
          })
        : await writer.publishChapterEdit({
            projectId: brandedProjectId,
            outlinePosition: n,
            title,
            content: body.content,
            state: body.state as StoryState,
            delta: body.delta as StoryStateDelta,
            model: body.model ?? 'manual-edit',
            promptVersion,
            source: 'manual',
            ownerId: 'web',
          });

      return c.json({
        number: n,
        wordCount: countChars(body.content),
        saved: true,
        chapterRevisionId: published.chapterRevisionId,
        storyStateRevisionId: published.storyStateRevisionId,
        staleImpact: published.staleImpact,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'publish edit failed';
      if (message.includes('No outline') || message.includes('蓝图')) {
        return c.json({ error: '蓝图不存在', code: 'NotFound', message: '蓝图不存在' }, 404);
      }
      const mapped = toHttpError(error);
      return c.json(httpErrorJson(mapped), mapped.status as 400 | 402 | 409 | 422 | 500);
    }
  });

  return app;
}
