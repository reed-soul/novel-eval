/**
 * 单章生成单测（mock engine）
 *
 * 验证：
 *   1. 第一章用简化 prompt（只调正文 + finalizer）
 *   2. 后续章注入最近章节原文
 *   3. checkpoint：已存在的章节跳过
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';

import { openDb, closeDb } from '../../src/db.ts';
import { createProject } from '../../src/project.ts';
import { saveOutlines, saveChapter, getChapter } from '../../src/chapter/store.ts';
import { generateChapter } from '../../src/chapter/generator.ts';
import type { CharacterState, PlotArchitecture } from '../../src/bible/types.ts';

let origCwd: string;
let tempRoot: string;
beforeEach(() => { origCwd = process.cwd(); tempRoot = mkdtempSync(join(tmpdir(), 'gen-')); process.chdir(tempRoot); });
afterEach(() => { process.chdir(origCwd); rmSync(tempRoot, { recursive: true, force: true }); });

/** mock engine：正文返回 chapterText，finalizer 的两次调用返回合法 JSON。
 *  同时记录 user prompt 与 systemPrompt（bible 现走 systemPrompt 缓存）。*/
function mockEngine(chapterText: string, summaryResp?: string, stateResp?: string): AIAgentAdapter & { prompts: string[]; systemPrompts: string[] } {
  const prompts: string[] = [];
  const systemPrompts: string[] = [];
  let call = 0;
  const defState = JSON.stringify({ characters: [{ name: '李川', items: [], abilities: [], status: '健康', relationships: [], events: [] }] });
  const defSummary = JSON.stringify({ macroSummary: '前情摘要更新后的内容，描述主线推进。', openForeshadows: [] });
  return {
    name: 'mock', prompts, systemPrompts,
    async run(prompt: string, o: RunOptions): Promise<CallResult> {
      prompts.push(prompt);
      systemPrompts.push(o.systemPrompt ?? '');
      call++;
      // 第 1 次是正文生成，后续是 finalizer 的 summary + state
      const text = call === 1 ? chapterText : (call === 2 ? (summaryResp ?? defSummary) : (stateResp ?? defState));
      return { text, usage: { inputTokens: 100, outputTokens: 200, costRmb: 0.002, model: 'mock', durationMs: 1 }, notes: [] };
    },
    async isAvailable() { return true; },
  };
}

/** 在 DB 里建好 bible（generator 依赖 getBibleForChapter）*/
function seedBible(db: ReturnType<typeof openDb>, projectId: string) {
  const charState: CharacterState = { characters: [{ name: '李川', items: ['背包'], abilities: ['感知'], status: '健康', relationships: ['苏婉'], events: [] }] };
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
  ).run(projectId, '{"premise":"核心"}', '{"characters":[]}', JSON.stringify(charState), '{}', JSON.stringify(plot), '设定全文...', now, now);
}

describe('generateChapter', () => {
  it('第一章生成正文 + finalizer（3 次 LLM 调用）', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    seedBible(db, p.id);
    saveOutlines(db, p.id, [
      { number: 1, title: '苏醒', act: 1, beat: '铺垫', role: '引入', purpose: '介绍主角和核心矛盾冲突', suspenseLevel: 5, foreshadowing: '埋设：项链', twistLevel: 2, summary: '主角醒来发现世界变了' },
    ]);
    const engine = mockEngine('这是第一章的正文内容，描述主角苏醒后的场景。'.repeat(20));

    const r = await generateChapter({ engine, db, projectId: p.id, number: 1, wordCount: 500 });

    assert.equal(r.number, 1);
    assert.ok(r.content.length > 0);
    assert.ok(r.wordCount > 0);
    assert.equal(getChapter(db, p.id, 1)?.content, r.content);
    closeDb(db);
  });

  it('第一章 systemPrompt 含 bible 全文（走缓存），user prompt 不含「最近章节原文」', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    seedBible(db, p.id);
    saveOutlines(db, p.id, [
      { number: 1, title: '苏醒', act: 1, beat: '铺垫', role: '引入', purpose: '介绍主角和核心矛盾冲突', suspenseLevel: 5, foreshadowing: '埋设：项链', twistLevel: 2, summary: '主角醒来' },
    ]);
    const engine = mockEngine('正文内容。'.repeat(50));

    await generateChapter({ engine, db, projectId: p.id, number: 1, wordCount: 500 });
    // bible 全文现走 systemPrompt（enableCache），不再在 user prompt 里
    const firstSystem = engine.systemPrompts[0];
    assert.ok(firstSystem.includes('设定全文'), '第一章 systemPrompt 应含 bible');
    assert.ok(!engine.prompts[0].includes('设定全文'), '第一章 user prompt 不应含 bible（已移入 system）');
    closeDb(db);
  });

  it('checkpoint：已存在的章节跳过', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    seedBible(db, p.id);
    saveOutlines(db, p.id, [
      { number: 1, title: 'A', act: 1, beat: '铺垫', role: 'r', purpose: '核心作用明确且具体', suspenseLevel: 3, foreshadowing: '无', twistLevel: 0, summary: '梗概' },
    ]);
    // 预先写入已存在的章节
    saveChapter(db, p.id, 1, { title: '已存在', content: '旧内容', wordCount: 100 });

    const engine = mockEngine('不该被调用'.repeat(50));
    const r = await generateChapter({ engine, db, projectId: p.id, number: 1, wordCount: 500 });

    assert.equal(engine.prompts.length, 0, '已有章节不应调 LLM');
    assert.equal(r.content, '旧内容');
    closeDb(db);
  });

  it('后续章 prompt 含最近章节原文', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genre: 'g', audience: 'a', topic: 't' });
    seedBible(db, p.id);
    saveOutlines(db, p.id, [
      { number: 1, title: '一', act: 1, beat: '铺垫', role: 'r', purpose: '第一章核心作用明确', suspenseLevel: 3, foreshadowing: '无', twistLevel: 0, summary: '梗概一' },
      { number: 2, title: '二', act: 1, beat: '推进', role: 'r', purpose: '第二章核心作用明确', suspenseLevel: 4, foreshadowing: '无', twistLevel: 1, summary: '梗概二' },
    ]);
    // 预存第 1 章正文
    saveChapter(db, p.id, 1, { title: '第一章', content: '前一章的正文内容unique_marker', wordCount: 100 });

    const engine = mockEngine('第二章正文内容。'.repeat(50));
    await generateChapter({ engine, db, projectId: p.id, number: 2, wordCount: 500 });
    const firstPrompt = engine.prompts[0];
    assert.ok(firstPrompt.includes('unique_marker'), '后续章 prompt 应含前一章原文');
    closeDb(db);
  });
});
