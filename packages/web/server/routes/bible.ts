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
    const active = new PlanningRepository(db).getActiveBibleForProject(projectId(id));
    if (!active) return c.json({ error: 'bible 不存在' }, 404);
    const doc = active.bible as Record<string, unknown>;
    return c.json({
      revisionId: active.id,
      coreSeed: doc.coreSeed ?? null,
      characterDynamics: doc.characterDynamics ?? null,
      characterState: (doc.characterState ?? null) as BibleCharacterState | null,
      worldBuilding: doc.worldBuilding ?? null,
      plotArchitecture: (doc.plotArchitecture ?? null) as PlotArchitecture | null,
      fullText: typeof doc.fullText === 'string' ? doc.fullText : active.compiledText,
      revisionNumber: active.revisionNumber,
      status: active.status,
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
      return c.json({ error: error instanceof Error ? error.message : 'approval failed' }, 400);
    }
  });

  return app;
}
