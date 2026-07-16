/**
 * 编辑路由单测 — PUT 经 WriterApplication.publishChapterEdit 发布新 revision
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
  getChapter,
  outlineId,
  chapterId,
  chapterRevisionId,
  storyStateRevisionId,
  projectId,
  type DB,
  type StoryState,
  type StoryStateDelta,
  ChapterRepository,
  PlanningRepository,
  StoryStateRepository,
} from '@novel-eval/writer';
import { editRoutes } from '../../server/routes/edit.ts';

const fixtureTime = '2026-07-16T09:00:00.000Z';

let tempRoot: string;
let db: DB;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-edit-'));
  db = openDb({ path: join(tempRoot, 'writer.db') });
});
afterEach(() => {
  closeDb(db);
  rmSync(tempRoot, { recursive: true, force: true });
});

function testApp(database: DB) {
  const app = new Hono();
  app.route('/api/projects', editRoutes(database));
  return app;
}

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

describe('PUT 章节编辑', () => {
  it('发布新 revision 并返回 revisionId / active / staleImpact', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, '第一章');
    seedOutline(db, p.id, 2, '第二章');
    const first = publishChapter(db, p.id, 1, '旧内容一', null);
    publishChapter(db, p.id, 2, '旧内容二', storyStateRevisionId(`state-revision-${p.id}-1`));

    const app = testApp(db);
    const newContent = '这是编辑后的新正文内容，比原来更长。';
    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/chapters/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: newContent,
        title: '第一章',
        state: emptyState('编辑后状态'),
        delta: emptyDelta('编辑后状态'),
      }),
    }));
    assert.equal(res.status, 200);
    const data = await res.json() as {
      chapterRevisionId: string;
      storyStateRevisionId: string;
      staleImpact: { affectedOutlinePositions: number[] };
      wordCount: number;
      saved: boolean;
    };
    assert.equal(data.saved, true);
    assert.ok(data.wordCount > 3);
    assert.ok(typeof data.chapterRevisionId === 'string' && data.chapterRevisionId.length > 0);
    assert.notEqual(data.chapterRevisionId, first.chapterRevisionId);
    assert.ok(typeof data.storyStateRevisionId === 'string' && data.storyStateRevisionId.length > 0);
    assert.ok(Array.isArray(data.staleImpact.affectedOutlinePositions));
    assert.ok(data.staleImpact.affectedOutlinePositions.includes(2));

    const chapters = new ChapterRepository(db);
    const chapter = chapters.getByOutlinePosition(projectId(p.id), 1);
    assert.ok(chapter?.activeRevisionId);
    assert.equal(chapter.activeRevisionId, data.chapterRevisionId);
    const active = chapters.getActiveRevision(chapter.id);
    assert.ok(active);
    assert.equal(active.content, newContent);
    assert.equal(active.status, 'published');

    const ch = getChapter(db, p.id, 1);
    assert.equal(ch?.content, newContent);
  });

  it('空正文返回 400', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, 'A');
    const app = testApp(db);
    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/chapters/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    }));
    assert.equal(res.status, 400);
  });

  it('蓝图不存在返回 404', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const app = testApp(db);
    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/chapters/99`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '内容',
        state: emptyState('x'),
        delta: emptyDelta('x'),
      }),
    }));
    assert.equal(res.status, 404);
  });
});
