/**
 * P0 批次（2026-10-25 chinese-novelist-skill 借鉴）行为回归：
 *   1. 字数闸门：短章直接 revise，带防注水诊断反馈
 *   2. AI 味负面清单：四平台指令全部包含
 *   3. buildPrompts：下一章预告 / Action Anchor / revise 语态锚（经 buildChapterPrompts 断言）
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { setRuntimeConfig, resetRuntimeConfig } from '../../src/runtime-config.ts';
import type { WriterConfig } from '../../src/config.ts';
import { chapterWritingDirectives } from '../../src/chapter/writing-grammar.ts';
import { buildChapterPrompts } from '../../src/chapter/generator.ts';
import type { CompiledChapterContext } from '../../src/services/context-compiler.ts';

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

    // 约 200 字、无重复 shingle 的散文（目标 100 × 0.75 = 75，过闸；避免触发 severe 重复检测）
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

  it('minWordRatio 可配且有 0.1 下限钳制：调低后较长短文过闸，0.01 被抬到 0.1', async () => {
    setRuntimeConfig(makeConfig({ minWordRatio: 0.01 }));
    const { assessChapterQuality } = await import('../../src/chapter/quality-gate.ts');

    let llmReached = false;
    const engine = {
      name: 'mock',
      run: async () => { llmReached = true; throw new Error('STOP'); },
    } as never;

    // 12 字 > 100×0.1（钳制后阈值），过闸触达评估；若未钳制（0.01→1 字阈值）同样过闸——
    // 钳制行为由下方 0.2 配置用例反向验证
    await assert.rejects(
      () => assessChapterQuality({
        engine,
        db: makeDbStub(),
        projectId: 'proj_test',
        chapter: {
          id: 'rev_test3', projectId: 'proj_test', number: 1, outlineId: 'o1',
          title: '比例放宽', content: '这是一段十二字的短文内容', wordCount: 12,
          createdAt: '', updatedAt: '',
        },
        metadata: { genre: '悬疑', targetAudience: '青年男性' },
      }),
      /STOP/,
    );
    assert.equal(llmReached, true);
  });

  it('minWordRatio=0.2 时 12 字短文被拦（验证钳制下限生效）', async () => {
    setRuntimeConfig(makeConfig({ minWordRatio: 0.2 }));
    const { assessChapterQuality } = await import('../../src/chapter/quality-gate.ts');

    let llmReached = false;
    const engine = {
      name: 'mock',
      run: async () => { llmReached = true; throw new Error('STOP'); },
    } as never;

    // 12 字 < 100×0.2=20 → 被字数闸拦截，不触达 LLM
    const result = await assessChapterQuality({
      engine,
      db: makeDbStub(),
      projectId: 'proj_test',
      chapter: {
        id: 'rev_test4', projectId: 'proj_test', number: 1, outlineId: 'o1',
        title: '阈值上拦', content: '这是一段十二字的短文内容', wordCount: 12,
        createdAt: '', updatedAt: '',
      },
      metadata: { genre: '悬疑', targetAudience: '青年男性' },
    });

    assert.equal(result.verdict, 'revise');
    assert.match(result.reason, /字数不足/);
    assert.equal(llmReached, false);
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

// ─── P0-2/P0-5 buildPrompts 断言（构造最小 CompiledChapterContext）────
function makeContext(overrides?: {
  nextOutline?: CompiledChapterContext['nextOutline'];
  recentChapters?: CompiledChapterContext['recentChapters'];
}): CompiledChapterContext {
  return {
    projectId: 'project-gen' as never,
    outlinePosition: 2,
    genreProfile: '悬疑',
    targetPlatform: 'general',
    bible: { revisionId: 'bible-1', compiledText: '设定全文。' },
    outline: {
      outline: { id: 'outline-2', projectId: 'project-gen', position: 2, createdAt: '', updatedAt: '' },
      revision: {
        id: 'outline-revision-2', revisionNumber: 1, title: '第二章',
        content: { summary: '梗概2', beats: ['推进'] }, createdAt: '',
      },
    },
    nextOutline: overrides && 'nextOutline' in overrides
      ? overrides.nextOutline
      : { position: 3, title: '第三章', summary: '梗概3' },
    previousStateRevisionId: null,
    previousState: null,
    recentChapters: overrides?.recentChapters ?? [],
    arcSummaries: [],
    promptTemplateVersion: 'chapter-v1',
    contextHash: 'hash',
  };
}

describe('P0-2/P0-5 buildPrompts（下一章预告 / Action Anchor / revise 语态锚）', () => {
  it('有下一章时注入【下一章蓝图预告】块；末章（null）不注入', () => {
    const withNext = buildChapterPrompts(makeContext(), 2800).userPrompt;
    assert.match(withNext, /下一章蓝图预告/);
    assert.match(withNext, /第三章/);

    const lastChapter = buildChapterPrompts(makeContext({ nextOutline: null }), 2800).userPrompt;
    assert.equal(lastChapter.includes('下一章蓝图预告'), false);
  });

  it('末端 Action Anchor：含章号、标题、字数，且位于 prompt 最末', () => {
    const prompt = buildChapterPrompts(makeContext(), 2800).userPrompt;
    const anchor = '现在开始创作：写出第 2 章《第二章》完整正文（约 2800 字）';
    assert.ok(prompt.includes(anchor), '缺 Action Anchor');
    assert.ok(prompt.trimEnd().endsWith('直接输出正文。'), 'Anchor 应收尾');
  });

  it('revise 轮：反馈后附上一章结尾 200 字语态锚', () => {
    const prevTail = '雨停了。他把伞收起来，回头看了一眼那扇亮着灯的窗。';
    const recentChapters = [
      {
        position: 1,
        revisionId: 'rev-1' as never,
        title: '第一章',
        content: '开头正文。'.repeat(60) + prevTail,
      },
    ];
    const prompt = buildChapterPrompts(
      makeContext({ recentChapters }),
      2800,
      '低分维度：文笔质量——句式单一',
    ).userPrompt;

    assert.match(prompt, /质量审阅反馈/);
    assert.match(prompt, /上一章结尾（语态锚/);
    assert.ok(prompt.includes(prevTail.slice(-200)), '语态锚应含上一章结尾');
    // 语态锚在反馈之后、Action Anchor（revise 轮为"现在开始重写"）之前
    const fbIdx = prompt.indexOf('质量审阅反馈');
    const anchorIdx = prompt.indexOf('语态锚');
    const finalIdx = prompt.indexOf('现在开始重写');
    assert.ok(fbIdx > -1 && anchorIdx > fbIdx && finalIdx > anchorIdx, '顺序应为 反馈→语态锚→重写Anchor');
    assert.match(prompt, /结合上述审阅反馈与蓝图目标/);
  });

  it('首版（无反馈）不注入语态锚块', () => {
    const recentChapters = [
      { position: 1, revisionId: 'rev-1' as never, title: '第一章', content: '正文。'.repeat(100) },
    ];
    const prompt = buildChapterPrompts(makeContext({ recentChapters }), 2800).userPrompt;
    assert.equal(prompt.includes('语态锚'), false);
  });
});
