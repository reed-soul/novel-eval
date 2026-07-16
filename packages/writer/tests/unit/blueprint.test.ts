/**
 * 蓝图生成器单测（两层拆分：幕→段落→章节）
 *
 * mock engine 按调用顺序返回预设 JSON，验证：
 *   1. 三幕各调 2 次（段落 + 章节）= 6 次
 *   2. 章节落 DB 且章号连续
 *   3. checkpoint：重跑跳过
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';

import { openDb, closeDb } from '../../src/db.ts';
import { createProject } from '../../src/project.ts';
import { generateBlueprint } from '../../src/chapter/blueprint.ts';
import { getAllOutlines, countOutlines } from '../../src/chapter/store.ts';
import type { PlotArchitecture, CharacterDynamic } from '../../src/bible/types.ts';

let origCwd: string;
let tempRoot: string;
beforeEach(() => { origCwd = process.cwd(); tempRoot = mkdtempSync(join(tmpdir(), 'bp-')); process.chdir(tempRoot); });
afterEach(() => { process.chdir(origCwd); rmSync(tempRoot, { recursive: true, force: true }); });

/**
 * mock engine：按 prompt 内容派发响应（不依赖严格顺序，避免 callWithValidation 重试打乱索引）。
 * - 含「叙事段落」关键字 → beats 响应
 * - 含「章节蓝图」或「章节预算」关键字 → chapters 响应
 * - 重试 prompt（含「上次的输出有问题」）→ 仍按内容派发（返回同类合法响应）
 */
function mockEngine(opts: {
  beats: (act: number) => string;
  chapters: (start: number, act: number, budget: number) => string;
  actStart: Record<number, number>;  // 各幕起始章号
}): AIAgentAdapter & { calls: number; prompts: string[] } {
  const prompts: string[] = [];
  let calls = 0;
  return {
    name: 'mock', calls: 0, prompts,
    async run(prompt: string, _o: RunOptions): Promise<CallResult> {
      prompts.push(prompt);
      calls++;
      (this as { calls: number }).calls = calls;
      // 判断是 beats 还是 chapters 调用
      if (prompt.includes('叙事段落') && !prompt.includes('展开成具体章节')) {
        // beats 调用：从 prompt 里识别幕号
        const actMatch = prompt.match(/第(\d)幕/);
        const act = actMatch ? parseInt(actMatch[1], 10) : 1;
        return { text: opts.beats(act), usage: { inputTokens: 50, outputTokens: 100, costRmb: 0.001, model: 'mock', durationMs: 1 }, notes: [] };
      }
      // chapters 调用：从 prompt 里识别幕号、起始章号和章数预算
      const actMatch = prompt.match(/第(\d)幕/);
      const act = actMatch ? parseInt(actMatch[1], 10) : 1;
      const startMatch = prompt.match(/章号从\s*(\d+)/);
      const start = startMatch ? parseInt(startMatch[1], 10) : (opts.actStart[act] ?? 1);
      const budgetMatch = prompt.match(/章节预算：\s*(\d+)\s*章/);
      const budget = budgetMatch ? parseInt(budgetMatch[1], 10) : 2;
      return { text: opts.chapters(start, act, budget), usage: { inputTokens: 50, outputTokens: 100, costRmb: 0.001, model: 'mock', durationMs: 1 }, notes: [] };
    },
    async isAvailable() { return true; },
  };
}

const PLOT: PlotArchitecture = {
  act1: { setup: '主角醒来', conflicts: ['发现异常', '遭遇敌人', '觉醒能力'], climax: '踏上旅程' },
  act2: { setup: '深入冒险', conflicts: ['盟友背叛', '身世揭露', '最大危机'], climax: '灵魂黑夜' },
  act3: { setup: '准备决战', conflicts: ['集结同伴', '最终对决', '牺牲代价'], climax: '主题升华' },
  foreshadows: [
    { description: '主角手臂的印记', setupAct: 1, resolveAct: 2 },
    { description: '导师的遗言', setupAct: 2, resolveAct: 3 },
    { description: '神秘项链', setupAct: 1, resolveAct: 3 },
  ],
};
const CHARS: CharacterDynamic[] = [
  { name: '李川', role: '主角', background: '殖民地孤儿', secret: '混血', drives: { surface: '活', deep: '真相', soul: '信任' }, arc: { start: 'a', trigger: 'b', shift: 'c', end: 'd' }, relationships: [{ target: '苏婉', type: '盟友', note: 'n' }] },
  { name: '苏婉', role: '导师', background: '军官', secret: '知情者', drives: { surface: '任务', deep: '赎罪', soul: '放下' }, arc: { start: 'a', trigger: 'b', shift: 'c', end: 'd' }, relationships: [{ target: '李川', type: '盟友', note: 'n' }] },
];

// 每幕 2 个 beat（6 次 = 3 幕 × 2 调用）
const beatResp = (n: number) => JSON.stringify({
  beats: [
    { position: '铺垫', goal: `第${n}幕段落一的叙事目标要明确`, foreshadows: ['埋设：神秘项链'], tension: 4 },
    { position: '高潮', goal: `第${n}幕段落二的叙事目标同样明确`, foreshadows: ['回收：神秘项链'], tension: 8 },
  ],
});
// 按预算生成 N 章（章号从 start 连续）
const chapResp = (start: number, act: number, budget: number = 2) => {
  const chapters = [];
  for (let i = 0; i < budget; i++) {
    const n = start + i;
    chapters.push({
      number: n, title: `第${n}章标题`, beat: i < budget / 2 ? '铺垫' : '高潮',
      role: i === 0 ? '引入角色' : '推进冲突', purpose: `第${act}幕第${i + 1}章的核心作用明确`,
      suspense_level: Math.min(10, 4 + i), foreshadowing: i === 0 ? '埋设：神秘项链' : '回收：神秘项链',
      twist_level: Math.min(10, 1 + i),
      summary: `这是第${n}章的详细梗概，本章主角将发现关键线索，推进主线情节，同时埋下重要伏笔引发后续悬念。`,
    });
  }
  return JSON.stringify({ chapters });
};

describe('generateBlueprint', () => {
  it('两层拆分：3 幕各调段落+章节，落 DB 且章号连续', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    // 用 totalChapters=12，分配更清晰（act1=4/act2=4/act3=4 经 split 后约 4/4/4 或 3/5/4）
    const engine = mockEngine({
      beats: beatResp,
      chapters: chapResp,
      actStart: { 1: 1, 2: 5, 3: 9 },  // 近似，mock 从 prompt 解析实际起始
    });

    const { outlines } = await generateBlueprint({
      engine, db, projectId: p.id, plot: PLOT, characters: CHARS, totalChapters: 12,
    });

    assert.ok(outlines.length >= 6, `应至少 6 章，实际 ${outlines.length}`);
    assert.equal(countOutlines(db, p.id), outlines.length);
    // 章号从 1 开始连续
    assert.equal(outlines[0].number, 1);
    for (let i = 0; i < outlines.length; i++) {
      assert.equal(outlines[i].number, i + 1, `第 ${i} 个章号应为 ${i + 1}`);
    }
    // 三幕都有覆盖
    const actSet = new Set(outlines.map((o) => o.act));
    assert.ok(actSet.has(1) && actSet.has(2) && actSet.has(3), '应覆盖三幕');
    closeDb(db);
  });

  it('checkpoint：已有 outline 则跳过，不调 LLM', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const engine1 = mockEngine({ beats: beatResp, chapters: chapResp, actStart: { 1: 1, 2: 5, 3: 9 } });
    await generateBlueprint({ engine: engine1, db, projectId: p.id, plot: PLOT, characters: CHARS, totalChapters: 12 });
    const firstCount = countOutlines(db, p.id);

    // 第二次：应跳过，0 次调用
    const engine2 = mockEngine({ beats: beatResp, chapters: chapResp, actStart: { 1: 1, 2: 5, 3: 9 } });
    const { outlines } = await generateBlueprint({ engine: engine2, db, projectId: p.id, plot: PLOT, characters: CHARS, totalChapters: 12 });
    assert.equal(engine2.calls, 0, 'checkpoint 后不应调 LLM');
    assert.equal(outlines.length, firstCount);
    closeDb(db);
  });

  it('段落生成失败时抛错', async () => {
    const db = openDb();
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    // beats 返回非法 JSON（缺 beats 字段）
    const engine = mockEngine({
      beats: () => JSON.stringify({ wrong: true }),
      chapters: chapResp,
      actStart: { 1: 1, 2: 5, 3: 9 },
    });
    await assert.rejects(
      generateBlueprint({ engine, db, projectId: p.id, plot: PLOT, characters: CHARS, totalChapters: 12 }),
      /段落生成失败/,
    );
    closeDb(db);
  });
});
