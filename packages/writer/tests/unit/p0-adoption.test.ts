/**
 * P0 批次（2026-10-25 chinese-novelist-skill 借鉴）行为回归：
 *   1. 字数闸门：短章直接 revise，带防注水诊断反馈
 *   2. AI 味负面清单：四平台指令全部包含
 *   3. buildPrompts：下一章预告 / 专业细节 / Action Anchor / revise 语态锚
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { setRuntimeConfig, resetRuntimeConfig } from '../../src/runtime-config.ts';
import type { WriterConfig } from '../../src/config.ts';
import { chapterWritingDirectives } from '../../src/chapter/writing-grammar.ts';

// ─── 测试配置：低字数阈值便于构造短章 ────────────────────────────
function makeConfig(overrides?: Partial<WriterConfig['qualityGate']>): WriterConfig {
  return {
    engine: {} as WriterConfig['engine'],
    engineName: 'test',
    engines: {},
    generation: {
      defaultChapters: 12,
      chapterWordCount: 100,   // 目标 100 字，便于构造
      recentWindow: 5,
      arcInterval: 10,
      temperatures: { chapter: 0.7, blueprint: 0.5, finalize: 0.4, bible: 0.5 },
      timeouts: { chapterMs: 1000, blueprintMs: 1000, finalizeMs: 1000, bibleMs: 1000 },
    },
    qualityGate: {
      passGrade: 'B', passMinScore: 75, minDimScore: 65, blockGrade: 'D',
      minWordRatio: 0.75,
      ...overrides,
    },
    repetition: {
      shingleSize: 8, withinMild: 0.15, withinSevere: 0.30,
      crossMild: 0.25, crossSevere: 0.50,
    },
    revision: {
      expansionGuide: '对症扩充四路：场景太薄→补感官肌理。',
    },
  };
}

/** 最小 DB stub：repository 查询返回空结果即可（评估历史写入用 exec 忽略） */
function makeDbStub() {
  const stmt = { get: () => undefined, all: () => [], run: () => ({ changes: 0 }) };
  return { prepare: () => stmt, exec: () => undefined } as never;
}

describe('P0-1 字数闸门（assessChapterQuality 0.5 步）', () => {
  beforeEach(() => resetRuntimeConfig());

  it('短章（< 目标×minWordRatio）直接 revise，不触发 LLM 评估', async () => {
    setRuntimeConfig(makeConfig());
    const { assessChapterQuality } = await import('../../src/chapter/quality-gate.ts');

    let llmCalled = false;
    const engine = {
      name: 'mock',
      complete: async () => { llmCalled = true; throw new Error('不应触达 LLM'); },
    } as never;

    const result = await assessChapterQuality({
      engine,
      db: makeDbStub(),
      projectId: 'proj_test',
      chapter: {
        id: 'rev_test', projectId: 'proj_test', number: 1, outlineId: 'o1',
        title: '短章', content: '太短了', wordCount: 3,
        createdAt: '', updatedAt: '',
      },
      metadata: { genre: '悬疑', targetAudience: '青年男性' },
    });

    assert.equal(result.verdict, 'revise');
    assert.equal(llmCalled, false);
    assert.match(result.reason, /字数不足/);
    assert.match(result.feedback ?? '', /防注水/);
    assert.match(result.feedback ?? '', /对症扩充/);
  });

  it('字数达标（≥ 目标×比例）不因字数被拦', async () => {
    setRuntimeConfig(makeConfig());
    const { assessChapterQuality } = await import('../../src/chapter/quality-gate.ts');

    // 80+ 字、无重复 shingle 的散文（避免触发 severe 重复检测）
    const longContent = Array.from({ length: 90 }, (_, i) =>
      '夜色渐深风起云涌山雨欲来灯火明灭人心浮动潮声隐隐'.charAt(i % 20) + `${i}`).join('');
    let llmReached = false;
    const engine = {
      name: 'mock',
      // 评估链路走 engine.run——过闸后必触达；抛 STOP 中断后续流程
      run: async () => { llmReached = true; throw new Error('STOP'); },
    } as never;

    await assert.rejects(
      () => assessChapterQuality({
        engine,
        db: makeDbStub(),
        projectId: 'proj_test',
        chapter: {
          id: 'rev_test2', projectId: 'proj_test', number: 1, outlineId: 'o1',
          title: '达标章', content: longContent, wordCount: 80,
          createdAt: '', updatedAt: '',
        },
        metadata: { genre: '悬疑', targetAudience: '青年男性' },
      }),
      /STOP/,
    );

    assert.equal(llmReached, true); // 过了字数闸，进入评估（随后因 mock 抛错）
  });

  it('minWordRatio 可配：调低后同一短章过闸', async () => {
    setRuntimeConfig(makeConfig({ minWordRatio: 0.01 }));
    const { assessChapterQuality } = await import('../../src/chapter/quality-gate.ts');

    let llmReached = false;
    const engine = {
      name: 'mock',
      run: async () => { llmReached = true; throw new Error('STOP'); },
    } as never;

    await assert.rejects(
      () => assessChapterQuality({
        engine,
        db: makeDbStub(),
        projectId: 'proj_test',
        chapter: {
          id: 'rev_test3', projectId: 'proj_test', number: 1, outlineId: 'o1',
          title: '比例放宽', content: '太短了', wordCount: 3,
          createdAt: '', updatedAt: '',
        },
        metadata: { genre: '悬疑', targetAudience: '青年男性' },
      }),
      /STOP/,
    );

    // 比例 0.01 → 100×0.01=1 字，3 字过闸（触达评估而非被字数闸拦下）
    assert.equal(llmReached, true);
  });
});

describe('P0-3 AI 味负面清单（chapterWritingDirectives）', () => {
  it('四平台指令全部包含去 AI 味块', () => {
    for (const platform of ['general', 'fanqie', 'yanxuan', 'douban'] as const) {
      const text = chapterWritingDirectives(platform, 2).join('\n');
      assert.match(text, /去AI味/, `${platform} 缺去AI味指令`);
      assert.match(text, /堆砌形容词/, `${platform} 缺堆砌形容词规则`);
      assert.match(text, /具象化|细节具象/, `${platform} 缺细节具象化规则`);
    }
  });

  it('豆瓣仍保留自身底座（不被负面清单顶掉）', () => {
    const text = chapterWritingDirectives('douban', 2).join('\n');
    assert.match(text, /替换网文留存语法/);
  });
});
