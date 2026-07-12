/**
 * assessChapters 单测（内存版评估，mock engine）
 *
 * 验证 assessChapters 串起 map + reduce + 聚合，返回五维分数 + 等级。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';
import { assessChapters } from '../../src/assess.ts';

/** mock engine：按调用顺序返回预设响应（map 响应 + reduce 的 R1-R5 响应）*/
function mockEngine(responses: string[]): AIAgentAdapter {
  let i = 0;
  return {
    name: 'mock',
    async run(_p: string, _o: RunOptions): Promise<CallResult> {
      const text = responses[i++] ?? '{}';
      return { text, usage: { inputTokens: 100, outputTokens: 50, costRmb: 0.001, model: 'mock', durationMs: 1 }, notes: [] };
    },
    async isAvailable() { return true; },
  };
}

// map 响应：单章的 5 项输出
const MAP_RESP = JSON.stringify({
  summary: '本章描述主角在废弃殖民地苏醒，发现自己是唯一幸存者。',
  emotionalTension: 65,
  keyEvents: ['主角苏醒', '发现尸体', '收到通讯'],
  characters: ['凯尔', '艾拉'],
  excerpts: [
    { text: '冷光像一把手术刀', dimension: 'writingQuality', reason: '开篇意象精准' },
    { text: '寄生体在体内蠕动', dimension: 'emotionalResonance', reason: '恐惧氛围营造' },
    { text: '他伸手触碰面板', dimension: 'storyStructure', reason: '动作推进情节' },
  ],
});

// reduce 各步响应
const R1_RESP = JSON.stringify({
  characters: [
    { name: '凯尔', role: '主角', firstAppearance: 'ch001' },
    { name: '艾拉', role: '通讯者', firstAppearance: 'ch001' },
  ],
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
  curve: [{ chapterId: 'ch001', tension: 65, annotation: '开篇' }],
});
const R4_RESP = JSON.stringify({
  suggestions: [
    { dimension: 'characterization', content: '凯尔的内心独白可以更克制，少说教。' },
    { dimension: 'writingQuality', content: '部分描写略显堆砌，可精简。' },
  ],
});
const R5_RESP = JSON.stringify({
  positioning: '硬科幻悬疑', audienceFit: 75,
  comparables: [{ title: '类似作品A', similarity: 70, matchReason: '相似设定', differentiation: '更黑暗', referenceNote: '推断' }],
  disclaimer: '非实时市场数据',
});

describe('assessChapters', () => {
  it('串联 map+reduce，返回五维分数+等级+suggestions', async () => {
    const engine = mockEngine([MAP_RESP, R1_RESP, R2_RESP, R3_RESP, R4_RESP, R5_RESP]);
    const result = await assessChapters({
      engine,
      chapters: [{ id: 'ch001', title: '苏醒', content: '正文内容...' }],
      metadata: { genre: '科幻', targetAudience: '青年男性' },
    });

    assert.ok(result.totalScore > 0);
    assert.ok(['S', 'A', 'B', 'C', 'D'].includes(result.grade));
    assert.ok(result.dimensions.storyStructure.score === 75);
    assert.ok(result.dimensions.writingQuality.score === 80);
    assert.ok(result.suggestions.length === 2);
    assert.ok(result.chapters.length === 1);
    assert.ok(result.usage.costRmb > 0);
  });

  it('R2 失败时抛错（致命步骤）', async () => {
    // R2 返回不合法 JSON（缺 dimensions）
    const engine = mockEngine([MAP_RESP, R1_RESP, JSON.stringify({ wrong: true })]);
    await assert.rejects(
      assessChapters({
        engine,
        chapters: [{ id: 'ch001', title: '测试', content: '内容' }],
        metadata: { genre: '科幻', targetAudience: '青年' },
      }),
    );
  });
});
