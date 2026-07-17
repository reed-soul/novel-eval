/**
 * Unit tests for golden chapter slicing helpers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitChaptersWithMeta, countChars } from '@novel-eval/shared';
import { formatSliceText, selectChapters } from '../../src/golden/slice.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('selectChapters / formatSliceText', () => {
  it('respects maxChapters and maxChars', () => {
    const chapters = [
      { id: 'ch001', title: '第一章 A', content: '甲'.repeat(500) },
      { id: 'ch002', title: '第二章 B', content: '乙'.repeat(500) },
      { id: 'ch003', title: '第三章 C', content: '丙'.repeat(500) },
    ];
    const selected = selectChapters(chapters, { maxChapters: 2, maxChars: 10000, minChars: 100 });
    assert.equal(selected.length, 2);
    assert.equal(selected[1].id, 'ch002');

    const byChars = selectChapters(chapters, { maxChapters: 8, maxChars: 1200, minChars: 100 });
    assert.equal(byChars.length, 2);
  });

  it('formats text that can be re-split', () => {
    const chapters = [
      { id: 'ch001', title: '第一章 归乡', content: '深秋的雨下了整整三天。' },
      { id: 'ch002', title: '第二章 旧人', content: '陈默回来的第三天。' },
    ];
    const text = formatSliceText(chapters);
    const split = splitChaptersWithMeta(text);
    assert.ok(split.chapters.length >= 2);
    assert.match(split.chapters[0].title, /归乡/);
  });

  it('skips junk TOC and empty shells', () => {
    const chapters = [
      { id: 'ch001', title: 'Table of Contents', content: '目录页'.repeat(10) },
      { id: 'ch002', title: '第1章 序曲', content: '' },
      { id: 'ch003', title: '第1章 序曲', content: '正文'.repeat(500) },
      { id: 'ch004', title: '第2章 大学', content: '继续'.repeat(500) },
      { id: 'ch005', title: '第3章 异象', content: '再写'.repeat(500) },
    ];
    const selected = selectChapters(chapters, { maxChapters: 8, maxChars: 20000, minChars: 400 });
    assert.equal(selected.length, 3);
    assert.equal(selected[0].title, '第1章 序曲');
    assert.ok(countChars(selected[0].content) >= 400);
  });

  it('truncates a single oversized chapter to maxChars', () => {
    const chapters = [
      { id: 'ch001', title: '第一章 超长', content: '字'.repeat(50000) },
    ];
    const selected = selectChapters(chapters, { maxChapters: 8, maxChars: 20000 });
    assert.equal(selected.length, 1);
    assert.ok(countChars(selected[0].content) <= 20000 + 20);
    assert.match(selected[0].content, /golden 抽样截断/);
  });

  it('slices spike sample under chapter budget', () => {
    const samplePath = resolve(REPO_ROOT, 'data/spike-samples/sample-novel.txt');
    const text = readFileSync(samplePath, 'utf-8');
    const split = splitChaptersWithMeta(text);
    assert.ok(split.chapters.length >= 3);
    const selected = selectChapters(split.chapters, { maxChapters: 3, maxChars: 20000 });
    assert.equal(selected.length, 3);
    assert.ok(countChars(formatSliceText(selected)) > 0);
  });
});
