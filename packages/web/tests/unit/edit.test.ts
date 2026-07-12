/**
 * 编辑路由单测 — PUT 章节正文
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

import { openDb, closeDb, createProject, saveOutlines, getChapter, saveChapter, type DB } from '@novel-eval/writer';
import { editRoutes } from '../../server/routes/edit.ts';

let origCwd: string;
let tempRoot: string;
let db: DB;

beforeEach(() => {
  origCwd = process.cwd();
  tempRoot = mkdtempSync(join(tmpdir(), 'web-edit-'));
  process.chdir(tempRoot);
  db = openDb();
});
afterEach(() => {
  closeDb(db);
  process.chdir(origCwd);
  rmSync(tempRoot, { recursive: true, force: true });
});

function testApp(db: DB) {
  const app = new Hono();
  app.route('/api/projects', editRoutes(db));
  return app;
}

describe('PUT 章节编辑', () => {
  it('保存正文后 GET 能读到新内容', async () => {
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    saveOutlines(db, p.id, [
      { number: 1, title: '第一章', act: 1, beat: '铺垫', role: '引入', purpose: '开篇介绍主角和核心矛盾冲突', suspenseLevel: 5, foreshadowing: '无', twistLevel: 1, summary: '梗概' },
    ]);
    saveChapter(db, p.id, 1, { title: '第一章', content: '旧内容', wordCount: 3 });

    const app = testApp(db);
    // PUT 新内容
    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/chapters/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '这是编辑后的新正文内容，比原来更长。' }),
    }));
    assert.equal(res.status, 200);
    const data = await res.json() as { saved: boolean; wordCount: number };
    assert.equal(data.saved, true);
    assert.ok(data.wordCount > 3);

    // 验证 DB 里是新内容
    const ch = getChapter(db, p.id, 1);
    assert.equal(ch?.content, '这是编辑后的新正文内容，比原来更长。');
  });

  it('空正文返回 400', async () => {
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    saveOutlines(db, p.id, [
      { number: 1, title: 'A', act: 1, beat: 'b', role: 'r', purpose: '核心作用明确且具体', suspenseLevel: 3, foreshadowing: '无', twistLevel: 0, summary: '梗概' },
    ]);
    const app = testApp(db);
    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/chapters/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    }));
    assert.equal(res.status, 400);
  });

  it('蓝图不存在返回 404', async () => {
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    const app = testApp(db);
    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/chapters/99`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '内容' }),
    }));
    assert.equal(res.status, 404);
  });
});
