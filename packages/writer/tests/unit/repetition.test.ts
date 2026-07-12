/**
 * 防重复检测单测（纯算法，无 LLM）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectRepetition } from '../../src/chapter/repetition.ts';

describe('detectRepetition', () => {
  it('原创内容 → ok', () => {
    const content = '凯尔走进实验室，培养舱里发出惨绿色的光。他伸手触碰面板，屏幕亮起一行编号。';
    const r = detectRepetition(content, []);
    assert.equal(r.verdict, 'ok');
    assert.equal(r.withinChapter < 0.15, true);
  });

  it('章内大量重复短语 → mild 或 severe', () => {
    // 构造高频重复：同一段话重复多次
    const segment = '惨绿色的光照亮了整个房间。';
    const content = segment.repeat(20);
    const r = detectRepetition(content, []);
    assert.ok(r.withinChapter > 0.15, `章内重复率应 >15%，实际 ${(r.withinChapter * 100).toFixed(1)}%`);
    assert.ok(r.verdict === 'mild' || r.verdict === 'severe');
    assert.ok(r.hotspots.length > 0, '应有 hotspot');
  });

  it('与前文高度相似（跨章重复）→ mild 或 severe', () => {
    const prev = '凯尔走进实验室，培养舱里发出惨绿色的光。他伸手触碰面板，屏幕亮起一行编号。寄生体在体内蠕动。';
    const content = '凯尔走进实验室，培养舱里发出惨绿色的光。他伸手触碰面板，屏幕亮起一行编号。寄生体在体内蠕动。之后他继续探索。';  // 大部分与前文相同
    const r = detectRepetition(content, [prev]);
    assert.ok(r.crossChapter > 0.25, `跨章相似度应 >0.25，实际 ${r.crossChapter.toFixed(2)}`);
    assert.ok(r.verdict === 'mild' || r.verdict === 'severe');
  });

  it('与前文不同 → 跨章低相似', () => {
    const prev = '艾拉在飞船上监控通讯，殖民地远在下方。她调整了天线频率。';
    const content = '凯尔走进实验室，培养舱里发出惨绿色的光。他伸手触碰面板，屏幕亮起一行编号。';
    const r = detectRepetition(content, [prev]);
    assert.ok(r.crossChapter < 0.25, `跨章相似度应 <0.25，实际 ${r.crossChapter.toFixed(2)}`);
  });

  it('空 recent 数组 → 跨章为 0，不报错', () => {
    const content = '这是一段完全原创的正文内容，没有任何重复的部分。';
    const r = detectRepetition(content, []);
    assert.equal(r.crossChapter, 0);
    assert.equal(r.verdict, 'ok');
  });
});
