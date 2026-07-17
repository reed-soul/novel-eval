/**
 * Finalize a kept draft chapter revision (extract + publish, no regen).
 *
 * POST /:id/revisions/:revisionId/finalize
 */
import { Hono } from 'hono';
import { createEngine } from '@novel-eval/shared';
import {
  extractStoryState,
  projectId,
  WriterApplication,
  ValidationError,
  chapterRevisionId,
  type DB,
} from '@novel-eval/writer';
import type { EngineRegistry } from '../engine-registry.ts';
import { httpErrorJson, toHttpError } from '../middleware/error-mapper.ts';

type ExtractState = Parameters<WriterApplication['finalizeDraftRevision']>[0]['extractState'];

export interface FinalizeRoutesOptions {
  extractState?: ExtractState;
  registry?: EngineRegistry;
}

function defaultExtractState(
  registry: EngineRegistry | undefined,
  model: string | undefined,
  promptVersion: string,
): ExtractState {
  if (!registry) {
    throw new ValidationError('finalize requires an engine registry or injected extractState');
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

export function finalizeRoutes(
  db: DB,
  application?: WriterApplication,
  options: FinalizeRoutesOptions = {},
) {
  const app = new Hono();
  const writer = application ?? new WriterApplication(db, { defaultOwnerId: 'web' });

  app.post('/:id/revisions/:revisionId/finalize', async (c) => {
    const id = c.req.param('id');
    const revisionId = c.req.param('revisionId');
    let body: { model?: string; promptVersion?: string; extractAttempts?: number } = {};
    try {
      body = await c.req.json().catch(() => ({}));
    } catch {
      body = {};
    }

    const promptVersion = body.promptVersion ?? 'state-v1';
    try {
      const extractState = options.extractState
        ?? defaultExtractState(options.registry, body.model, promptVersion);
      const published = await writer.finalizeDraftRevision({
        projectId: projectId(id),
        candidateRevisionId: chapterRevisionId(revisionId),
        extractState,
        extractAttempts: body.extractAttempts,
        model: body.model,
        promptVersion,
      });
      return c.json({
        chapterRevisionId: published.chapterRevisionId,
        storyStateRevisionId: published.storyStateRevisionId,
        outlineStatus: published.outlineStatus,
        staleImpact: published.staleImpact,
      });
    } catch (error: unknown) {
      const mapped = toHttpError(error);
      return c.json(httpErrorJson(mapped), mapped.status as 400 | 402 | 409 | 422 | 500);
    }
  });

  return app;
}
