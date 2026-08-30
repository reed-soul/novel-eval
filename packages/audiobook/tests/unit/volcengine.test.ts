/**
 * volcengine 适配器：缓存跳过 / 失败收集 / 免 key 全缓存 行为回归。
 * fetch 全程 mock，不触网；缓存音频用 ffmpeg 生成的真实静音 mp3（ffprobe 可读时长）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { engine, _test } from '../../src/tts/volcengine.ts';
import type { Segment } from '../../src/annotate.ts';

function seg(id: string, text: string): Segment {
  return {
    id, kind: 'dialogue', speaker: '苏野', text,
    voice: 'zh-CN-YunxiNeural', rate: '-2%', pitch: '+0Hz', gapAfterMs: 250,
  };
}

test.before(() => { _test.retryBaseMs = 0; });

test('缓存命中不发网络请求；失败段跳过并落 tts-failures.json；全缓存免 key', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'volc-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  // 预置一段「已合成」缓存（真实 mp3，>512B，ffprobe 可读）
  execFileSync('ffmpeg', ['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1', '-b:a', '128k', join(dir, 'c1-s1.mp3')], { stdio: 'ignore' });

  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    throw new Error('mock 网络故障');
  });
  const prevKey = process.env.ARK_API_KEY;
  process.env.ARK_API_KEY = 'unit-test-fake-key'; // 假 key：让 s2 走真实网络分支（mock fetch）

  try {
    // s1 有缓存；s2 无缓存且网络必挂 → 3 次重试后收集失败，不抛
    const out = await engine.synthesize([seg('c1-s1', 'cached'), seg('c1-s2', 'broken')], dir);

    assert.equal(out.length, 1, '只有缓存段返回');
    assert.equal(out[0].segmentId, 'c1-s1');
    assert.ok(out[0].durationMs >= 900, 'ffprobe 读到真实时长');
    assert.equal(fetchCalls, 3, '失败段恰好重试 3 次；缓存段零请求（免 key）');

    const failures = JSON.parse(await readFile(join(dir, 'tts-failures.json'), 'utf-8')) as { segmentId: string; error: string }[];
    assert.equal(failures.length, 1);
    assert.equal(failures[0].segmentId, 'c1-s2');
    assert.match(failures[0].error, /mock 网络故障/);
  } finally {
    process.env.ARK_API_KEY = prevKey;
    void realFetch;
  }
});

test('无缓存且无 key：失败清单给出明确缺 key 错误', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'volc-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const prevKey = process.env.ARK_API_KEY;
  delete process.env.ARK_API_KEY;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('不应触网'); });
  try {
    const out = await engine.synthesize([seg('c2-s1', 'no key')], dir);
    assert.equal(out.length, 0);
    const failures = JSON.parse(await readFile(join(dir, 'tts-failures.json'), 'utf-8')) as { error: string }[];
    assert.match(failures[0].error, /ARK_API_KEY/);
  } finally {
    process.env.ARK_API_KEY = prevKey;
  }
});
