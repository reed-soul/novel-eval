import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appendTaskFeedback } from '../../src/chapter/corrector.ts';

describe('appendTaskFeedback', () => {
  it('returns base when task content empty', () => {
    assert.equal(appendTaskFeedback('基础反馈', ''), '基础反馈');
    assert.equal(appendTaskFeedback('基础反馈', null), '基础反馈');
  });

  it('replaces empty placeholder with task suggestion', () => {
    assert.match(
      appendTaskFeedback('（无具体修正依据）', '开篇冲突再狠一点'),
      /【修订任务建议】[\s\S]*开篇冲突再狠一点/,
    );
  });

  it('appends task suggestion after existing feedback', () => {
    const merged = appendTaskFeedback('【低分维度】\n  文笔', '压缩过渡段');
    assert.match(merged, /【低分维度】/);
    assert.match(merged, /【修订任务建议】[\s\S]*压缩过渡段/);
  });
});
