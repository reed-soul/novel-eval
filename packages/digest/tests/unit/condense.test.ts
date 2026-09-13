/**
 * digest 核心：缓存键控（改章只重浓缩那一章）、提示词构建、map-reduce 流程（注入假引擎）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIAgentAdapter } from '@novel-eval/shared';
import { condenseChapters, condenseCacheKey, mapPrompt, reducePrompt } from '../../src/condense.ts';
import type { Chapter } from '../../src/db.ts';

const ch = (pos: number, content: string): Chapter => ({ position: pos, title: `第${pos}章`, content });

test('condenseCacheKey：改章/改目标/改风格任一变化即失配', () => {
  const base = condenseCacheKey('map:1', '内容A', 3000, 'faithful');
  assert.equal(base, condenseCacheKey('map:1', '内容A', 3000, 'faithful'));
  assert.notEqual(base, condenseCacheKey('map:1', '内容B', 3000, 'faithful'), '改章内容失配');
  assert.notEqual(base, condenseCacheKey('map:1', '内容A', 4000, 'faithful'), '改目标字数失配');
  assert.notEqual(base, condenseCacheKey('map:1', '内容A', 3000, 'hook'), '改风格失配');
});

test('mapPrompt：含章节号与每章配额（目标/4 下限 300）', () => {
  const p1 = mapPrompt(ch(3, 'X'), 3000, 'faithful');
  assert.ok(p1.includes('第3章'));
  assert.ok(p1.includes('750')); // 3000/4
  const p2 = mapPrompt(ch(1, 'X'), 800, 'hook');
  assert.ok(p2.includes('300')); // max(300, 200)
});

test('reducePrompt：含标题与风格要求', () => {
  const p = reducePrompt('七楼坠落', ['【第1章】\nA', '【第2章】\nB'], 3000, 'hook');
  assert.ok(p.includes('《七楼坠落》'));
  assert.ok(p.includes('引流浓缩'));
});

test('condenseChapters：缓存命中零调用；改一章只重调该章+reduce', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-'));
  const cacheFile = join(dir, '.condense-cache.json');
  let calls = 0;
  const engine: AIAgentAdapter = {
    async run(prompt: string) {
      calls += 1;
      if (prompt.includes('浓缩成')) return { text: `章摘要${calls}` };
      return { text: '《测试短篇》\n\n正文。' };
    },
  } as unknown as AIAgentAdapter;

  const chapters = [ch(1, '一'.repeat(100)), ch(2, '二'.repeat(100))];
  const r1 = await condenseChapters(chapters, { title: 'T', targetWords: 1000, style: 'faithful', cacheFile }, engine);
  assert.equal(r1.llmCalls, 3, '首跑：2 map + 1 reduce');
  assert.ok(r1.words > 0);

  // 全缓存复跑：零调用，同稿
  calls = 0;
  const r2 = await condenseChapters(chapters, { title: 'T', targetWords: 1000, style: 'faithful', cacheFile }, engine);
  assert.equal(r2.llmCalls, 0, '复跑全缓存零调用');
  assert.equal(r2.markdown, r1.markdown);

  // 改第 2 章：只有 ch2 的 map + reduce 重调（ch1 命中缓存）
  calls = 0;
  const chapters2 = [ch(1, '一'.repeat(100)), ch(2, '二二'.repeat(100))];
  const r3 = await condenseChapters(chapters2, { title: 'T', targetWords: 1000, style: 'faithful', cacheFile }, engine);
  assert.equal(r3.llmCalls, 2, '改一章：1 map + 1 reduce');
  rmSync(dir, { recursive: true, force: true });
});
