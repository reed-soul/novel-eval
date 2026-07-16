import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

import { isRecord, type TokenUsage } from '@novel-eval/shared';
import {
  openDb,
  closeDb,
  createProject,
  outlineId,
  chapterRevisionId,
  foreshadowId,
  projectId,
  type ChapterRevisionId,
  type DB,
  type StoryState,
  type StoryStateDelta,
  type StoryStateRevisionId,
  applyStoryStateDelta,
  ChapterRepository,
  PlanningRepository,
  WriterApplication,
} from '@novel-eval/writer';
import { editRoutes } from '../../server/routes/edit.ts';
import { chapterRoutes } from '../../server/routes/chapters.ts';
import { evalRoutes } from '../../server/routes/eval.ts';

const fixtureTime = '2026-07-16T09:00:00.000Z';
const zeroUsage: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costRmb: 0,
  model: 'test-model',
  durationMs: 0,
};

let tempRoot: string;
let db: DB;

interface RebuildExtractInput {
  outlinePosition: number;
  previousState: StoryState | null;
  previousStateRevisionId: StoryStateRevisionId | null;
  chapterRevisionId: ChapterRevisionId;
  title: string;
  content: string;
}

interface RebuildExtractResult {
  state: StoryState;
  delta: StoryStateDelta;
  usage: TokenUsage;
  model: string;
  promptVersion: string;
}

interface RebuildRouteOptions {
  application: WriterApplication;
  extractState: (input: RebuildExtractInput) => Promise<RebuildExtractResult>;
}

type BasicRouteFactory = (database: DB) => Hono;
type RebuildRouteFactory = (database: DB, options: RebuildRouteOptions) => Hono;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-story-state-'));
  db = openDb({ path: join(tempRoot, 'writer.db') });
});

afterEach(() => {
  closeDb(db);
  rmSync(tempRoot, { recursive: true, force: true });
});

function emptyState(): StoryState {
  return {
    characters: [],
    facts: [],
    foreshadows: [],
    timeline: [],
    summary: '',
  };
}

function summaryDelta(summary: string): StoryStateDelta {
  return {
    characterChanges: [],
    factChanges: [],
    foreshadowChanges: [],
    timelineEvents: [],
    summary,
  };
}

function buildNextState(previous: StoryState | null, delta: StoryStateDelta): StoryState {
  return applyStoryStateDelta(previous ?? emptyState(), delta);
}

function seedOutline(database: DB, rawProjectId: string, position: number, title: string): void {
  const id = projectId(rawProjectId);
  new PlanningRepository(database).saveApprovedOutline({
    outline: {
      id: outlineId(`outline-${rawProjectId}-${position}`),
      projectId: id,
      position,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: `outline-revision-${rawProjectId}-${position}`,
      revisionNumber: 1,
      title,
      content: {
        summary: `${title}摘要摘要摘要摘要摘要摘要摘要摘要`,
        beats: ['铺垫'],
        act: position <= 2 ? 1 : 2,
        role: position === 1 ? '引入' : '推进',
        purpose: '推进主线并保持状态连续',
        suspenseLevel: 5,
        foreshadowing: position === 1 ? '失踪的车票' : '无',
        twistLevel: 1,
        beatLabel: position === 1 ? '铺垫' : '推进',
      },
      createdAt: fixtureTime,
    },
  });
}

async function publishChapterThroughFacade(input: {
  writer: WriterApplication;
  rawProjectId: string;
  position: number;
  content: string;
  delta: StoryStateDelta;
  previousState: StoryState | null;
}): Promise<StoryState> {
  const state = buildNextState(input.previousState, input.delta);
  await input.writer.publishChapterEdit({
    projectId: projectId(input.rawProjectId),
    outlinePosition: input.position,
    title: `第 ${input.position} 章`,
    content: input.content,
    state,
    delta: input.delta,
    model: 'test-model',
    promptVersion: 'state-v1',
    ownerId: 'test',
  });
  return state;
}

function isMissingModuleError(error: unknown): boolean {
  return error instanceof Error && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message);
}

async function optionalModule(importer: () => Promise<unknown>): Promise<Record<string, unknown> | null> {
  try {
    const module = await importer();
    return isRecord(module) ? module : null;
  } catch (error: unknown) {
    if (isMissingModuleError(error)) return null;
    throw error;
  }
}

async function mountOptionalBasicRoute(
  app: Hono,
  path: string,
  importer: () => Promise<unknown>,
  exportName: string,
  database: DB,
): Promise<void> {
  const module = await optionalModule(importer);
  const factory = module?.[exportName];
  if (typeof factory === 'function') {
    app.route(path, (factory as BasicRouteFactory)(database));
  }
}

async function mountOptionalRebuildRoute(
  app: Hono,
  importer: () => Promise<unknown>,
  database: DB,
  options: RebuildRouteOptions,
): Promise<void> {
  const module = await optionalModule(importer);
  const factory = module?.rebuildRoutes;
  if (typeof factory === 'function') {
    app.route('/api/projects', (factory as RebuildRouteFactory)(database, options));
  }
}

async function testApp(database: DB, writer: WriterApplication): Promise<Hono> {
  const app = new Hono();
  app.route('/api/projects', chapterRoutes(database));
  app.route('/api/projects', editRoutes(database, writer));
  app.route('/api/projects', evalRoutes(database));
  await mountOptionalBasicRoute(
    app,
    '/api/projects',
    () => import('../../server/routes/story-state.ts'),
    'storyStateRoutes',
    database,
  );
  await mountOptionalBasicRoute(
    app,
    '/api/chapters',
    () => import('../../server/routes/revisions.ts'),
    'revisionRoutes',
    database,
  );
  await mountOptionalRebuildRoute(
    app,
    () => import('../../server/routes/rebuilds.ts'),
    database,
    {
      application: writer,
      extractState: async (input) => {
        const delta = summaryDelta(`rebuilt-${input.outlinePosition}:${input.content}`);
        return {
          state: buildNextState(input.previousState, delta),
          delta,
          usage: zeroUsage,
          model: 'test-model',
          promptVersion: 'state-v1',
        };
      },
    },
  );
  return app;
}

async function readJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

async function fetchJson(app: Hono, path: string): Promise<{ status: number; json: unknown }> {
  const res = await app.fetch(new Request(`http://test${path}`));
  const json = await readJsonOrText(res);
  return { status: res.status, json };
}

async function postJson(app: Hono, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const json = await readJsonOrText(res);
  return { status: res.status, json };
}

describe('story-state routes', () => {
  it('exposes stale impact, chapter revisions, and rebuilds current states after a historical edit', async () => {
    const project = createProject(db, {
      title: 'T',
      genreProfile: '悬疑',
      targetAudience: '成人',
      premise: '一张失踪车票牵出旧案。',
    });
    seedOutline(db, project.id, 1, '第一章');
    seedOutline(db, project.id, 2, '第二章');
    seedOutline(db, project.id, 3, '第三章');

    const writer = new WriterApplication(db, {
      defaultOwnerId: 'test',
      now: () => new Date(fixtureTime),
    });
    const firstDelta: StoryStateDelta = {
      ...summaryDelta('状态-1'),
      foreshadowChanges: [{
        kind: 'open',
        foreshadow: {
          id: foreshadowId('ticket'),
          description: '失踪的车票',
          openedAtChapterRevisionId: chapterRevisionId('seed-open-ticket'),
          status: 'open',
        },
      }],
    };
    let previous = await publishChapterThroughFacade({
      writer,
      rawProjectId: project.id,
      position: 1,
      content: '第一章正文内容',
      delta: firstDelta,
      previousState: null,
    });
    previous = await publishChapterThroughFacade({
      writer,
      rawProjectId: project.id,
      position: 2,
      content: '第二章旧正文',
      delta: summaryDelta('状态-2'),
      previousState: previous,
    });
    await publishChapterThroughFacade({
      writer,
      rawProjectId: project.id,
      position: 3,
      content: '第三章正文',
      delta: summaryDelta('状态-3'),
      previousState: previous,
    });

    const app = await testApp(db, writer);
    const editState = buildNextState(previous, summaryDelta('状态-2-历史修订'));
    const editRes = await app.fetch(new Request(`http://test/api/projects/${project.id}/chapters/2`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '第二章历史修订正文',
        title: '第二章',
        state: editState,
        delta: summaryDelta('状态-2-历史修订'),
        model: 'manual-edit',
        promptVersion: 'state-v1',
      }),
    }));
    assert.equal(editRes.status, 200);

    const stale = await fetchJson(app, `/api/projects/${project.id}/stale-impact`);
    assert.equal(stale.status, 200);
    const staleBody = stale.json as { affectedOutlinePositions: number[] };
    // WriterApplication.getStaleImpact reports positions that still lack a current state.
    // The edited chapter 2 has a new current state, so only downstream chapter 3 is stale here.
    assert.deepEqual(staleBody.affectedOutlinePositions, [3]);

    const chapterTwo = new ChapterRepository(db).getByOutlinePosition(projectId(project.id), 2);
    assert.ok(chapterTwo);
    const revisions = await fetchJson(app, `/api/chapters/${chapterTwo.id}/revisions`);
    assert.equal(revisions.status, 200);
    const revisionBody = revisions.json as { revisions: Array<{ id: string; status: string; content: string }> };
    assert.ok(revisionBody.revisions.length >= 2);
    assert.equal(revisionBody.revisions.some((revision) => revision.content === '第二章历史修订正文'), true);

    new ChapterRepository(db).appendCandidate({
      chapterId: chapterTwo.id,
      revision: {
        id: chapterRevisionId(`draft-after-b4-${project.id}`),
        revisionNumber: 3,
        source: 'manual',
        parentRevisionId: chapterTwo.activeRevisionId,
        title: '草稿',
        content: '草稿正文不得通过 GET 返回',
        wordCount: 12,
        status: 'draft',
        generationRunId: null,
        createdAt: fixtureTime,
      },
    });
    const activeChapter = await fetchJson(app, `/api/projects/${project.id}/chapters/2`);
    assert.equal(activeChapter.status, 200);
    assert.equal((activeChapter.json as { content: string }).content, '第二章历史修订正文');

    const rebuild = await postJson(app, `/api/projects/${project.id}/rebuilds`, {});
    assert.equal(rebuild.status, 200);
    const rebuildBody = rebuild.json as {
      rebuiltOutlinePositions: number[];
      failedAtOutlinePosition: number | null;
      currentStates: Array<{ outlinePosition: number; summary: string; status: string }>;
    };
    assert.deepEqual(rebuildBody.rebuiltOutlinePositions, [3]);
    assert.equal(rebuildBody.failedAtOutlinePosition, null);
    assert.deepEqual(
      rebuildBody.currentStates.map((state) => [state.outlinePosition, state.summary, state.status]),
      [
        [1, '状态-1', 'current'],
        [2, '状态-2-历史修订', 'current'],
        [3, 'rebuilt-3:第三章正文', 'current'],
      ],
    );

    const storyState = await fetchJson(app, `/api/projects/${project.id}/story-state`);
    assert.equal(storyState.status, 200);
    const storyStateBody = storyState.json as {
      current: { outlinePosition: number; summary: string } | null;
      currentStates: Array<{ outlinePosition: number; summary: string }>;
    };
    assert.deepEqual(
      storyStateBody.currentStates.map((state) => [state.outlinePosition, state.summary]),
      [
        [1, '状态-1'],
        [2, '状态-2-历史修订'],
        [3, 'rebuilt-3:第三章正文'],
      ],
    );
    assert.equal(storyStateBody.current?.outlinePosition, 3);
  });

  it('uses current story-state ledger foreshadows on the eval dashboard', async () => {
    const project = createProject(db, {
      title: 'T',
      genreProfile: '悬疑',
      targetAudience: '成人',
      premise: '一张失踪车票牵出旧案。',
    });
    seedOutline(db, project.id, 1, '第一章');
    const writer = new WriterApplication(db, {
      defaultOwnerId: 'test',
      now: () => new Date(fixtureTime),
    });
    const delta: StoryStateDelta = {
      ...summaryDelta('状态-1'),
      foreshadowChanges: [{
        kind: 'open',
        foreshadow: {
          id: foreshadowId('ticket-dashboard'),
          description: '站台广播的错误时间',
          openedAtChapterRevisionId: chapterRevisionId('dashboard-revision-1'),
          status: 'open',
        },
      }],
    };
    await publishChapterThroughFacade({
      writer,
      rawProjectId: project.id,
      position: 1,
      content: '第一章正文内容',
      delta,
      previousState: null,
    });

    const app = await testApp(db, writer);
    const dashboard = await fetchJson(app, `/api/projects/${project.id}/dashboard`);
    assert.equal(dashboard.status, 200);
    const body = dashboard.json as {
      narrative: { openForeshadows: Array<{ description: string; status: string }> };
    };
    assert.equal(body.narrative.openForeshadows[0]?.description, '站台广播的错误时间');
    assert.equal(body.narrative.openForeshadows[0]?.status, 'open');
  });
});
