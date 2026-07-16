/**
 * 编辑路由 — PUT 章节正文（经 WriterApplication.publishChapterEdit）
 *
 * 端点：
 *   PUT /api/projects/:id/chapters/:n
 *     body: { content, title?, state, delta, model?, promptVersion? }
 *
 * state + delta 必须由客户端显式提供；缺省不得写空壳 story state。
 */
import { Hono } from 'hono';
import {
  getOutline,
  projectId,
  WriterApplication,
  type DB,
  type StoryState,
  type StoryStateDelta,
} from '@novel-eval/writer';
import { countChars } from '@novel-eval/shared';

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

export function editRoutes(db: DB, application?: WriterApplication) {
  const app = new Hono();
  const writer = application ?? new WriterApplication(db, { defaultOwnerId: 'web' });

  app.put('/:id/chapters/:n', async (c) => {
    const id = c.req.param('id');
    const n = parseInt(c.req.param('n'), 10);
    const body = await c.req.json<{
      content: string;
      title?: string;
      state?: unknown;
      delta?: unknown;
      model?: string;
      promptVersion?: string;
    }>();

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: '正文不能为空' }, 400);
    }

    if (!isStoryState(body.state) || !isStoryStateDelta(body.delta)) {
      return c.json({
        error: '编辑必须提供有效的 state 与 delta；禁止缺省写入空壳 story state',
      }, 400);
    }

    const outline = getOutline(db, id, n);
    if (!outline) return c.json({ error: '蓝图不存在' }, 404);

    try {
      const published = await writer.publishChapterEdit({
        projectId: projectId(id),
        outlinePosition: n,
        title: body.title?.trim() || outline.title,
        content: body.content,
        state: body.state,
        delta: body.delta,
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
        return c.json({ error: '蓝图不存在' }, 404);
      }
      return c.json({ error: message }, 400);
    }
  });

  return app;
}
