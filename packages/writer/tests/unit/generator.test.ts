/**
 * Bible 生成器单测（雪花法 4 步编排）
 *
 * 用 mock engine 按步骤返回预设 JSON，验证：
 *   1. 4 步顺序执行且每步 schema 校验通过
 *   2. 上下文隔离（world_building 步骤的 prompt 不含 character_dynamics）
 *   3. checkpoint：中途写 SQLite 后重跑能跳过已完成步
 *   4. full_text 拼接包含各段内容
 *
 * 不调真实 LLM。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';

import { openDb, closeDb, type DB } from '../../src/db.ts';
import { createProject } from '../../src/project.ts';
import { generateBible } from '../../src/bible/generator.ts';

let origCwd: string;
let tempRoot: string;

beforeEach(() => {
  origCwd = process.cwd();
  tempRoot = mkdtempSync(join(tmpdir(), 'writer-gen-'));
  process.chdir(tempRoot);
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tempRoot, { recursive: true, force: true });
});

/** mock engine：按调用顺序返回预设响应。记录每次 prompt 供断言上下文隔离。 */
function mockEngine(responses: string[]): AIAgentAdapter & { prompts: string[] } {
  const prompts: string[] = [];
  let callIdx = 0;
  return {
    name: 'mock',
    prompts,
    async run(prompt: string, _options: RunOptions): Promise<CallResult> {
      prompts.push(prompt);
      const text = responses[callIdx++] ?? '{}';
      return {
        text,
        usage: { inputTokens: 100, outputTokens: 50, costRmb: 0.001, model: 'mock', durationMs: 5 },
        notes: [],
      };
    },
    async isAvailable() { return true; },
  };
}

// ─── 预设的合法 JSON 响应 ─────────────────────────────────────────

const CORE_SEED_RESP = JSON.stringify({ premise: '当少年探险者李川遭遇星际虫族入侵，必须找到失落的星舰核心，否则人类殖民地将在三日内沦陷；与此同时，一个隐藏的叛徒正在瓦解最后的防线。' });

const CHAR_DYNAMICS_RESP = JSON.stringify({
  characters: [
    {
      name: '李川', role: '主角', background: '殖民地孤儿，靠拾荒长大，天生能感知虫族的存在', secret: '他是半虫族混血，身份一旦暴露将被处决',
      drives: { surface: '活下去', deep: '找到身世真相', soul: '学会信任他人' },
      arc: { start: '孤僻拾荒者', trigger: '殖民地被袭', shift: '发现自己的混血身份', end: '人类与虫族的桥梁' },
      relationships: [{ target: '苏婉', type: '盟友', note: '信任与猜疑并存' }],
    },
    {
      name: '苏婉', role: '导师', background: '殖民地防卫军资深军官，身经百战的指挥官', secret: '她知道李川的真实身份并暗中保护',
      drives: { surface: '完成使命', deep: '赎罪', soul: '放下过去' },
      arc: { start: '冷酷军官', trigger: '遇见李川', shift: '被其坚韧打动', end: '牺牲自己掩护撤退' },
      relationships: [{ target: '李川', type: '盟友', note: '暗中保护' }],
    },
    {
      name: '叛徒', role: '反派', background: '殖民地议会核心成员，掌握殖民地最高决策权', secret: '他早已与虫族达成秘密交易出卖殖民地',
      drives: { surface: '权力', deep: '恐惧死亡', soul: '渴望被认可' },
      arc: { start: '受尊敬的议员', trigger: '虫族威胁', shift: '选择背叛', end: '被李川揭穿' },
      relationships: [{ target: '李川', type: '对手', note: '价值观根本对立' }],
    },
  ],
});

const CHAR_STATE_RESP = JSON.stringify({
  characters: [
    { name: '李川', items: ['拾荒背包'], abilities: ['虫族感知'], status: '健康，孤僻', relationships: ['苏婉：新认识'], events: [] },
    { name: '苏婉', items: ['军用手枪'], abilities: ['战术指挥'], status: '疲惫', relationships: ['李川：观察中'], events: [] },
    { name: '叛徒', items: ['议会徽章'], abilities: ['政治操控'], status: '焦虑', relationships: [], events: [] },
  ],
});

const WORLD_RESP = JSON.stringify({
  physical: {
    elements: ['殖民地穹顶（随时可能破裂）', '地下虫巢', '通讯干扰场'],
    tensions: ['穹顶材料老化', '氧气储备告急', '虫族夜行性'],
  },
  social: {
    elements: ['议会寡头制', '拾荒者底层阶层', '黑市军火贸易'],
    tensions: ['议会与军队权力之争', '阶层固化', '资源分配不均'],
  },
  metaphorical: {
    elements: ['穹顶=虚假安全感', '虫族=被压抑的恐惧', '星空=自由渴望'],
    tensions: ['穹顶裂缝暗示体制崩溃', '虫族地下活动隐喻潜伏危机', '星空遥不可及象征希望渺茫'],
  },
});

const PLOT_RESP = JSON.stringify({
  act1: {
    setup: '殖民地遭虫族突袭，李川在废墟中救出苏婉',
    conflicts: ['穹顶第一道裂缝', '议会拒绝升级防卫', '李川的虫族感知觉醒'],
    climax: '李川决定加入苏婉的突围小队，前往核心区',
  },
  act2: {
    setup: '小队在虫族封锁区艰难推进，发现叛徒线索',
    conflicts: ['苏婉重伤', '叛徒设下陷阱', '李川的混血身份暴露'],
    climax: '李川被小队抛弃，独自面对虫潮',
  },
  act3: {
    setup: '李川接纳混血身份，反向利用虫族感知',
    conflicts: ['揭穿叛徒', '重启星舰核心', '苏婉的牺牲'],
    climax: '李川成为人类与虫族沟通的桥梁，殖民地获得转机',
  },
  foreshadows: [
    { description: '李川手臂上的神秘虫纹印记会发光', setupAct: 1, resolveAct: 2 },
    { description: '苏婉临终前那句未说完的遗言', setupAct: 2, resolveAct: 3 },
    { description: '叛徒书房抽屉里的那封密信', setupAct: 1, resolveAct: 3 },
  ],
});

describe('generateBible', () => {
  it('4 步顺序执行，每步 schema 校验通过，生成完整 bible', async () => {
    const db = openDb();
    const project = createProject(db, { title: '星际殖民地', genreProfile: '科幻', targetAudience: '青年男性', premise: '虫族入侵' });
    const engine = mockEngine([CORE_SEED_RESP, CHAR_DYNAMICS_RESP, CHAR_STATE_RESP, WORLD_RESP, PLOT_RESP]);

    const { bible, usage } = await generateBible({
      engine, db, projectId: project.id,
      topic: '虫族入侵', genre: '科幻', audience: '青年男性',
    });

    // 4 步 + 2.5 = 5 次 LLM 调用
    assert.equal(engine.prompts.length, 5);
    // bible 结构完整
    assert.equal(bible.coreSeed.premise.length > 0, true);
    assert.equal(bible.characterDynamics.length, 3);
    assert.equal(bible.characterState.characters.length, 3);
    assert.equal(bible.worldBuilding.physical.elements.length, 3);
    assert.equal(bible.plotArchitecture.foreshadows.length, 3);
    // usage 累计（5 次 × 每次 0.001）
    assert.equal(usage.costRmb, 0.005);
    // full_text 拼接
    assert.ok(bible.fullText.includes('核心种子'));
    assert.ok(bible.fullText.includes('李川'));
    assert.ok(bible.fullText.includes('世界观'));
    assert.ok(bible.fullText.includes('伏笔'));
    closeDb(db);
  });

  it('上下文隔离：world_building 步骤的 prompt 不含 character_dynamics 的角色细节', async () => {
    const db = openDb();
    const project = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const engine = mockEngine([CORE_SEED_RESP, CHAR_DYNAMICS_RESP, CHAR_STATE_RESP, WORLD_RESP, PLOT_RESP]);

    await generateBible({
      engine, db, projectId: project.id, topic: 't', genre: 'g', audience: 'a',
    });

    const worldPrompt = engine.prompts[3];  // 第 4 次调用（index 3）是 world_building
    // world_building prompt 不应含 character_dynamics 的专属细节（驱动力三角、秘密、关系网）
    // 注意：coreSeed 里可能含角色名（一句话核心），那是允许的——隔离的是角色设计细节
    assert.equal(worldPrompt.includes('半虫族混血'), false, 'world_building 不应含角色秘密');
    assert.equal(worldPrompt.includes('驱动力三角'), false, 'world_building 不应含驱动力设计');
    assert.equal(worldPrompt.includes('暗中保护'), false, 'world_building 不应含关系网细节');
    // 但 plot_architecture（第 5 次调用）应汇集全部角色细节
    const plotPrompt = engine.prompts[4];
    assert.ok(plotPrompt.includes('半虫族混血'), 'plot_architecture 应含角色秘密');
    closeDb(db);
  });

  it('checkpoint：中途断开重跑能跳过已完成步', async () => {
    const db = openDb();
    const project = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });

    // 第一次：只跑前 2 步就停（模拟中断）—— 用只提供 2 个响应的 engine
    const engine1 = mockEngine([CORE_SEED_RESP, CHAR_DYNAMICS_RESP]);
    // generateBible 跑到 character_state 步会因 mock 返回 '{}' 校验失败而抛错
    await assert.rejects(
      generateBible({ engine: engine1, db, projectId: project.id, topic: 't', genre: 'g', audience: 'a' }),
    );
    // 此时 core_seed + character_dynamics 已写入 SQLite（checkpoint）

    // 第二次：用完整 5 响应的 engine 重跑——应跳过前 2 步，只调 3 次
    const engine2 = mockEngine([CHAR_STATE_RESP, WORLD_RESP, PLOT_RESP]);
    const { bible } = await generateBible({
      engine: engine2, db, projectId: project.id, topic: 't', genre: 'g', audience: 'a',
    });

    // 只调了 3 次（character_state + world + plot，前两步被跳过）
    assert.equal(engine2.prompts.length, 3);
    assert.equal(bible.characterDynamics.length, 3);  // 从 checkpoint 恢复
    assert.equal(bible.plotArchitecture.foreshadows.length, 3);
    closeDb(db);
  });

  it('core_seed 生成失败时抛错（致命步骤）', async () => {
    const db = openDb();
    const project = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    // 返回不合法 JSON（premise 过短，schema min:15 会失败）
    const engine = mockEngine([JSON.stringify({ premise: '太短' })]);

    await assert.rejects(
      generateBible({ engine, db, projectId: project.id, topic: 't', genre: 'g', audience: 'a' }),
      /核心种子生成失败/,
    );
    closeDb(db);
  });
});
