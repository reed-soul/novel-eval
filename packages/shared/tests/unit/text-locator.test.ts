/**
 * text-locator 单测（从 quote-linker 抽出的通用核心，不依赖 Excerpt 类型）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { locateTextInContent } from '../../src/text/text-locator.ts';

describe('locateTextInContent', () => {
  const content = '旧历的年底毕竟最像年底。灰白色的沉重的晚云中间时常漏出些星光。我回到相别了多年的故乡。';

  it('精确匹配：逐字摘录命中 offset', () => {
    const r = locateTextInContent('灰白色的沉重的晚云', content);
    assert.equal(r.matchedBy, 'exact');
    assert.equal(r.offset, content.indexOf('灰白色的沉重的晚云'));
  });

  it('模糊匹配：全角标点差异仍命中', () => {
    // 原文用全角逗号，摘录用半角——归一化后应匹配
    const r = locateTextInContent('旧历的年底,毕竟最像年底', content);
    assert.equal(r.matchedBy, 'fuzzy');
    assert.notEqual(r.offset, null);
  });

  it('模糊匹配：空白差异仍命中', () => {
    const r = locateTextInContent('我回到 相别了 多年的故乡', content);
    assert.equal(r.matchedBy, 'fuzzy');
    assert.notEqual(r.offset, null);
  });

  it('未匹配：文本原文不存在 → offset=null', () => {
    const r = locateTextInContent('这段文字原文里根本没有', content);
    assert.equal(r.matchedBy, 'none');
    assert.equal(r.offset, null);
  });
});
