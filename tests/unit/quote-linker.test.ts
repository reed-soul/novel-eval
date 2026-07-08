/**
 * excerpts 回链单测（对齐设计文档 v2.2「原文证据机制」）
 *
 * 这是 v2.2 修复的核心模块——spike 发现原 R2 摘录回链 0%，
 * 改为 Map 产 excerpts 后命中 92%。测试必须锁住三条路径。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { linkExcerpt, linkExcerpts } from '../../src/engine/quote-linker.ts';
import type { RawExcerpt } from '../../src/types.ts';

describe('linkExcerpt', () => {
  const chapterContent = '旧历的年底毕竟最像年底。灰白色的沉重的晚云中间时常漏出些星光。我回到相别了多年的故乡。';

  it('精确匹配：逐字摘录命中 offset', () => {
    const raw: RawExcerpt = {
      text: '灰白色的沉重的晚云',
      dimension: 'writingQuality',
      reason: '环境描写',
    };
    const result = linkExcerpt(raw, 'ch001', new Map([['ch001', chapterContent]]));
    assert.equal(result.matchedBy, 'exact');
    assert.equal(result.offset, chapterContent.indexOf('灰白色的沉重的晚云'));
    assert.equal(result.chapterId, 'ch001');
  });

  it('模糊匹配：全角标点差异仍命中', () => {
    // 原文用全角逗号，摘录用半角——归一化后应匹配
    const raw: RawExcerpt = {
      text: '旧历的年底,毕竟最像年底',
      dimension: 'storyStructure',
      reason: '开篇',
    };
    const result = linkExcerpt(raw, 'ch001', new Map([['ch001', chapterContent]]));
    assert.equal(result.matchedBy, 'fuzzy');
    assert.notEqual(result.offset, null);
  });

  it('模糊匹配：空白差异仍命中', () => {
    const raw: RawExcerpt = {
      text: '我回到 相别了 多年的故乡',
      dimension: 'emotionalResonance',
      reason: '归乡情感',
    };
    const result = linkExcerpt(raw, 'ch001', new Map([['ch001', chapterContent]]));
    assert.equal(result.matchedBy, 'fuzzy');
    assert.notEqual(result.offset, null);
  });

  it('未匹配：摘录文本原文不存在 → offset=null', () => {
    const raw: RawExcerpt = {
      text: '这段文字原文里根本没有',
      dimension: 'characterization',
      reason: '不存在',
    };
    const result = linkExcerpt(raw, 'ch001', new Map([['ch001', chapterContent]]));
    assert.equal(result.matchedBy, 'none');
    assert.equal(result.offset, null);
  });

  it('章节不存在 → offset=null, matchedBy=none', () => {
    const raw: RawExcerpt = {
      text: '任何内容',
      dimension: 'storyStructure',
      reason: '测试',
    };
    const result = linkExcerpt(raw, 'ch999', new Map([['ch001', chapterContent]]));
    assert.equal(result.matchedBy, 'none');
    assert.equal(result.offset, null);
  });

  it('保留原始字段（text/dimension/reason）不变', () => {
    const raw: RawExcerpt = {
      text: '灰白色的沉重的晚云',
      dimension: 'writingQuality',
      reason: '环境描写',
    };
    const result = linkExcerpt(raw, 'ch001', new Map([['ch001', chapterContent]]));
    assert.equal(result.text, raw.text);
    assert.equal(result.dimension, raw.dimension);
    assert.equal(result.reason, raw.reason);
  });
});

describe('linkExcerpts（批量）', () => {
  const chapters = new Map([
    ['ch001', '第一章的内容。母亲说这个家总得有人在。'],
    ['ch002', '第二章。林晚说再说吧。'],
  ]);

  it('返回正确统计（exact/fuzzy/none）', () => {
    const raws = [
      { text: '母亲说这个家总得有人在', dimension: 'emotionalResonance' as const, reason: 'r', chapterId: 'ch001' },
      { text: '林晚说，再说吧', dimension: 'characterization' as const, reason: 'r', chapterId: 'ch002' },  // 全角逗号差异→fuzzy
      { text: '不存在的文本', dimension: 'storyStructure' as const, reason: 'r', chapterId: 'ch001' },  // none
    ];
    const { linked, stats } = linkExcerpts(raws, chapters);
    assert.equal(stats.total, 3);
    assert.equal(stats.exact, 1);
    assert.equal(stats.fuzzy, 1);
    assert.equal(stats.none, 1);
    assert.equal(linked.length, 3);
  });

  it('空数组返回零统计', () => {
    const { stats } = linkExcerpts([], chapters);
    assert.equal(stats.total, 0);
    assert.equal(stats.exact, 0);
  });
});
