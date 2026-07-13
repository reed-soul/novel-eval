/**
 * job-store 单测 — job 表 CRUD + 活动任务查询 + 启动恢复
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, closeDb } from '../../src/db.ts';
import { createProject } from '../../src/project.ts';
import {
  createJobRow, getJobRow, listJobsByProject, getActiveJob,
  updateJobStatus, updateJobProgress, recoverInterruptedJobs,
} from '../../src/job-store.ts';

let origCwd: string;
let tempRoot: string;
beforeEach(() => { origCwd = process.cwd(); tempRoot = mkdtempSync(join(tmpdir(), 'jobs-')); process.chdir(tempRoot); });
afterEach(() => { process.chdir(origCwd); rmSync(tempRoot, { recursive: true, force: true }); });

describe('job-store', () => {
  it('createJobRow 写入 running 状态 + 读回', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    const id = createJobRow(db, { projectId: p.id, type: 'chapter', fromChapter: 1, toChapter: 10, qualityGate: true, maxRevise: 2 });
    const row = getJobRow(db, id);
    assert.ok(row);
    assert.equal(row!.status, 'running');
    assert.equal(row!.type, 'chapter');
    assert.equal(row!.fromChapter, 1);
    assert.equal(row!.toChapter, 10);
    assert.equal(row!.qualityGate, true);
    assert.equal(row!.maxRevise, 2);
    assert.equal(row!.lastChapter, 0);
    closeDb(db);
  });

  it('updateJobProgress 推进断点章号', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    const id = createJobRow(db, { projectId: p.id, type: 'chapter', fromChapter: 1, toChapter: 5 });
    updateJobProgress(db, id, 3);
    const row = getJobRow(db, id);
    assert.equal(row!.lastChapter, 3);
    closeDb(db);
  });

  it('updateJobStatus 写终态 + result', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    const id = createJobRow(db, { projectId: p.id, type: 'bible' });
    updateJobStatus(db, id, 'done', { result: { chapters: 10 } });
    const row = getJobRow(db, id);
    assert.equal(row!.status, 'done');
    assert.deepEqual(row!.result, { chapters: 10 });
    closeDb(db);
  });

  it('getActiveJob 返回 running/paused 中最新一条，done 不算', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    // 旧的 done job
    const oldId = createJobRow(db, { projectId: p.id, type: 'chapter', fromChapter: 1, toChapter: 5 });
    updateJobStatus(db, oldId, 'done');
    // 新的 paused job（应该是活动任务）
    const newId = createJobRow(db, { projectId: p.id, type: 'chapter', fromChapter: 6, toChapter: 10 });
    updateJobStatus(db, newId, 'paused');

    const active = getActiveJob(db, p.id);
    assert.ok(active);
    assert.equal(active!.id, newId);
    assert.equal(active!.status, 'paused');
    closeDb(db);
  });

  it('listJobsByProject 按创建倒序', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    const a = createJobRow(db, { projectId: p.id, type: 'bible' });
    const b = createJobRow(db, { projectId: p.id, type: 'outline' });
    const list = listJobsByProject(db, p.id);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, b);  // 最新在前
    assert.equal(list[1].id, a);
    closeDb(db);
  });

  it('recoverInterruptedJobs：running → paused（模拟进程重启）', () => {
    const db = openDb();
    const p1 = createProject(db, { title: 'T1', genre: 'g', audience: 'a', topic: 't' });
    const p2 = createProject(db, { title: 'T2', genre: 'g', audience: 'a', topic: 't' });
    const j1 = createJobRow(db, { projectId: p1.id, type: 'chapter', fromChapter: 1, toChapter: 10 });
    const j2 = createJobRow(db, { projectId: p2.id, type: 'chapter', fromChapter: 1, toChapter: 5 });
    const j3 = createJobRow(db, { projectId: p1.id, type: 'bible' });
    updateJobStatus(db, j3, 'done');  // 已完成的应不受影响

    const changes = recoverInterruptedJobs(db);
    assert.equal(changes, 2, '应恢复 2 个 running job');

    assert.equal(getJobRow(db, j1)!.status, 'paused');
    assert.equal(getJobRow(db, j2)!.status, 'paused');
    assert.equal(getJobRow(db, j3)!.status, 'done', 'done 不应变');
    closeDb(db);
  });

  it('qualityGate/maxRevise 默认值', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    const id = createJobRow(db, { projectId: p.id, type: 'bible' });
    const row = getJobRow(db, id);
    assert.equal(row!.qualityGate, false);
    assert.equal(row!.maxRevise, 0);
    closeDb(db);
  });
});
