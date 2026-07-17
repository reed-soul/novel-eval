/**
 * Revision tasks — reviewable checklist from evaluation suggestions.
 *
 * POST   /:id/revision-tasks/from-eval
 * GET    /:id/revision-tasks?status=
 * GET    /:id/revision-tasks/:taskId
 * PATCH  /:id/revision-tasks/:taskId  { status }
 */
import { Hono } from 'hono';
import {
  type DB,
  RevisionTaskService,
  isRevisionTaskStatus,
  REVISION_TASK_STATUSES,
  ValidationError,
} from '@novel-eval/writer';
import { httpErrorJson, toHttpError } from '../middleware/error-mapper.ts';

function mapError(error: unknown): Response {
  if (error instanceof ValidationError && /not found/i.test(error.message)) {
    const mapped = { status: 404, code: 'NotFound', message: error.message };
    return Response.json(httpErrorJson(mapped), { status: 404 });
  }
  const mapped = toHttpError(error);
  return Response.json(
    httpErrorJson(mapped),
    { status: mapped.status as 400 | 402 | 409 | 422 | 500 },
  );
}

export function revisionTaskRoutes(db: DB) {
  const app = new Hono();
  const service = new RevisionTaskService(db);

  app.post('/:id/revision-tasks/from-eval', async (c) => {
    const projectId = c.req.param('id');
    let body: {
      suggestions?: unknown[];
      result?: { suggestions?: unknown[] } | null;
      sourceEvalTaskId?: string | null;
      replaceOpen?: boolean;
      maxSuggestions?: number;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body', code: 'ValidationError', message: 'Invalid JSON body' }, 400);
    }

    try {
      const outcome = service.importFromEval({
        projectId,
        suggestions: body.suggestions,
        result: body.result,
        sourceEvalTaskId: body.sourceEvalTaskId,
        replaceOpen: body.replaceOpen === true,
        maxSuggestions: typeof body.maxSuggestions === 'number'
          ? body.maxSuggestions
          : undefined,
      });
      return c.json({
        tasks: outcome.created,
        createdCount: outcome.created.length,
        dismissedOpenCount: outcome.dismissedOpenCount,
      }, 201);
    } catch (error: unknown) {
      return mapError(error);
    }
  });

  app.get('/:id/revision-tasks', (c) => {
    const projectId = c.req.param('id');
    const statusQuery = c.req.query('status');
    try {
      if (statusQuery !== undefined && statusQuery !== '' && !isRevisionTaskStatus(statusQuery)) {
        throw new ValidationError(
          `invalid status: ${statusQuery}; expected one of ${REVISION_TASK_STATUSES.join(', ')}`,
        );
      }
      const tasks = service.list(
        projectId,
        statusQuery && isRevisionTaskStatus(statusQuery) ? { status: statusQuery } : undefined,
      );
      return c.json({ tasks });
    } catch (error: unknown) {
      return mapError(error);
    }
  });

  app.get('/:id/revision-tasks/:taskId', (c) => {
    const projectId = c.req.param('id');
    const taskId = c.req.param('taskId');
    try {
      const task = service.get(projectId, taskId);
      if (!task) {
        return c.json({ error: 'revision task not found', code: 'NotFound', message: 'revision task not found' }, 404);
      }
      return c.json({ task });
    } catch (error: unknown) {
      return mapError(error);
    }
  });

  app.patch('/:id/revision-tasks/:taskId', async (c) => {
    const projectId = c.req.param('id');
    const taskId = c.req.param('taskId');
    let body: { status?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body', code: 'ValidationError', message: 'Invalid JSON body' }, 400);
    }

    try {
      if (!isRevisionTaskStatus(body.status)) {
        throw new ValidationError(
          `invalid status: ${String(body.status)}; expected one of ${REVISION_TASK_STATUSES.join(', ')}`,
        );
      }
      const task = service.setStatus({ projectId, taskId, status: body.status });
      return c.json({ task });
    } catch (error: unknown) {
      return mapError(error);
    }
  });

  app.post('/:id/revision-tasks/:taskId/open-correction', (c) => {
    const projectId = c.req.param('id');
    const taskId = c.req.param('taskId');
    try {
      const opened = service.openCorrection({ projectId, taskId });
      return c.json(opened);
    } catch (error: unknown) {
      return mapError(error);
    }
  });

  return app;
}
