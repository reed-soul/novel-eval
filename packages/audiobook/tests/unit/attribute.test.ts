/**
 * LLM 归因：mock 引擎（不触网）。盖住：应用说话人+音色重映射、
 * cast 名单过滤、unknown 不算归属、缓存命中免二次调用、缓存落盘。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attributeMissingSpeakers } from '../../src/attribute.ts';
import type { Segment } from '../../src/annotate.ts';
import type { AIAgentAdapter, CallResult } from '@novel-eval/shared';

function dialogue(id: string, text: string): Segment {
  return {
    id, kind: 'dialogue', speaker: undefined, text,
    voice: 'zh-CN-YunxiNeural', rate: '-2%', pitch: '+0Hz', gapAfterMs: 250,
  };
}
function narration(id: string, text: string): Segment {
  return { id, kind: 'narration', speaker: undefined, text, voice: 'zh-CN-YunjianNeural', rate: '-12%', pitch: '-2Hz', gapAfterMs: 350 };
}

/** 假引擎：按调用序返回预设文本 */
function fakeEngine(responses: string[], calls: string[]): AIAgentAdapter {
  let n = 0;
  return {
    name: 'fake',
    async run(prompt: string): Promise<CallResult> {
      calls.push(prompt.slice(0, 60));
      return { text: responses[Math.min(n++, responses.length - 1)], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costRmb: 0 }, notes: [] };
    },
    async isAvailable() { return true; },
  };
}

const cfg = {
  narrator: 'zh-CN-YunjianNeural', defaultSpeaker: 'zh-CN-YunxiNeural',
  voiceBySpeaker: [{ match: '苏野', voice: 'zh-CN-XiaoyiNeural' }],
  cast: ['苏野', '沈鹤'], narrationRate: '-12%', dialogueRate: '-2%', narrationPitch: '-2Hz', dialoguePitch: '+0Hz',
};

test('LLM 归因：应用说话人+重映射音色；unknown 不算归属', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'attr-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const segs = [
    narration('c1-s1', '雪夜里，站台上的灯忽明忽暗。'),
    dialogue('c1-s2', '你到底是谁？'),
    narration('c1-s3', '她把围巾裹紧了。'),
    dialogue('c1-s4', '这句话没人知道是谁说的。'),
  ];
  const engine = fakeEngine([
    '[{"i":1,"speaker":"苏野"},{"i":2,"speaker":"unknown"}]',
  ], []);
  const res = await attributeMissingSpeakers(segs, { engine, cast: cfg.cast, voiceCfg: cfg, cacheFile: join(dir, 'cache.json') });

  assert.equal(res.attributed, 1, 'unknown 不计归属');
  assert.equal(segs[1].speaker, '苏野');
  assert.equal(segs[1].voice, 'zh-CN-XiaoyiNeural', '音色按 cast 重映射');
  assert.equal(segs[3].speaker, undefined);
  assert.equal(res.llmCalls, 1);
  // 缓存落盘
  const cache = JSON.parse(await readFile(join(dir, 'cache.json'), 'utf-8'));
  assert.ok(Object.keys(cache).length >= 1);
});

test('LLM 归因：cast 外的名字被过滤；缓存命中不再调用引擎', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'attr-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cacheFile = join(dir, 'cache.json');
  const segs = [narration('c2-s1', '风雪更急了。'), dialogue('c2-s2', '回答我。')];
  const calls: string[] = [];
  const engine = fakeEngine(['[{"i":1,"speaker":"路人甲"}]'], calls);

  await attributeMissingSpeakers(segs, { engine, cast: cfg.cast, voiceCfg: cfg, cacheFile });
  assert.equal(segs[1].speaker, undefined, 'cast 外名字被滤掉');

  // 第二次：同上下文走缓存（引擎调用数为 0），并确认缓存文件存在
  const engine2 = fakeEngine([], calls);
  const res2 = await attributeMissingSpeakers(segs, { engine: engine2, cast: cfg.cast, voiceCfg: cfg, cacheFile });
  assert.equal(res2.llmCalls, 0, '缓存命中不再调用');
  assert.equal(calls.length, 1, '引擎总共只被调 1 次');
});

test('LLM 归因：全部已归属时零调用直通', async () => {
  const segs = [narration('c3-s1', 'x'), dialogue('c3-s2', '好。')];
  segs[1].speaker = '苏野';
  const calls: string[] = [];
  const res = await attributeMissingSpeakers(segs, { engine: fakeEngine([], calls), cast: cfg.cast, voiceCfg: cfg });
  assert.deepEqual(res, { attributed: 0, llmCalls: 0 });
  assert.equal(calls.length, 0);
});
