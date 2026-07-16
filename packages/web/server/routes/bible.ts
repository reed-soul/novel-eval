/** Bible 路由 — GET bible 设定（读 active story_bible_revision） */
import { Hono } from 'hono';
import {
  getBibleForChapter,
  PlanningRepository,
  WriterApplication,
  projectId,
  type DB,
  type BibleCharacterState,
  type PlotArchitecture,
} from '@novel-eval/writer';
import { httpErrorJson, toHttpError } from '../middleware/error-mapper.ts';

export function bibleRoutes(db: DB) {
  const app = new Hono();
  const writer = new WriterApplication(db, { defaultOwnerId: 'web' });

  app.get('/:id/bible', (c) => {
    const id = c.req.param('id');
    try {
      const { fullText, characterState, plotArchitecture } = getBibleForChapter(db, id);
      return c.json({ fullText, characterState, plotArchitecture });
    } catch {
      return c.json({ error: 'bible 未完成' }, 404);
    }
  });

  app.get('/:id/bible/raw', (c) => {
    const id = c.req.param('id');
    const planning = new PlanningRepository(db);
    // Prefer the active approved bible; otherwise expose the latest draft so
    // PlanningApproval can approve newly generated revisions.
    const revision = planning.getActiveBibleForProject(projectId(id))
      ?? planning.getDraftBibleForProject(projectId(id));
    if (!revision) return c.json({ error: 'bible 不存在' }, 404);
    const doc = revision.bible as Record<string, unknown>;
    return c.json({
      revisionId: revision.id,
      coreSeed: doc.coreSeed ?? null,
      characterDynamics: doc.characterDynamics ?? null,
      characterState: (doc.characterState ?? null) as BibleCharacterState | null,
      worldBuilding: doc.worldBuilding ?? null,
      plotArchitecture: (doc.plotArchitecture ?? null) as PlotArchitecture | null,
      fullText: typeof doc.fullText === 'string' ? doc.fullText : revision.compiledText,
      revisionNumber: revision.revisionNumber,
      status: revision.status,
    });
  });

  app.post('/:id/bible-revisions/:revisionId/approve', (c) => {
    const id = projectId(c.req.param('id'));
    const revisionId = c.req.param('revisionId');
    try {
      const { revision } = writer.approveBibleRevision({
        projectId: id,
        revisionId,
        ownerId: 'web',
      });
      return c.json({
        revision: {
          id: revision.id,
          projectId: revision.projectId,
          revisionNumber: revision.revisionNumber,
          status: revision.status,
          createdAt: revision.createdAt,
        },
      });
    } catch (error: unknown) {
      const mapped = toHttpError(error);
      return c.json(httpErrorJson(mapped), mapped.status as 400 | 402 | 409 | 422 | 500);
    }
  });

  return app;
}
