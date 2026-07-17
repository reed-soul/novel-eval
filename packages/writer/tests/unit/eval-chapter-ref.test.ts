import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveEvalChapterRef,
  resolveSingleChapterFromTask,
} from '../../src/lib/eval-chapter-ref.ts';

describe('resolveEvalChapterRef', () => {
  it('parses ch001 / ch3 / ch-10 / plain digits', () => {
    assert.equal(resolveEvalChapterRef('ch001'), 1);
    assert.equal(resolveEvalChapterRef('ch3'), 3);
    assert.equal(resolveEvalChapterRef('ch-10'), 10);
    assert.equal(resolveEvalChapterRef('12'), 12);
  });

  it('rejects empty or non-chapter tokens', () => {
    assert.equal(resolveEvalChapterRef(''), null);
    assert.equal(resolveEvalChapterRef('chapter-1'), null);
    assert.equal(resolveEvalChapterRef('0'), null);
  });
});

describe('resolveSingleChapterFromTask', () => {
  it('prefers excerptRef over relatedChapters', () => {
    const resolved = resolveSingleChapterFromTask({
      excerptRef: { chapterId: 'ch002' },
      relatedChapters: ['ch001', 'ch003'],
    });
    assert.deepEqual(resolved, { chapterNumber: 2 });
  });

  it('uses single relatedChapters entry', () => {
    assert.deepEqual(
      resolveSingleChapterFromTask({ relatedChapters: ['ch007'] }),
      { chapterNumber: 7 },
    );
  });

  it('rejects multi-chapter related lists', () => {
    const resolved = resolveSingleChapterFromTask({
      relatedChapters: ['ch001', 'ch002'],
    });
    assert.ok('error' in resolved);
  });
});
