/**
 * 章节相关数据访问层 — 旧可变路径已移除；只读适配新 schema。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createProject } from '../../src/project.ts';
import {
  saveOutlines, getOutline, getAllOutlines, countOutlines, markOutlineWritten,
  saveChapter, getChapter, getRecentChapters, countChapters,
  getNarrativeState, saveNarrativeState,
} from '../../src/chapter/store.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import { outlineId } from '../../src/domain/ids.ts';
import { createTestDb } from '../helpers/test-db.ts';
import { fixtureTime } from '../helpers/fixtures.ts';

describe('chapter_outline CRUD', () => {
  it('saveOutlines 已移除', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    assert.throws(
      () => saveOutlines(testDb.db, p.id, [{
        number: 1, title: '一', act: 1, beat: '铺垫', role: '引入', purpose: '开场',
        suspenseLevel: 3, foreshadowing: '', twistLevel: 0, summary: '摘要摘要摘要摘要摘要摘要摘要摘要摘要摘要',
      }]),
      /saveOutlines was removed/,
    );
  });

  it('PlanningRepository 写入后可通过 store 只读适配读取', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    new PlanningRepository(testDb.db).saveApprovedOutline({
      outline: {
        id: outlineId('outline-1'),
        projectId: p.id,
        position: 1,
        createdAt: fixtureTime,
        updatedAt: fixtureTime,
      },
      revision: {
        id: 'outline-revision-1',
        revisionNumber: 1,
        title: '第一章',
        content: {
          summary: '摘要摘要摘要摘要摘要摘要摘要摘要摘要摘要',
          beats: ['铺垫'],
          act: 1,
          role: '引入',
          purpose: '开场',
          suspenseLevel: 3,
          beatLabel: '铺垫',
        },
        createdAt: fixtureTime,
      },
    });

    assert.equal(countOutlines(testDb.db, p.id), 1);
    const outline = getOutline(testDb.db, p.id, 1);
    assert.ok(outline);
    assert.equal(outline.title, '第一章');
    assert.equal(outline.act, 1);
    assert.equal(getAllOutlines(testDb.db, p.id).length, 1);
  });

  it('markOutlineWritten 已移除', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    assert.throws(
      () => markOutlineWritten(testDb.db, p.id, 1),
      /markOutlineWritten was removed/,
    );
  });
});

describe('chapter CRUD', () => {
  it('saveChapter 已移除', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    assert.throws(
      () => saveChapter(testDb.db, p.id, 1, { title: '第一章', content: '正文', wordCount: 2 }),
      /saveChapter was removed/,
    );
    assert.equal(getChapter(testDb.db, p.id, 1), null);
    assert.equal(countChapters(testDb.db, p.id), 0);
    assert.deepEqual(getRecentChapters(testDb.db, p.id, 3, 2), []);
  });
});

describe('narrative_state CRUD', () => {
  it('旧 narrative_state 已移除', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    assert.equal(getNarrativeState(testDb.db, p.id), null);
    assert.throws(
      () => saveNarrativeState(testDb.db, {
        projectId: p.id,
        macroSummary: 'x',
        openForeshadows: [],
        arcSummaries: [],
        upToChapter: 1,
        updatedAt: fixtureTime,
      }),
      /saveNarrativeState was removed/,
    );
    // keep ProjectRepository import used for side-effect-free compile check
    assert.ok(new ProjectRepository(testDb.db));
  });
});
