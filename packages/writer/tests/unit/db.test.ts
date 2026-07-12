/**
 * SQLite 数据层 + 项目 CRUD 单测
 *
 * 用临时目录隔离测试 DB，不污染真实 data/writer/。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

// 用真实的 openDb/migrate 逻辑，但指向临时目录
// （openDb 用 process.cwd()/data/writer，测试里改 cwd 到临时目录）
import { openDb, closeDb, writerDataDir, type DB } from '../../src/db.ts';
import { createProject, getProject, listProjects, updateProjectStatus } from '../../src/project.ts';

let origCwd: string;
let tempRoot: string;

beforeEach(() => {
  origCwd = process.cwd();
  tempRoot = mkdtempSync(join(tmpdir(), 'writer-test-'));
  process.chdir(tempRoot);
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('openDb', () => {
  it('创建 writer.db 并建 project/bible 表', () => {
    const db = openDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as { name: string }[];
    const names = tables.map((t) => t.name);
    assert.ok(names.includes('project'));
    assert.ok(names.includes('bible'));
    closeDb(db);
  });

  it('幂等：重复 openDb 不报错（IF NOT EXISTS）', () => {
    const db1 = openDb();
    closeDb(db1);
    const db2 = openDb();
    closeDb(db2);
    assert.ok(existsSync(join(writerDataDir(), 'writer.db')));
  });

  it('WAL 模式已开启', () => {
    const db = openDb();
    const journal = db.pragma('journal_mode', { simple: true });
    assert.equal(journal, 'wal');
    closeDb(db);
  });
});

describe('项目 CRUD', () => {
  it('createProject 写入并返回完整 Project', () => {
    const db = openDb();
    const p = createProject(db, {
      title: '测试书', genre: '玄幻', audience: '青年男性', topic: '一个测试主题',
    });
    assert.ok(p.id.length > 0);
    assert.equal(p.title, '测试书');
    assert.equal(p.status, 'initialized');
    assert.ok(p.createdAt);
    closeDb(db);
  });

  it('getProject 能读回 createProject 写的记录', () => {
    const db = openDb();
    const created = createProject(db, {
      title: '消失的她', genre: '悬疑', audience: '青年女性', topic: '密室失踪',
    });
    const got = getProject(db, created.id);
    assert.equal(got?.title, '消失的她');
    assert.equal(got?.genre, '悬疑');
    assert.equal(got?.status, 'initialized');
    closeDb(db);
  });

  it('getProject 不存在的 id 返回 null', () => {
    const db = openDb();
    assert.equal(getProject(db, 'nonexistent-id'), null);
    closeDb(db);
  });

  it('updateProjectStatus 改状态并刷新 updated_at', () => {
    const db = openDb();
    const p = createProject(db, {
      title: 'B', genre: 'g', audience: 'a', topic: 't',
    });
    updateProjectStatus(db, p.id, 'bible_done');
    const updated = getProject(db, p.id);
    assert.equal(updated?.status, 'bible_done');
    closeDb(db);
  });

  it('listProjects 按创建时间倒序返回', () => {
    const db = openDb();
    const p1 = createProject(db, { title: '第一本', genre: 'g', audience: 'a', topic: 't1' });
    const p2 = createProject(db, { title: '第二本', genre: 'g', audience: 'a', topic: 't2' });
    const list = listProjects(db);
    assert.equal(list.length, 2);
    // 倒序：最新的在前
    assert.equal(list[0].id, p2.id);
    assert.equal(list[1].id, p1.id);
    closeDb(db);
  });
});
