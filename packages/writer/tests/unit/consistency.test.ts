/**
 * ensureChapterConsistency 单测 — 窄窗口修复
 *
 * 模拟"窄窗口"场景：chapter 表有第 5 章正文，但 narrative_state.up_to_chapter=4
 * （saveChapter 完成后、finalizeChapter 前崩溃）。
 * 调用 ensureChapterConsistency 后，状态应追平到 5，返回 from=6。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';

import { openDb, closeDb } from '../../src/db.ts';
import { createProject } from '../../src/project.ts';
import { saveOutlines, saveChapter, saveNarrativeState, getNarrativeState } from '../../src/chapter/store.ts';
import { ensureChapterConsistency } from '../../src/chapter/consistency.ts';
import type { CharacterState, PlotArchitecture } from '../../src/bible/types.ts';
import type { NarrativeState } from '../../src/chapter/legacy-types.ts';

let origCwd: string;
let tempRoot: string;
beforeEach(() => { origCwd = process.cwd(); tempRoot = mkdtempSync(join(tmpdir(), 'consist-')); process.chdir(tempRoot); });
afterEach(() => { process.chdir(origCwd); rmSync(tempRoot, { recursive: true, force: true }); });

function mockFinalizerEngine(): AIAgentAdapter {
  const defState = JSON.stringify({ characters: [{ name: '李川', items: [], abilities: [], status: '健康', relationships: [], events: [] }] });
  const defSummary = JSON.stringify({ macroSummary: '补全后的前情摘要。', openForeshadows: [] });
  let call = 0;
  return {
    name: 'mock',
    async run(_p: string, _o: RunOptions): Promise<CallResult> {
      call++;
      // finalizer 两次调用：summary + state
      const text = call % 2 === 1 ? defSummary : defState;
      return { text, usage: { inputTokens: 50, outputTokens: 100, costRmb: 0.001, model: 'mock', durationMs: 1 }, notes: [] };
    },
    async isAvailable() { return true; },
  };
}

function seedBible(db: ReturnType<typeof openDb>, projectId: string) {
  const charState: CharacterState = { characters: [{ name: '李川', items: ['背包'], abilities: [], status: '健康', relationships: [], events: [] }] };
  const plot: PlotArchitecture = {
    act1: { setup: 'a', conflicts: ['b'], climax: 'c' },
    act2: { setup: 'a', conflicts: ['b'], climax: 'c' },
    act3: { setup: 'a', conflicts: ['b'], climax: 'c' },
    foreshadows: [],
  };
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO bible (project_id, core_seed, character_dynamics, character_state, world_building, plot_architecture, full_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(projectId, '{"premise":"核心"}', '{"characters":[]}', JSON.stringify(charState), '{}', JSON.stringify(plot), '设定全文', now, now);
}

describe('ensureChapterConsistency', () => {
  it('窄窗口：正文比状态多 1 章，补全后状态追平，返回 from = max+1', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedBible(db, p.id);
    saveOutlines(db, p.id, [
      { number: 1, title: 'A', act: 1, beat: 'b', role: 'r', purpose: '第一章核心', suspenseLevel: 3, foreshadowing: '', twistLevel: 0, summary: 's1' },
      { number: 2, title: 'B', act: 1, beat: 'b', role: 'r', purpose: '第二章核心', suspenseLevel: 3, foreshadowing: '', twistLevel: 0, summary: 's2' },
      { number: 3, title: 'C', act: 1, beat: 'b', role: 'r', purpose: '第三章核心', suspenseLevel: 3, foreshadowing: '', twistLevel: 0, summary: 's3' },
      { number: 4, title: 'D', act: 1, beat: 'b', role: 'r', purpose: '第四章核心', suspenseLevel: 3, foreshadowing: '', twistLevel: 0, summary: 's4' },
      { number: 5, title: 'E', act: 1, beat: 'b', role: 'r', purpose: '第五章核心', suspenseLevel: 3, foreshadowing: '', twistLevel: 0, summary: 's5' },
    ]);
    // 窄窗口：5 章正文已存，但状态停在 4
    for (let n = 1; n <= 5; n++) {
      saveChapter(db, p.id, n, { title: `第${n}章`, content: `第${n}章正文内容`.repeat(10), wordCount: 100 });
    }
    const partialNarrative: NarrativeState = {
      projectId: p.id, macroSummary: '旧摘要', openForeshadows: [], arcSummaries: [],
      upToChapter: 4, updatedAt: new Date().toISOString(),
    };
    saveNarrativeState(db, partialNarrative);

    const result = await ensureChapterConsistency(mockFinalizerEngine(), db, p.id);

    assert.equal(result.finalizedGap, 1, '应补 1 章 finalize');
    assert.equal(result.from, 6, 'resume 起点应是 5+1');
    assert.equal(result.to, 5);
    // 状态应追平到 5
    const after = getNarrativeState(db, p.id);
    assert.equal(after!.upToChapter, 5);
    closeDb(db);
  });

  it('一致状态（无窄窗口）：finalizedGap=0，from = max+1', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedBible(db, p.id);
    saveOutlines(db, p.id, [
      { number: 1, title: 'A', act: 1, beat: 'b', role: 'r', purpose: '第一章核心', suspenseLevel: 3, foreshadowing: '', twistLevel: 0, summary: 's1' },
      { number: 2, title: 'B', act: 1, beat: 'b', role: 'r', purpose: '第二章核心', suspenseLevel: 3, foreshadowing: '', twistLevel: 0, summary: 's2' },
    ]);
    saveChapter(db, p.id, 1, { title: '第1章', content: '正文'.repeat(10), wordCount: 100 });
    saveChapter(db, p.id, 2, { title: '第2章', content: '正文'.repeat(10), wordCount: 100 });
    saveNarrativeState(db, {
      projectId: p.id, macroSummary: '一致摘要', openForeshadows: [], arcSummaries: [],
      upToChapter: 2, updatedAt: new Date().toISOString(),
    });

    const result = await ensureChapterConsistency(mockFinalizerEngine(), db, p.id);
    assert.equal(result.finalizedGap, 0, '无不一致');
    assert.equal(result.from, 3, '全部写完，from > to');
    assert.equal(result.to, 2);
    closeDb(db);
  });

  it('全新项目（无章节）：from=1，finalizedGap=0', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedBible(db, p.id);
    saveOutlines(db, p.id, [
      { number: 1, title: 'A', act: 1, beat: 'b', role: 'r', purpose: '第一章核心', suspenseLevel: 3, foreshadowing: '', twistLevel: 0, summary: 's1' },
    ]);

    const result = await ensureChapterConsistency(mockFinalizerEngine(), db, p.id);
    assert.equal(result.finalizedGap, 0);
    assert.equal(result.from, 1);
    assert.equal(result.to, 1);
    closeDb(db);
  });
});
