import { Hono, type Context } from 'hono';
import { createEngine, isRecord } from '@novel-eval/shared';
import {
  extractStoryState,
  getProject,
  projectId,
  StoryStateRepository,
  ValidationError,
  WriterApplication,
  type DB,
} from '@novel-eval/writer';
import type { EngineRegistry } from '../engine-registry.ts';
import { httpErrorJson, toHttpError } from '../middleware/error-mapper.ts';
import { listCurrentStoryStateDtos, latestWrittenOutlinePosition } from './story-state.ts';

type ExtractState = Parameters<WriterApplication['rebuildStoryState']>[0]['extractState'];

export interface RebuildRoutesOptions {
  application?: WriterApplication;
  extractState?: ExtractState;
  registry?: EngineRegistry;
}

interface RebuildRequest {
  fromOutlinePosition?: number;
  engineName?: string;
  model?: string;
}

function parseRebuildRequest(raw: unknown): RebuildRequest {
  if (!isRecord(raw)) return {};

  const request: RebuildRequest = {};
  if (raw.fromOutlinePosition !== undefined) {
    if (
      typeof raw.fromOutlinePosition !== 'number'
      || !Number.isInteger(raw.fromOutlinePosition)
      || raw.fromOutlinePosition <= 0
    ) {
      throw new ValidationError('fromOutlinePosition must be a positive integer');
    }
    request.fromOutlinePosition = raw.fromOutlinePosition;
  }
  if (typeof raw.engineName === 'string') request.engineName = raw.engineName;
  if (typeof raw.model === 'string') request.model = raw.model;
  return request;
}

async function readOptionalJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function chooseFromOutlinePosition(
  writer: WriterApplication,
  states: StoryStateRepository,
  id: ReturnType<typeof projectId>,
  requested: number | undefined,
): number {
  if (requested !== undefined) return requested;
  const firstAffected = writer.getStaleImpact(id, 1).affectedOutlinePositions[0];
  if (firstAffected !== undefined) return firstAffected;
  return (states.getCurrent(id)?.sequence ?? 0) + 1;
}

function defaultExtractState(registry: EngineRegistry | undefined, request: RebuildRequest): ExtractState {
  if (!registry) {
    throw new ValidationError('rebuild requires an engine registry or injected extractState');
  }
  const engine = (() => {
    if (request.engineName) {
      const config = registry.getEngineConfig(request.engineName);
      if (config) return createEngine({ ...config, model: request.model ?? config.model });
    }
    return registry.getEngine();
  })();

  return async (input) => extractStoryState({
    engine,
    previousState: input.previousState,
    chapterTitle: input.title,
    chapterContent: input.content,
    chapterRevisionId: input.chapterRevisionId,
    outlinePosition: input.outlinePosition,
  });
}

export function rebuildRoutes(db: DB, options: RebuildRoutesOptions = {}) {
  const app = new Hono();
  const writer = options.application ?? new WriterApplication(db, { defaultOwnerId: 'web' });
  const states = new StoryStateRepository(db);

  app.post('/:id/rebuilds', async (c) => {
    const id = c.req.param('id');
    if (!getProject(db, id)) {
      return c.json({ error: '项目不存在', code: 'NotFound', message: '项目不存在' }, 404);
    }

    try {
      const body = parseRebuildRequest(await readOptionalJson(c));
      const branded = projectId(id);
      const fromOutlinePosition = chooseFromOutlinePosition(
        writer,
        states,
        branded,
        body.fromOutlinePosition,
      );
      const extractState = options.extractState ?? defaultExtractState(options.registry, body);
      const result = await writer.rebuildStoryState({
        projectId: branded,
        fromOutlinePosition,
        extractState,
        ownerId: 'web',
      });

      return c.json({
        projectId: id,
        fromOutlinePosition,
        latestWrittenOutlinePosition: latestWrittenOutlinePosition(db, id),
        ...result,
        currentStates: listCurrentStoryStateDtos(db, id),
      });
    } catch (error: unknown) {
      const mapped = toHttpError(error);
      return c.json(httpErrorJson(mapped), mapped.status as 400 | 402 | 409 | 422 | 500);
    }
  });

  return app;
}
