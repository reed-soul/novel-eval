/**
 * runReducePhase 单测 — full vs lite 模式回归
 *
 * 重点：防止 A 优化（mode 守卫跳过 R3/R5）误伤 evaluate() 依赖的 full 模式。
 *   - full 模式：跑完 R1..R5，emotionalCurve / marketBenchmark 非空
 *   - lite 模式：跳过 R3/R5，emotionalCurve 降级为 chapters 直映、marketBenchmark 为 null
 *
 * mock engine 按 systemPrompt 关键词路由（顺序无关，兼容 R1‖R3 / R4‖R5 并行调度）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';
import { runReducePhase } from '../../src/reduce-phase.ts';
import type { Chapter } from '../../src/types.ts';

function mockEngine(routes: { systemContains: string; response: string }[], fallback = '{}'): AIAgentAdapter {
  return {
    name: 'mock',
    async run(_p: string, o: RunOptions): Promise<CallResult> {
      const sys = o.systemPrompt ?? '';
      const hit = routes.find((r) => sys.includes(r.systemContains));
      const text = hit ? hit.response : fallback;
      return { text, usage: { inputTokens: 100, outputTokens: 50, costRmb: 0.001, model: 'mock', durationMs: 1 }, notes: [] };
    },
    async isAvailable() { return true; },
  };
}

// 一份「有 excerpt + 角色 + 张力」的输入 chapter（map 阶段的产物形态）
const INPUT_CHAPTER: Chapter = {
  id: 'ch001', title: '苏醒', content: '正文内容...',
  wordCount: 5, kind: '正文',
  summary: '本章描述主角在废弃殖民地苏醒，发现自己是唯一幸存者。',
  emotionalTension: 65,
  keyEvents: ['主角苏醒', '发现尸体'],
  characters: ['凯尔', '艾拉'],
  excerpts: [
    { text: '冷光像一把手术刀', dimension: 'writingQuality', reason: '开篇意象精准', chapterId: 'ch001', offset: 0 },
  ],
};

const R1_RESP = JSON.stringify({
  characters: [{ name: '凯尔', role: '主角', firstAppearance: 'ch001' }],
});
const R2_RESP = JSON.stringify({
  dimensions: {
    storyStructure: { score: 75, analysis: '结构完整，起承转合清晰，悬念层层递进，节奏把控精准，主线推进有力，各章节衔接自然流畅，伏笔设置合理且有回收空间。' },
    characterization: { score: 70, analysis: '角色立体，动机合理，但弧光尚不完整，部分配角略显扁平，需要更多展现内心冲突与成长轨迹的细节刻画与铺垫。' },
    writingQuality: { score: 80, analysis: '文笔精炼有个人风格辨识度，对话自然有潜台词，感官描写到位沉浸感强，但部分段落修辞略显堆砌可适当精简优化。' },
    emotionalResonance: { score: 72, analysis: '情感张力较强，代入感好，但情绪推进略显线性缺乏层次变化，高潮处可以更收敛以增强余韵和回味感与共鸣深度。' },
    marketPotential: { score: 68, analysis: '类型定位清晰，受众明确，但差异化卖点不够突出，需要在后续章节强化独特设定以形成市场竞争力与品牌辨识度。' },
  },
});
const R3_RESP = JSON.stringify({
  curve: [{ chapterId: 'ch001', tension: 70, annotation: '开场张力' }],
});
const R4_RESP = JSON.stringify({
  suggestions: [{ dimension: 'writingQuality', content: '部分描写略显堆砌，可精简。' }],
});
const R5_RESP = JSON.stringify({
  positioning: '硬科幻悬疑', audienceFit: 75,
  comparables: [{ title: '类似作品A', similarity: 70, matchReason: '相似设定', differentiation: '更黑暗', referenceNote: '推断' }],
  disclaimer: '非实时市场数据',
});

const FULL_ROUTES = [
  { systemContains: '人物谱系', response: R1_RESP },
  { systemContains: '小说总编', response: R2_RESP },
  { systemContains: '叙事节奏', response: R3_RESP },
  { systemContains: '改稿指导', response: R4_RESP },
  { systemContains: '出版市场', response: R5_RESP },
];

const WEIGHTS = { storyStructure: 0.25, characterization: 0.2, writingQuality: 0.2, emotionalResonance: 0.15, marketPotential: 0.2 };
const METADATA = { genre: '科幻', targetAudience: '青年男性' };

describe('runReducePhase', () => {
  it('full 模式：跑完 R1..R5，emotionalCurve / marketBenchmark 非空', async () => {
    const engine = mockEngine(FULL_ROUTES);
    const result = await runReducePhase(
      engine, [INPUT_CHAPTER], WEIGHTS, 'default', METADATA, undefined, 'full',
    );

    // 五维分数齐全
    assert.ok(result.dimensions.storyStructure.score === 75);
    // full 模式 R3 真实执行：emotionalCurve 来自 LLM（annotation 非空）
    assert.equal(result.emotionalCurve.length, 1);
    assert.equal(result.emotionalCurve[0].annotation, '开场张力');
    // full 模式 R5 真实执行：marketBenchmark 非空
    assert.ok(result.marketBenchmark !== null);
    assert.equal(result.marketBenchmark!.positioning, '硬科幻悬疑');
    assert.equal(result.failures.length, 0);
  });

  it('lite 模式：跳过 R3/R5，emotionalCurve 降级、marketBenchmark 为 null', async () => {
    // 即便 mock 提供了 R3/R5 响应，lite 模式也不会调用它们
    const engine = mockEngine(FULL_ROUTES);
    const result = await runReducePhase(
      engine, [INPUT_CHAPTER], WEIGHTS, 'default', METADATA, undefined, 'lite',
    );

    // 五维分数仍齐全（R2 必跑）
    assert.ok(result.dimensions.storyStructure.score === 75);
    // lite 模式 R3 未跑：emotionalCurve 是 chapters 直映（无 annotation）
    assert.equal(result.emotionalCurve.length, 1);
    assert.equal(result.emotionalCurve[0].tension, INPUT_CHAPTER.emotionalTension);
    assert.equal(result.emotionalCurve[0].annotation, undefined);
    // lite 模式 R5 未跑：marketBenchmark 为 null
    assert.equal(result.marketBenchmark, null);
    // suggestions 仍来自 R4
    assert.ok(result.suggestions.length === 1);
    assert.equal(result.failures.length, 0);
  });

  it('默认 mode 为 full（不传 mode 参数时行为等同 full）', async () => {
    const engine = mockEngine(FULL_ROUTES);
    const result = await runReducePhase(
      engine, [INPUT_CHAPTER], WEIGHTS, 'default', METADATA,
    );
    assert.ok(result.marketBenchmark !== null, '默认 mode 应为 full，R5 应执行');
  });

  it('R2 失败时抛错（致命步骤，无论 mode）', async () => {
    const engine = mockEngine([
      { systemContains: '人物谱系', response: R1_RESP },
      { systemContains: '小说总编', response: JSON.stringify({ wrong: true }) },
    ]);
    await assert.rejects(
      runReducePhase(engine, [INPUT_CHAPTER], WEIGHTS, 'default', METADATA, undefined, 'full'),
      /R2 五维评分失败/,
    );
  });
});
