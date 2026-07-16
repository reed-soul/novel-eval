/**
 * 蓝图生成器单测（两层拆分：幕→段落→章节）
 *
 * mock engine 按调用顺序返回预设 JSON，验证：
 *   1. 三幕各调 2 次（段落 + 章节）= 6 次
 *   2. 章节落 DB 且章号连续，outline 为 approved revision 1
 *   3. beats 先持久化；重跑读已持久化 beats，不重新生成
 *   4. checkpoint：outline 已齐则跳过
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';

import { createProject } from '../../src/project.ts';
import { generateBlueprint } from '../../src/chapter/blueprint.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import type { PlotArchitecture, CharacterDynamic } from '../../src/bible/types.ts';
import { createTestDb } from '../helpers/test-db.ts';
import { fixtureTime } from '../helpers/fixtures.ts';

/**
 * mock engine：按 prompt 内容派发响应（不依赖严格顺序，避免 callWithValidation 重试打乱索引）。
 * - 含「叙事段落」关键字 → beats 响应
 * - 含「章节蓝图」或「章节预算」关键字 → chapters 响应
 */
function mockEngine(opts: {
  beats: (act: number) => string;
  chapters: (start: number, act: number, budget: number) => string;
  actStart: Record<number, number>;
}): AIAgentAdapter & { calls: number; prompts: string[]; beatCalls: number } {
  const prompts: string[] = [];
  let calls = 0;
  let beatCalls = 0;
  return {
    name: 'mock',
    calls: 0,
    beatCalls: 0,
    prompts,
    async run(prompt: string, _o: RunOptions): Promise<CallResult> {
      prompts.push(prompt);
      calls++;
      (this as { calls: number }).calls = calls;
      if (prompt.includes('叙事段落') && !prompt.includes('展开成具体章节')) {
        beatCalls++;
        (this as { beatCalls: number }).beatCalls = beatCalls;
        const actMatch = prompt.match(/第(\d)幕/);
        const act = actMatch ? parseInt(actMatch[1], 10) : 1;
        return {
          text: opts.beats(act),
          usage: { inputTokens: 50, outputTokens: 100, costRmb: 0.001, model: 'mock', durationMs: 1 },
          notes: [],
        };
      }
      const actMatch = prompt.match(/第(\d)幕/);
      const act = actMatch ? parseInt(actMatch[1], 10) : 1;
      const startMatch = prompt.match(/章号从\s*(\d+)/);
      const start = startMatch ? parseInt(startMatch[1], 10) : (opts.actStart[act] ?? 1);
      const budgetMatch = prompt.match(/章节预算：\s*(\d+)\s*章/);
      const budget = budgetMatch ? parseInt(budgetMatch[1], 10) : 2;
      return {
        text: opts.chapters(start, act, budget),
        usage: { inputTokens: 50, outputTokens: 100, costRmb: 0.001, model: 'mock', durationMs: 1 },
        notes: [],
      };
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
  {
    name: '李川', role: '主角', background: '殖民地孤儿', secret: '混血',
    drives: { surface: '活', deep: '真相', soul: '信任' },
    arc: { start: 'a', trigger: 'b', shift: 'c', end: 'd' },
    relationships: [{ target: '苏婉', type: '盟友', note: 'n' }],
  },
  {
    name: '苏婉', role: '导师', background: '军官', secret: '知情者',
    drives: { surface: '任务', deep: '赎罪', soul: '放下' },
    arc: { start: 'a', trigger: 'b', shift: 'c', end: 'd' },
    relationships: [{ target: '李川', type: '盟友', note: 'n' }],
  },
];

const beatResp = (n: number) => JSON.stringify({
  beats: [
    { position: '铺垫', goal: `第${n}幕段落一的叙事目标要明确`, foreshadows: ['埋设：神秘项链'], tension: 4 },
    { position: '高潮', goal: `第${n}幕段落二的叙事目标同样明确`, foreshadows: ['回收：神秘项链'], tension: 8 },
  ],
});

const chapResp = (start: number, act: number, budget: number = 2) => {
  const chapters = [];
  for (let i = 0; i < budget; i++) {
    const n = start + i;
    chapters.push({
      number: n,
      title: `第${n}章标题`,
      beat: i < budget / 2 ? '铺垫' : '高潮',
      role: i === 0 ? '引入角色' : '推进冲突',
      purpose: `第${act}幕第${i + 1}章的核心作用明确`,
      suspense_level: Math.min(10, 4 + i),
      foreshadowing: i === 0 ? '埋设：神秘项链' : '回收：神秘项链',
      twist_level: Math.min(10, 1 + i),
      summary: `这是第${n}章的详细梗概，本章主角将发现关键线索，推进主线情节，同时埋下重要伏笔引发后续悬念。`,
    });
  }
  return JSON.stringify({ chapters });
};

function seedActiveBible(
  db: ReturnType<typeof createTestDb>['db'],
  projectId: ReturnType<typeof createProject>['id'],
): string {
  const planning = new PlanningRepository(db);
  const bible = planning.saveBibleRevision({
    id: `bible-${projectId}`,
    projectId,
    revisionNumber: 1,
    status: 'approved',
    bible: {
      coreSeed: { premise: '殖民地孤儿对抗虫族' },
      plotArchitecture: PLOT as unknown as Record<string, unknown>,
    },
    compiledText: '设定全文',
    createdAt: fixtureTime,
  });
  new ProjectRepository(db).setActiveBibleRevision(projectId, bible.id, fixtureTime);
  return bible.id;
}

describe('generateBlueprint', () => {
  it('两层拆分：3 幕各调段落+章节，落 DB 且章号连续；outline 为 approved revision 1', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedActiveBible(testDb.db, p.id);

    const engine = mockEngine({
      beats: beatResp,
      chapters: chapResp,
      actStart: { 1: 1, 2: 5, 3: 9 },
    });

    const { outlines } = await generateBlueprint({
      engine,
      db: testDb.db,
      projectId: p.id,
      plot: PLOT,
      characters: CHARS,
      totalChapters: 12,
    });

    assert.ok(outlines.length >= 6, `应至少 6 章，实际 ${outlines.length}`);
    assert.equal(outlines[0].number, 1);
    for (let i = 0; i < outlines.length; i++) {
      assert.equal(outlines[i].number, i + 1, `第 ${i} 个章号应为 ${i + 1}`);
    }
    const actSet = new Set(outlines.map((o) => o.act));
    assert.ok(actSet.has(1) && actSet.has(2) && actSet.has(3), '应覆盖三幕');

    const planning = new PlanningRepository(testDb.db);
    for (const outline of outlines) {
      const approved = planning.getApprovedOutlineAtPosition(p.id, outline.number);
      assert.ok(approved, `position ${outline.number} 应为 approved`);
      assert.equal(approved.outline.id, outline.id);
      assert.equal(approved.outline.status, 'approved');
      assert.equal(approved.revision.revisionNumber, 1);
      assert.equal(approved.revision.status, 'approved');
      assert.equal(approved.revision.title, outline.title);
    }
  });

  it('beats 在 outline 生成前持久化；重跑读取已持久化 beats 而不重新生成', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedActiveBible(testDb.db, p.id);
    const planning = new PlanningRepository(testDb.db);

    let beatGeneration = 0;
    const engine1 = mockEngine({
      beats: (act) => {
        beatGeneration += 1;
        return JSON.stringify({
          beats: [
            {
              position: '铺垫',
              goal: `第一代第${act}幕段落一的叙事目标要明确`,
              foreshadows: ['埋设：神秘项链'],
              tension: 4,
            },
            {
              position: '高潮',
              goal: `第一代第${act}幕段落二的叙事目标同样明确`,
              foreshadows: ['回收：神秘项链'],
              tension: 8,
            },
          ],
        });
      },
      chapters: () => {
        throw new Error('故意在章节生成前中断');
      },
      actStart: { 1: 1, 2: 5, 3: 9 },
    });

    await assert.rejects(
      () => generateBlueprint({
        engine: engine1,
        db: testDb.db,
        projectId: p.id,
        plot: PLOT,
        characters: CHARS,
        totalChapters: 12,
      }),
      /故意在章节生成前中断/,
    );

    const persistedBeats = planning.listBeats(p.id);
    assert.ok(persistedBeats.length >= 2, '中断前应将已生成 beats 落库');
    assert.equal(beatGeneration, 3, '三幕 beats 都应已生成');
    const firstGoals = persistedBeats.map((b) => {
      const goal = b.content.goal;
      assert.equal(typeof goal, 'string');
      return goal;
    });

    const engine2 = mockEngine({
      beats: () => JSON.stringify({
        beats: [
          { position: '铺垫', goal: '第二代不同目标AAAAAAAA', foreshadows: [], tension: 1 },
          { position: '高潮', goal: '第二代不同目标BBBBBBBB', foreshadows: [], tension: 2 },
        ],
      }),
      chapters: chapResp,
      actStart: { 1: 1, 2: 5, 3: 9 },
    });

    const { beats } = await generateBlueprint({
      engine: engine2,
      db: testDb.db,
      projectId: p.id,
      plot: PLOT,
      characters: CHARS,
      totalChapters: 12,
    });

    assert.equal(engine2.beatCalls, 0, '重跑不应重新生成 beats');
    const goalsAfter = planning.listBeats(p.id).map((b) => b.content.goal);
    assert.deepEqual(goalsAfter, firstGoals);
    assert.ok(
      Object.values(beats).flat().some((b) => b.goal.includes('第一代')),
      '返回的 beats 应来自已持久化内容',
    );
  });

  it('checkpoint：已有全部 outline 则跳过，不调 LLM', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedActiveBible(testDb.db, p.id);

    const engine1 = mockEngine({ beats: beatResp, chapters: chapResp, actStart: { 1: 1, 2: 5, 3: 9 } });
    const first = await generateBlueprint({
      engine: engine1,
      db: testDb.db,
      projectId: p.id,
      plot: PLOT,
      characters: CHARS,
      totalChapters: 12,
    });
    const firstIds = first.outlines.map((o) => o.id);

    const engine2 = mockEngine({ beats: beatResp, chapters: chapResp, actStart: { 1: 1, 2: 5, 3: 9 } });
    const { outlines } = await generateBlueprint({
      engine: engine2,
      db: testDb.db,
      projectId: p.id,
      plot: PLOT,
      characters: CHARS,
      totalChapters: 12,
    });
    assert.equal(engine2.calls, 0, 'checkpoint 后不应调 LLM');
    assert.equal(outlines.length, first.outlines.length);
    assert.deepEqual(outlines.map((o) => o.id), firstIds, 'outline ID 应稳定');
  });

  it('段落生成失败时抛错', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const p = createProject(testDb.db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedActiveBible(testDb.db, p.id);

    const engine = mockEngine({
      beats: () => JSON.stringify({ wrong: true }),
      chapters: chapResp,
      actStart: { 1: 1, 2: 5, 3: 9 },
    });
    await assert.rejects(
      () => generateBlueprint({
        engine,
        db: testDb.db,
        projectId: p.id,
        plot: PLOT,
        characters: CHARS,
        totalChapters: 12,
      }),
      /段落生成失败/,
    );
  });
});
