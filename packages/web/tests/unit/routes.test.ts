/**
 * API 路由单测 — 用临时 DB 测试 Hono 路由
 *
 * 建项目 + bible + outline + chapter → GET 验证返回结构。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

import { openDb, closeDb, createProject, saveOutlines, saveChapter, type DB } from '@novel-eval/writer';
import { projectRoutes } from '../../server/routes/projects.ts';
import { chapterRoutes } from '../../server/routes/chapters.ts';
import { outlineRoutes } from '../../server/routes/outlines.ts';

let origCwd: string;
let tempRoot: string;
let db: DB;

beforeEach(() => {
  origCwd = process.cwd();
  tempRoot = mkdtempSync(join(tmpdir(), 'web-test-'));
  process.chdir(tempRoot);
  db = openDb();
});
afterEach(() => {
  closeDb(db);
  process.chdir(origCwd);
  rmSync(tempRoot, { recursive: true, force: true });
});

/** 构建测试用 Hono app（只挂要测的路由）*/
function testApp(db: DB) {
  const app = new Hono();
  app.route('/api/projects', projectRoutes(db));
  app.route('/api/projects', chapterRoutes(db));
  app.route('/api/projects', outlineRoutes(db));
  return app;
}

async function fetchJson(app: Hono, path: string): Promise<{ status: number; json: unknown }> {
  const res = await app.fetch(new Request(`http://test${path}`));
  const json = await res.json();
  return { status: res.status, json };
}

describe('API 路由', () => {
  it('GET /api/projects 返回项目列表', async () => {
    createProject(db, { title: '测试书', genre: '科幻', audience: '青年', topic: '测试' });
    const app = testApp(db);
    const { status, json } = await fetchJson(app, '/api/projects');
    assert.equal(status, 200);
    const projects = json as Array<{ title: string }>;
    assert.equal(projects.length, 1);
    assert.equal(projects[0].title, '测试书');
  });

  it('GET /api/projects/:id 返回详情含进度统计', async () => {
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    const app = testApp(db);
    const { status, json } = await fetchJson(app, `/api/projects/${p.id}`);
    assert.equal(status, 200);
    const detail = json as { title: string; outlineCount: number; chapterCount: number };
    assert.equal(detail.title, 'T');
    assert.equal(detail.outlineCount, 0);
    assert.equal(detail.chapterCount, 0);
  });

  it('GET /api/projects/:id/chapters 返回章节列表', async () => {
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    saveOutlines(db, p.id, [
      { number: 1, title: '第一章', act: 1, beat: '铺垫', role: '引入', purpose: '开篇介绍主角和核心矛盾冲突', suspenseLevel: 5, foreshadowing: '无', twistLevel: 1, summary: '梗概内容' },
      { number: 2, title: '第二章', act: 1, beat: '推进', role: '发展', purpose: '推进情节发展出现转折点', suspenseLevel: 7, foreshadowing: '无', twistLevel: 2, summary: '梗概二' },
    ]);
    saveChapter(db, p.id, 1, { title: '第一章', content: '正文', wordCount: 1000 });
    const app = testApp(db);
    const { status, json } = await fetchJson(app, `/api/projects/${p.id}/chapters`);
    assert.equal(status, 200);
    const result = json as { chapters: Array<{ number: number; written: boolean }>; total: number; written: number };
    assert.equal(result.total, 2);
    assert.equal(result.written, 1);
    assert.equal(result.chapters[0].written, true);
    assert.equal(result.chapters[1].written, false);
  });

  it('GET /api/projects/:id/chapters/:n 返回单章正文+蓝图', async () => {
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    saveOutlines(db, p.id, [
      { number: 1, title: '第一章', act: 1, beat: '铺垫', role: '引入', purpose: '开篇介绍主角和核心矛盾冲突', suspenseLevel: 5, foreshadowing: '埋设：项链', twistLevel: 1, summary: '主角醒来发现世界变了' },
    ]);
    saveChapter(db, p.id, 1, { title: '第一章', content: '这是正文内容。', wordCount: 6 });
    const app = testApp(db);
    const { status, json } = await fetchJson(app, `/api/projects/${p.id}/chapters/1`);
    assert.equal(status, 200);
    const ch = json as { content: string; outline: { role: string }; written: boolean; wordCount: number };
    assert.equal(ch.content, '这是正文内容。');
    assert.equal(ch.written, true);
    assert.equal(ch.outline.role, '引入');
    assert.equal(ch.wordCount, 6);
  });

  it('GET 不存在的项目返回 404', async () => {
    const app = testApp(db);
    const { status } = await fetchJson(app, '/api/projects/nonexistent-id');
    assert.equal(status, 404);
  });
});
