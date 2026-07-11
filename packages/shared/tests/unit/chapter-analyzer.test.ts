/**
 * chapter-analyzer 单测（L2 AI 确认层）
 *
 * 用 mock AIAgentAdapter 验证决策逻辑，不调真实 LLM。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChapterRule } from '../../src/chapter/chapter-analyzer.ts';
import { splitChaptersWithMeta } from '../../src/chapter/chapter-splitter.ts';
import type { AIAgentAdapter, CallResult, RunOptions } from '../../src/engine/interface.ts';

/** 构造一个 mock engine：返回预设的 JSON 文本 */
function mockEngine(responseText: string): AIAgentAdapter {
  return {
    name: 'mock',
    async run(_prompt: string, _options: RunOptions): Promise<CallResult> {
      return {
        text: responseText,
        usage: { inputTokens: 100, outputTokens: 50, costRmb: 0.001, model: 'mock', durationMs: 10 },
        notes: [],
      };
    },
    async isAvailable(): Promise<boolean> { return true; },
  };
}

describe('analyzeChapterRule', () => {
  it('L1 低置信度 + LLM 给出有效正则 → useHeuristic=false 并重切', async () => {
    // 构造一个 L1 会回退单章的文本（无章节标志），但 LLM 给出能命中正文标题的正则
    // 这里文本本身就有「第X章」标题，但若 L1 因某种原因低置信，LLM 正则应能重切
    const fullText = '第一章 标题一\n正文一\n第二章 标题二\n正文二\n第三章 标题三\n正文三';
    // 但要让 L1 低置信度：用一个 L1 探测不到、LLM 正则能命中的场景
    // 用「## 第1话 ##」这类自定义格式，L1 正则不覆盖
    const customText = '## 第1话 开端 ##\n正文一\n## 第2话 发展 ##\n正文二\n## 第3话 高潮 ##\n正文三';
    const heuristic = splitChaptersWithMeta(customText);
    assert.equal(heuristic.confidence, 'low');  // 前置：L1 确实低置信

    const llmResp = JSON.stringify({
      hasClearChapters: true,
      pattern: '## 第N话 标题 ##，行首顶格',
      suggestedRegex: '^## 第\\d+话 .+ ##$',
      confidence: 'high',
    });
    const engine = mockEngine(llmResp);

    const result = await analyzeChapterRule(engine, customText, heuristic);

    assert.equal(result.useHeuristic, false);
    assert.equal(result.confidence, 'high');
    assert.ok(result.resplitChapters);
    assert.ok(result.resplitChapters!.length >= 2);
    void fullText;
  });

  it('L1 低置信度 + LLM 未给正则 → useHeuristic=true（沿用启发式）', async () => {
    const text = '这是一段没有任何章节标志的纯文本。';
    const heuristic = splitChaptersWithMeta(text);
    assert.equal(heuristic.confidence, 'low');

    const llmResp = JSON.stringify({
      hasClearChapters: false,
      pattern: '无明显章节结构',
      suggestedRegex: '',
      confidence: 'low',
    });
    const engine = mockEngine(llmResp);

    const result = await analyzeChapterRule(engine, text, heuristic);
    assert.equal(result.useHeuristic, true);
    assert.equal(result.resplitChapters, null);
  });

  it('L1 高置信度 → 默认沿用启发式（不因 LLM 给正则而盲改）', async () => {
    const text = '第一章 A\n正文\n第二章 B\n正文';
    const heuristic = splitChaptersWithMeta(text);
    assert.equal(heuristic.confidence, 'high');

    // 即使 LLM 给了正则，L1 已 high 时不应重切（保守，避免无谓改动）
    const llmResp = JSON.stringify({
      hasClearChapters: true,
      pattern: '第X章 标题',
      suggestedRegex: '^第[一二三]章 .+$',
      confidence: 'high',
    });
    const engine = mockEngine(llmResp);

    const result = await analyzeChapterRule(engine, text, heuristic);
    assert.equal(result.useHeuristic, true);
    assert.equal(result.resplitChapters, null);
  });

  it('LLM 调用失败（返回坏 JSON）→ 保守沿用启发式', async () => {
    const text = '无章节标志的文本';
    const heuristic = splitChaptersWithMeta(text);
    const engine = mockEngine('这不是合法 JSON {{{');

    const result = await analyzeChapterRule(engine, text, heuristic);
    assert.equal(result.useHeuristic, true);
    assert.equal(result.resplitChapters, null);
    assert.match(result.pattern, /沿用启发式|失败/);
  });
});
