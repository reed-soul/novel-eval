import { Hono } from 'hono';
import {
  getAllOutlines,
  getChapter,
  getProject,
  projectId,
  StoryStateRepository,
  WriterApplication,
  type DB,
  type StoryState,
  type StoryStateDelta,
} from '@novel-eval/writer';
import { httpErrorJson, toHttpError } from '../middleware/error-mapper.ts';

type StoryStateRevision = NonNullable<ReturnType<StoryStateRepository['getCurrent']>>;

export interface StoryStateRevisionDto {
  storyStateRevisionId: string;
  projectId: string;
  chapterId: string;
  chapterRevisionId: string;
  previousStateRevisionId: string | null;
  outlinePosition: number;
  status: StoryStateRevision['status'];
  state: StoryState;
  delta: StoryStateDelta;
  summary: string;
  model: string;
  promptVersion: string;
  createdAt: string;
}

export function toStoryStateRevisionDto(revision: StoryStateRevision): StoryStateRevisionDto {
  return {
    storyStateRevisionId: revision.id,
    projectId: revision.projectId,
    chapterId: revision.chapterId,
    chapterRevisionId: revision.chapterRevisionId,
    previousStateRevisionId: revision.previousStateRevisionId,
    outlinePosition: revision.sequence,
    status: revision.status,
    state: revision.state,
    delta: revision.delta,
    summary: revision.summary,
    model: revision.model,
    promptVersion: revision.promptVersion,
    createdAt: revision.createdAt,
  };
}

export function latestWrittenOutlinePosition(db: DB, rawProjectId: string): number | null {
  const outlines = getAllOutlines(db, rawProjectId);
  let latest: number | null = null;
  for (const outline of outlines) {
    if (getChapter(db, rawProjectId, outline.number)) {
      latest = latest === null ? outline.number : Math.max(latest, outline.number);
    }
  }
  return latest;
}

export function listCurrentStoryStateDtos(db: DB, rawProjectId: string): StoryStateRevisionDto[] {
  const latest = latestWrittenOutlinePosition(db, rawProjectId);
  if (latest === null) return [];

  const revisions = new StoryStateRepository(db)
    .listCurrentFromPosition(projectId(rawProjectId), 1)
    .filter((revision) => revision.sequence <= latest);
  return revisions.map(toStoryStateRevisionDto);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function storyStateRoutes(db: DB, application?: WriterApplication) {
  const app = new Hono();
  const writer = application ?? new WriterApplication(db, { defaultOwnerId: 'web' });

  app.get('/:id/story-state', (c) => {
    const id = c.req.param('id');
    if (!getProject(db, id)) {
      return c.json({ error: '项目不存在', code: 'NotFound', message: '项目不存在' }, 404);
    }

    const currentStates = listCurrentStoryStateDtos(db, id);
    return c.json({
      projectId: id,
      latestWrittenOutlinePosition: latestWrittenOutlinePosition(db, id),
      current: currentStates.at(-1) ?? null,
      currentStates,
    });
  });

  app.get('/:id/stale-impact', (c) => {
    const id = c.req.param('id');
    if (!getProject(db, id)) {
      return c.json({ error: '项目不存在', code: 'NotFound', message: '项目不存在' }, 404);
    }

    const from = parsePositiveInteger(
      c.req.query('fromOutlinePosition') ?? c.req.query('from'),
      1,
    );
    if (from === null) {
      return c.json({
        error: 'fromOutlinePosition must be a positive integer',
        code: 'ValidationError',
        message: 'fromOutlinePosition must be a positive integer',
      }, 400);
    }

    try {
      const impact = writer.getStaleImpact(projectId(id), from);
      return c.json({
        projectId: id,
        fromOutlinePosition: from,
        ...impact,
      });
    } catch (error: unknown) {
      const mapped = toHttpError(error);
      return c.json(httpErrorJson(mapped), mapped.status as 400 | 402 | 409 | 422 | 500);
    }
  });

  return app;
}
