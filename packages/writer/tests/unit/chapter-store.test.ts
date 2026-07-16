/**
 * M2 章节相关数据访问层单测（chapter_outline / chapter / narrative_state CRUD）
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, closeDb } from '../../src/db.ts';
import { createProject } from '../../src/project.ts';
import {
  saveOutlines, getOutline, getAllOutlines, countOutlines, markOutlineWritten,
  saveChapter, getChapter, getRecentChapters, countChapters,
  getNarrativeState, saveNarrativeState,
} from '../../src/chapter/store.ts';
import type { NarrativeState } from '../../src/chapter/legacy-types.ts';

let origCwd: string;
let tempRoot: string;

beforeEach(() => {
  origCwd = process.cwd();
  tempRoot = mkdtempSync(join(tmpdir(), 'writer-m2-'));
  process.chdir(tempRoot);
});
afterEach(() => {
  process.chdir(origCwd);
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('chapter_outline CRUD', () => {
  it('saveOutlines 批量写入并按章号读取', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    saveOutlines(db, p.id, [
      { number: 1, title: '开篇', act: 1, beat: '铺垫', role: '引入', purpose: '介绍主角和世界', suspenseLevel: 5, foreshadowing: '埋设：神秘项链', twistLevel: 2, summary: '主角发现神秘项链' },
      { number: 2, title: '初遇', act: 1, beat: '推进', role: '相遇', purpose: '主角遇到关键人物', suspenseLevel: 6, foreshadowing: '无', twistLevel: 1, summary: '主角与导师相遇' },
    ]);
    assert.equal(countOutlines(db, p.id), 2);
    const o1 = getOutline(db, p.id, 1);
    assert.equal(o1?.title, '开篇');
    assert.equal(o1?.act, 1);
    const all = getAllOutlines(db, p.id);
    assert.equal(all.length, 2);
    closeDb(db);
  });

  it('markOutlineWritten 改状态', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    saveOutlines(db, p.id, [
      { number: 1, title: 'A', act: 1, beat: '铺垫', role: 'r', purpose: '该章核心作用明确', suspenseLevel: 3, foreshadowing: '无', twistLevel: 0, summary: '本章梗概内容' },
    ]);
    markOutlineWritten(db, p.id, 1);
    assert.equal(getOutline(db, p.id, 1)?.status, 'written');
    closeDb(db);
  });
});

describe('chapter CRUD', () => {
  it('saveChapter 写入并读取正文', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    saveChapter(db, p.id, 1, { title: '第一章', content: '正文内容...', wordCount: 2500 });
    const ch = getChapter(db, p.id, 1);
    assert.equal(ch?.title, '第一章');
    assert.equal(ch?.content, '正文内容...');
    assert.equal(ch?.wordCount, 2500);
    assert.equal(countChapters(db, p.id), 1);
    closeDb(db);
  });

  it('getRecentChapters 返回指定数量的最近章节（正序）', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    for (let i = 1; i <= 5; i++) saveChapter(db, p.id, i, { title: `第${i}章`, content: `内容${i}`, wordCount: 100 });
    // 取第 5 章之前的最近 3 章 = [2,3,4]
    const recent = getRecentChapters(db, p.id, 5, 3);
    assert.equal(recent.length, 3);
    assert.equal(recent[0].number, 2);
    assert.equal(recent[2].number, 4);  // 正序（时间先后）
    closeDb(db);
  });

  it('saveChapter 幂等：同章号覆盖', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    saveChapter(db, p.id, 1, { title: '旧', content: '旧内容', wordCount: 100 });
    saveChapter(db, p.id, 1, { title: '新', content: '新内容', wordCount: 200 });
    assert.equal(countChapters(db, p.id), 1);
    assert.equal(getChapter(db, p.id, 1)?.title, '新');
    closeDb(db);
  });
});

describe('narrative_state CRUD', () => {
  it('save/get 往返一致', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const state: NarrativeState = {
      projectId: p.id,
      macroSummary: '主角踏上旅程',
      openForeshadows: [{ description: '神秘项链', setupChapter: 1, resolveChapter: null }],
      arcSummaries: [],
      upToChapter: 3,
      updatedAt: new Date().toISOString(),
    };
    saveNarrativeState(db, state);
    const got = getNarrativeState(db, p.id);
    assert.equal(got?.macroSummary, '主角踏上旅程');
    assert.equal(got?.openForeshadows.length, 1);
    assert.equal(got?.openForeshadows[0].description, '神秘项链');
    assert.equal(got?.upToChapter, 3);
    closeDb(db);
  });

  it('save 覆盖更新（upsert）', () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    saveNarrativeState(db, { projectId: p.id, macroSummary: 'v1', openForeshadows: [], arcSummaries: [], upToChapter: 1, updatedAt: '' });
    saveNarrativeState(db, { projectId: p.id, macroSummary: 'v2', openForeshadows: [], arcSummaries: [], upToChapter: 2, updatedAt: '' });
    const got = getNarrativeState(db, p.id);
    assert.equal(got?.macroSummary, 'v2');
    assert.equal(got?.upToChapter, 2);
    closeDb(db);
  });
});
