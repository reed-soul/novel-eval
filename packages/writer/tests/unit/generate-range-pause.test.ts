/**
 * generateRange 暂停/取消控制单测
 *
 * 验证：
 *   1. shouldPause 在第 3 章返回 true → 写完 2 章后抛 JobPausedError(3)
 *   2. shouldCancel → 抛 JobCancelledError，已写章节保留
 *   3. onChapterComplete 回调每章触发，记录断点
 *   4. 无 control 时行为与原来一致（全跑完）
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';

import { openDb, closeDb } from '../../src/db.ts';
import { createProject } from '../../src/project.ts';
import { saveOutlines, countChapters } from '../../src/chapter/store.ts';
import {
  generateRange, JobPausedError, JobCancelledError,
} from '../../src/chapter/generator.ts';
import type { CharacterState, PlotArchitecture } from '../../src/bible/types.ts';

let origCwd: string;
let tempRoot: string;
beforeEach(() => { origCwd = process.cwd(); tempRoot = mkdtempSync(join(tmpdir(), 'gen-range-')); process.chdir(tempRoot); });
afterEach(() => { process.chdir(origCwd); rmSync(tempRoot, { recursive: true, force: true }); });

/** mock engine：第 1 次调用返回正文，后续 finalizer 调用返回合法 JSON */
function mockEngine(chapterText: string): AIAgentAdapter {
  let call = 0;
  const defState = JSON.stringify({ characters: [{ name: '李川', items: [], abilities: [], status: '健康', relationships: [], events: [] }] });
  const defSummary = JSON.stringify({ macroSummary: '前情摘要更新。', openForeshadows: [] });
  return {
    name: 'mock',
    async run(_prompt: string, _o: RunOptions): Promise<CallResult> {
      call++;
      const text = call % 3 === 1 ? chapterText : (call % 3 === 2 ? defSummary : defState);
      return { text, usage: { inputTokens: 100, outputTokens: 200, costRmb: 0.002, model: 'mock', durationMs: 1 }, notes: [] };
    },
    async isAvailable() { return true; },
  };
}

function seedBible(db: ReturnType<typeof openDb>, projectId: string) {
  const charState: CharacterState = { characters: [{ name: '李川', items: ['背包'], abilities: ['感知'], status: '健康', relationships: [], events: [] }] };
  const plot: PlotArchitecture = {
    act1: { setup: 'a', conflicts: ['b'], climax: 'c' },
    act2: { setup: 'a', conflicts: ['b'], climax: 'c' },
    act3: { setup: 'a', conflicts: ['b'], climax: 'c' },
    foreshadows: [{ description: '项链', setupAct: 1, resolveAct: 2 }],
  };
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO bible (project_id, core_seed, character_dynamics, character_state, world_building, plot_architecture, full_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(projectId, '{"premise":"核心"}', '{"characters":[]}', JSON.stringify(charState), '{}', JSON.stringify(plot), '设定全文', now, now);
}

function seedOutlines(db: ReturnType<typeof openDb>, projectId: string, count: number) {
  const outlines = [];
  for (let i = 1; i <= count; i++) {
    outlines.push({
      number: i, title: `第${i}章`, act: 1, beat: '推进', role: 'r',
      purpose: `第${i}章核心冲突明确`, suspenseLevel: 5, foreshadowing: '无', twistLevel: 1, summary: `梗概${i}`,
    });
  }
  saveOutlines(db, projectId, outlines);
}

describe('generateRange 暂停/取消控制', () => {
  it('shouldPause：写完 2 章后在第 3 章边界暂停', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    seedBible(db, p.id);
    seedOutlines(db, p.id, 5);
    const engine = mockEngine('这是正文内容，描述场景的展开。'.repeat(20));

    const completed: number[] = [];
    await assert.rejects(
      generateRange({
        engine, db, projectId: p.id, from: 1, to: 5, wordCount: 500,
        control: {
          shouldPause: () => completed.length >= 2,
          onChapterComplete: (n) => completed.push(n),
        },
      }),
      (err: unknown) => {
        assert.ok(err instanceof JobPausedError, '应抛 JobPausedError');
        assert.equal((err as JobPausedError).nextChapter, 3);
        return true;
      },
    );
    // 前 2 章应已落盘
    assert.equal(countChapters(db, p.id), 2, '应只写完 2 章');
    closeDb(db);
  });

  it('onChapterComplete：每章写完回调，记录断点章号', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    seedBible(db, p.id);
    seedOutlines(db, p.id, 3);
    const engine = mockEngine('正文内容描述。'.repeat(20));

    const completed: number[] = [];
    let pauseAfter = 2;
    await generateRange({
      engine, db, projectId: p.id, from: 1, to: 3, wordCount: 500,
      control: {
        shouldPause: () => completed.length >= pauseAfter,
        onChapterComplete: (n) => completed.push(n),
      },
    }).catch((e) => {
      // 预期：第 3 章边界暂停（completed=[1,2] 后 shouldPause=true）
      if (!(e instanceof JobPausedError)) throw e;
    });

    assert.deepEqual(completed, [1, 2], '应回调 2 次（章 1、2）');
    closeDb(db);
  });

  it('shouldCancel：取消信号抛 JobCancelledError，已写章节保留', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    seedBible(db, p.id);
    seedOutlines(db, p.id, 4);
    const engine = mockEngine('正文内容描述场景。'.repeat(20));

    let cancelled = false;
    const completed: number[] = [];
    await assert.rejects(
      generateRange({
        engine, db, projectId: p.id, from: 1, to: 4, wordCount: 500,
        control: {
          shouldCancel: () => cancelled,
          onChapterComplete: (n) => { completed.push(n); if (n >= 2) cancelled = true; },
        },
      }),
      (err: unknown) => {
        assert.ok(err instanceof JobCancelledError, '应抛 JobCancelledError');
        return true;
      },
    );

    assert.deepEqual(completed, [1, 2], '取消前写完 2 章');
    assert.equal(countChapters(db, p.id), 2, '2 章正文已落盘保留');
    closeDb(db);
  });

  it('无 control：行为与原来一致（全跑完）', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    seedBible(db, p.id);
    seedOutlines(db, p.id, 3);
    const engine = mockEngine('正文内容描述场景的展开。'.repeat(20));

    const results = await generateRange({
      engine, db, projectId: p.id, from: 1, to: 3, wordCount: 500,
    });

    assert.equal(results.length, 3);
    assert.equal(countChapters(db, p.id), 3);
    closeDb(db);
  });
});
