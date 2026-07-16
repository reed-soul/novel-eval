/**
 * 编辑路由 — PUT 章节正文（经 WriterApplication.publishChapterEdit）
 *
 * 端点：
 *   PUT /api/projects/:id/chapters/:n
 *     body: EditChapterRequest { content, title?, state, delta, model?, promptVersion? }
 *
 * state + delta 必须由客户端显式提供；缺省不得写空壳 story state。
 */
import { Hono } from 'hono';
import { parseEditChapterRequest, countChars } from '@novel-eval/shared';
import {
  getOutline,
  projectId,
  WriterApplication,
  ValidationError,
  type DB,
  type StoryState,
  type StoryStateDelta,
} from '@novel-eval/writer';
import { httpErrorJson, toHttpError } from '../middleware/error-mapper.ts';

export function editRoutes(db: DB, application?: WriterApplication) {
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
      const published = await writer.publishChapterEdit({
        projectId: projectId(id),
        outlinePosition: n,
        title: body.title?.trim() || outline.title,
        content: body.content,
        state: body.state as StoryState,
        delta: body.delta as StoryStateDelta,
        model: body.model ?? 'manual-edit',
        promptVersion: body.promptVersion ?? 'state-v1',
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
