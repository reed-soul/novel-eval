/**
 * correction adopt — 缺 state/delta 不得空壳 publish
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

import {
  openDb,
  closeDb,
  createProject,
  outlineId,
  chapterId,
  chapterRevisionId,
  storyStateRevisionId,
  projectId,
  saveCorrectionDraft,
  ChapterRepository,
  PlanningRepository,
  StoryStateRepository,
  type ExtractStoryStateResult,
  type DB,
  type StoryState,
  type StoryStateDelta,
} from '@novel-eval/writer';
import { correctionRoutes } from '../../server/routes/correction.ts';
import { EngineRegistry } from '../../server/engine-registry.ts';

const fixtureTime = '2026-07-16T09:00:00.000Z';

let tempRoot: string;
let db: DB;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-adopt-'));
  db = openDb({ path: join(tempRoot, 'writer.db') });
});
afterEach(() => {
  closeDb(db);
  rmSync(tempRoot, { recursive: true, force: true });
});

function emptyState(summary: string): StoryState {
  return {
    characters: [],
    facts: [],
    foreshadows: [],
    timeline: [],
    summary,
  };
}

function emptyDelta(summary: string): StoryStateDelta {
  return {
    characterChanges: [],
    factChanges: [],
    foreshadowChanges: [],
    timelineEvents: [],
    summary,
  };
}

function seedOutline(database: DB, rawProjectId: string, position: number, title: string): void {
  new PlanningRepository(database).saveApprovedOutline({
    outline: {
      id: outlineId(`outline-${rawProjectId}-${position}`),
      projectId: projectId(rawProjectId),
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
        beats: ['推进'],
        act: 1,
        role: '发展',
        purpose: '推进情节发展出现转折点',
        suspenseLevel: 5,
        foreshadowing: '无',
        twistLevel: 1,
        beatLabel: '推进',
      },
      createdAt: fixtureTime,
    },
  });
}

function publishChapter(
  database: DB,
  rawProjectId: string,
  position: number,
  content: string,
  previousStateRevisionId: ReturnType<typeof storyStateRevisionId> | null,
): { chapterRevisionId: ReturnType<typeof chapterRevisionId> } {
  const id = projectId(rawProjectId);
  const oid = outlineId(`outline-${rawProjectId}-${position}`);
  const cid = chapterId(`chapter-${rawProjectId}-${position}`);
  const rid = chapterRevisionId(`chapter-revision-${rawProjectId}-${position}`);
  const sid = storyStateRevisionId(`state-revision-${rawProjectId}-${position}`);
  const chapters = new ChapterRepository(database);
  const states = new StoryStateRepository(database);
  chapters.saveCandidate({
    chapter: {
      id: cid,
      projectId: id,
      outlineId: oid,
      createdAt: fixtureTime,
    },
    revision: {
      id: rid,
      revisionNumber: 1,
      source: 'generated',
      parentRevisionId: null,
      title: `第 ${position} 章`,
      content,
      wordCount: content.length,
      status: 'draft',
      generationRunId: `run-${position}`,
      createdAt: fixtureTime,
    },
  });
  chapters.publishRevision(rid);
  database.prepare(`
    UPDATE chapter_outline SET status = 'written', updated_at = ? WHERE id = ?
  `).run(fixtureTime, oid);
  const summary = `状态-${position}`;
  states.save({
    id: sid,
    projectId: id,
    chapterId: cid,
    chapterRevisionId: rid,
    previousStateRevisionId,
    sequence: position,
    status: 'current',
    state: emptyState(summary),
    delta: emptyDelta(summary),
    summary,
    model: 'seed-model',
    promptVersion: 'state-v1',
    createdAt: fixtureTime,
  });
  return { chapterRevisionId: rid };
}

function testApp(database: DB) {
  const registry = new EngineRegistry(
    {
      mock: {
        name: 'mock',
        provider: 'openai',
        model: 'm',
        baseUrl: 'http://localhost',
        apiKeyEnv: 'NONE',
      },
    },
    'mock',
  );
  const app = new Hono();
  app.route('/api/projects', correctionRoutes(database, registry));
  return app;
}

function testAppWithExtract(database: DB) {
  const registry = new EngineRegistry(
    {
      mock: {
        name: 'mock',
        provider: 'openai',
        model: 'm',
        baseUrl: 'http://localhost',
        apiKeyEnv: 'NONE',
      },
    },
    'mock',
  );
  const app = new Hono();
  app.route('/api/projects', correctionRoutes(database, registry, undefined, {
    extractState: async ({ content }): Promise<ExtractStoryStateResult> => ({
      state: emptyState(`修正抽取：${content}`),
      delta: emptyDelta(`修正抽取：${content}`),
      usage: { inputTokens: 0, outputTokens: 0, costRmb: 0, model: 'test-extractor', durationMs: 0 },
      model: 'test-extractor',
      promptVersion: 'state-v1',
    }),
  }));
  return app;
}

describe('POST correction adopt', () => {
  it('extract=true 时由服务端抽取 state 并采纳修正稿', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, '第一章');
    const first = publishChapter(db, p.id, 1, '第一章原文', null);

    const draftId = saveCorrectionDraft(db, {
      projectId: p.id,
      chapterNumber: 1,
      strategy: 'rewrite',
      originalContent: '第一章原文',
      revisedContent: '第一章修正后正文足够长',
      originalScore: 60,
      revisedScore: 80,
      engine: 'mock',
    });

    const app = testAppWithExtract(db);
    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/corrections/${draftId}/adopt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extract: true }),
    }));

    assert.equal(res.status, 200, await res.clone().text());
    const data = await res.json() as {
      ok: boolean;
      chapterRevisionId: string;
      storyStateRevisionId: string;
    };
    assert.equal(data.ok, true);
    assert.notEqual(data.chapterRevisionId, first.chapterRevisionId);

    const state = new StoryStateRepository(db).getCurrentAtPosition(projectId(p.id), 1);
    assert.equal(state?.id, data.storyStateRevisionId);
    assert.equal(state?.summary, '修正抽取：第一章修正后正文足够长');
  });

  it('无 state/delta 返回 400，不改 active revision / story state', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, '第一章');
    seedOutline(db, p.id, 2, '第二章');
    const first = publishChapter(db, p.id, 1, '第一章原文', null);
    publishChapter(db, p.id, 2, '第二章原文', storyStateRevisionId(`state-revision-${p.id}-1`));

    const draftId = saveCorrectionDraft(db, {
      projectId: p.id,
      chapterNumber: 1,
      strategy: 'rewrite',
      originalContent: '第一章原文',
      revisedContent: '第一章修正后正文足够长',
      originalScore: 60,
      revisedScore: 80,
      engine: 'mock',
    });

    const states = new StoryStateRepository(db);
    const branded = projectId(p.id);
    const before1 = states.getCurrentAtPosition(branded, 1);
    const before2 = states.getCurrentAtPosition(branded, 2);
    assert.ok(before1);
    assert.ok(before2);

    const app = testApp(db);
    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/corrections/${draftId}/adopt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.match(body.error, /state|delta/i);

    assert.equal(
      new ChapterRepository(db).getByOutlinePosition(branded, 1)?.activeRevisionId,
      first.chapterRevisionId,
    );
    assert.equal(states.getCurrentAtPosition(branded, 1)?.id, before1.id);
    assert.equal(states.getCurrentAtPosition(branded, 2)?.id, before2.id);
    assert.equal(states.getCurrentAtPosition(branded, 2)?.status, 'current');
    assert.equal(states.listStale(branded).length, 0);
  });

  it('提供完整 state+delta 时 adopt 成功并更新 active revision', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, '第一章');
    const first = publishChapter(db, p.id, 1, '第一章原文', null);

    const draftId = saveCorrectionDraft(db, {
      projectId: p.id,
      chapterNumber: 1,
      strategy: 'rewrite',
      originalContent: '第一章原文',
      revisedContent: '第一章修正后正文足够长',
      originalScore: 60,
      revisedScore: 80,
      revisedResult: {
        grade: 'B',
        dimensions: { writingQuality: { score: 80, analysis: '改进' } },
        suggestions: [],
        repetition: { within: 0, cross: 0, hotspots: [] },
      },
      engine: 'mock',
    });

    const app = testApp(db);
    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/corrections/${draftId}/adopt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: emptyState('修正后状态'),
        delta: emptyDelta('修正后状态'),
      }),
    }));
    assert.equal(res.status, 200);
    const data = await res.json() as {
      ok: boolean;
      chapterRevisionId: string;
      staleImpact: { affectedOutlinePositions: number[] };
    };
    assert.equal(data.ok, true);
    assert.notEqual(data.chapterRevisionId, first.chapterRevisionId);

    const active = new ChapterRepository(db).getActiveRevision(
      chapterId(`chapter-${p.id}-1`),
    );
    assert.ok(active);
    assert.equal(active.id, data.chapterRevisionId);
    assert.equal(active.content, '第一章修正后正文足够长');
    assert.equal(active.source, 'correction');
  });
});
