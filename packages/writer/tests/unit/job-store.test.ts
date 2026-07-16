/**
 * job-store 单测 — 新 schema 下的 CRUD + 活动任务 + resume 配置快照
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createProject } from '../../src/project.ts';
import {
  createJobRow,
  getJobRow,
  listJobsByProject,
  getActiveJob,
  updateJobStatus,
  updateJobProgress,
  recoverInterruptedJobs,
  readJobResumeConfig,
} from '../../src/job-store.ts';
import { createTestDb } from '../helpers/test-db.ts';

describe('job-store', () => {
  it('createJobRow 写入 running 状态 + 范围/配置快照', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const id = createJobRow(testDb.db, {
      projectId: p.id,
      type: 'chapter',
      scope: { from: 1, to: 10 },
      engine: 'bigmodel',
      model: 'glm',
      wordCount: 2000,
      qualityProfile: 'default',
      promptVersion: 'chapter-v1',
      budget: { maxCostRmb: 5 },
    });
    const row = getJobRow(testDb.db, id);
    assert.ok(row);
    assert.equal(row.status, 'running');
    assert.equal(row.type, 'chapter');
    assert.deepEqual(row.scope, { from: 1, to: 10 });
    assert.equal(row.engine, 'bigmodel');
    assert.equal(row.model, 'glm');
    assert.equal(row.wordCount, 2000);
    assert.equal(row.lastOutlinePosition, 0);
  });

  it('updateJobProgress 推进断点章号', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const id = createJobRow(testDb.db, {
      projectId: p.id,
      type: 'chapter',
      scope: { from: 1, to: 5 },
    });
    updateJobProgress(testDb.db, id, 3);
    const row = getJobRow(testDb.db, id);
    assert.equal(row!.lastOutlinePosition, 3);
    assert.deepEqual(row!.checkpoint, { outlinePosition: 3 });
  });

  it('updateJobStatus 写终态', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const id = createJobRow(testDb.db, { projectId: p.id, type: 'bible' });
    updateJobStatus(testDb.db, id, 'completed', { result: { chapters: 10 } });
    const row = getJobRow(testDb.db, id);
    assert.equal(row!.status, 'completed');
  });

  it('getActiveJob 返回 running/paused 中最新一条，completed 不算', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const oldId = createJobRow(testDb.db, {
      projectId: p.id,
      type: 'chapter',
      scope: { from: 1, to: 5 },
    });
    updateJobStatus(testDb.db, oldId, 'completed');
    const newId = createJobRow(testDb.db, {
      projectId: p.id,
      type: 'chapter',
      scope: { from: 6, to: 10 },
    });
    updateJobStatus(testDb.db, newId, 'paused');

    const active = getActiveJob(testDb.db, p.id);
    assert.ok(active);
    assert.equal(active.id, newId);
    assert.equal(active.status, 'paused');
  });

  it('listJobsByProject 按创建倒序', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const a = createJobRow(testDb.db, { projectId: p.id, type: 'bible' });
    const b = createJobRow(testDb.db, { projectId: p.id, type: 'outline' });
    const list = listJobsByProject(testDb.db, p.id);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, b);
    assert.equal(list[1].id, a);
  });

  it('recoverInterruptedJobs：running → paused', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p1 = createProject(testDb.db, { title: 'T1', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const p2 = createProject(testDb.db, { title: 'T2', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const j1 = createJobRow(testDb.db, {
      projectId: p1.id,
      type: 'chapter',
      scope: { from: 1, to: 10 },
    });
    const j2 = createJobRow(testDb.db, {
      projectId: p2.id,
      type: 'chapter',
      scope: { from: 1, to: 5 },
    });
    const j3 = createJobRow(testDb.db, { projectId: p1.id, type: 'bible' });
    updateJobStatus(testDb.db, j3, 'completed');

    const changes = recoverInterruptedJobs(testDb.db);
    assert.equal(changes, 2);

    assert.equal(getJobRow(testDb.db, j1)!.status, 'paused');
    assert.equal(getJobRow(testDb.db, j2)!.status, 'paused');
    assert.equal(getJobRow(testDb.db, j3)!.status, 'completed');
  });

  it('readJobResumeConfig 读取原始 to 与配置快照', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const id = createJobRow(testDb.db, {
      projectId: p.id,
      type: 'chapter',
      scope: { from: 2, to: 8 },
      engine: 'deepseek',
      model: 'v3',
      wordCount: 1500,
      qualityProfile: 'careful',
      promptVersion: 'chapter-v2',
      budget: { maxCostRmb: 3 },
    });
    updateJobProgress(testDb.db, id, 4);
    const resume = readJobResumeConfig(testDb.db, id);
    assert.deepEqual(resume.scope, { from: 2, to: 8 });
    assert.equal(resume.engine, 'deepseek');
    assert.equal(resume.model, 'v3');
    assert.equal(resume.wordCount, 1500);
    assert.equal(resume.qualityProfile, 'careful');
    assert.equal(resume.promptVersion, 'chapter-v2');
    assert.deepEqual(resume.budget, { maxCostRmb: 3 });
    assert.equal(resume.lastOutlinePosition, 4);
  });
});
