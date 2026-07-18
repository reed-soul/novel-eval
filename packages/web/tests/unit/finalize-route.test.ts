/**
 * POST /api/projects/:id/revisions/:revisionId/finalize
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
  projectId,
  ChapterRepository,
  PlanningRepository,
  type DB,
  type ExtractStoryStateResult,
  type StoryState,
  type StoryStateDelta,
} from '@novel-eval/writer';
import { finalizeRoutes } from '../../server/routes/finalize.ts';

const fixtureTime = '2026-07-18T10:00:00.000Z';

let tempRoot: string;
let db: DB;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-finalize-'));
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

function seedApprovedOutline(database: DB, rawProjectId: string, position: number): void {
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
      title: `第 ${position} 章`,
      content: {
        summary: '摘要摘要摘要摘要摘要摘要摘要摘要摘要',
        beats: ['铺垫'],
        act: 1,
        role: '引入',
        purpose: '开篇介绍主角和核心矛盾冲突',
        suspenseLevel: 5,
        foreshadowing: '无',
        twistLevel: 1,
        beatLabel: '铺垫',
      },
      createdAt: fixtureTime,
    },
  });
}

describe('POST finalize draft revision', () => {
  it('publishes a kept draft via extractState', async () => {
    const project = createProject(db, {
      title: '定稿',
      genreProfile: '都市',
      targetAudience: '青年',
      premise: 'finalize draft from web',
    });
    seedApprovedOutline(db, project.id, 1);

    const draftId = chapterRevisionId(`draft-${project.id}-1`);
    new ChapterRepository(db).saveCandidate({
      chapter: {
        id: chapterId(`chapter-${project.id}-1`),
        projectId: projectId(project.id),
        outlineId: outlineId(`outline-${project.id}-1`),
        createdAt: fixtureTime,
      },
      revision: {
        id: draftId,
        revisionNumber: 1,
        source: 'generated',
        parentRevisionId: null,
        title: '第 1 章',
        content: '保留的草稿正文，等待定稿发布。',
        wordCount: 16,
        status: 'draft',
        generationRunId: 'run-1',
        createdAt: fixtureTime,
      },
    });

    const app = new Hono();
    app.route('/api/projects', finalizeRoutes(db, undefined, {
      extractState: async ({ content }): Promise<ExtractStoryStateResult> => ({
        state: emptyState(`抽取：${content}`),
        delta: emptyDelta(`抽取：${content}`),
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          costRmb: 0,
          model: 'test-extract',
          durationMs: 1,
        },
        model: 'test-extract',
        promptVersion: 'state-v1',
      }),
    }));

    const res = await app.fetch(new Request(
      `http://test/api/projects/${project.id}/revisions/${draftId}/finalize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    ));
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json() as {
      chapterRevisionId: string;
      storyStateRevisionId: string;
      outlineStatus: string;
    };
    assert.equal(body.chapterRevisionId, draftId);
    assert.ok(body.storyStateRevisionId);
    assert.equal(body.outlineStatus, 'written');

    const published = new ChapterRepository(db).getRevision(draftId);
    assert.ok(published);
    assert.equal(published.revision.status, 'published');
    assert.equal(published.chapter.activeRevisionId, draftId);
  });

  it('rejects non-draft revisions', async () => {
    const project = createProject(db, {
      title: '非草稿',
      genreProfile: '都市',
      targetAudience: '青年',
      premise: 'cannot finalize published',
    });
    seedApprovedOutline(db, project.id, 1);
    const rid = chapterRevisionId(`pub-${project.id}-1`);
    const chapters = new ChapterRepository(db);
    chapters.saveCandidate({
      chapter: {
        id: chapterId(`chapter-${project.id}-1`),
        projectId: projectId(project.id),
        outlineId: outlineId(`outline-${project.id}-1`),
        createdAt: fixtureTime,
      },
      revision: {
        id: rid,
        revisionNumber: 1,
        source: 'generated',
        parentRevisionId: null,
        title: '第 1 章',
        content: '已发布正文',
        wordCount: 5,
        status: 'draft',
        generationRunId: null,
        createdAt: fixtureTime,
      },
    });
    chapters.publishRevision(rid);

    const app = new Hono();
    app.route('/api/projects', finalizeRoutes(db, undefined, {
      extractState: async (): Promise<ExtractStoryStateResult> => ({
        state: emptyState('x'),
        delta: emptyDelta('x'),
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costRmb: 0,
          model: 'test',
          durationMs: 0,
        },
        model: 'test',
        promptVersion: 'state-v1',
      }),
    }));

    const res = await app.fetch(new Request(
      `http://test/api/projects/${project.id}/revisions/${rid}/finalize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    ));
    assert.equal(res.status, 400);
  });
});
