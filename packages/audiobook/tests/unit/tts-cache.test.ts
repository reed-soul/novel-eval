/**
 * M1 内容哈希缓存键控：指纹稳定性/敏感性、索引容错、命中判定三态。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { segmentFingerprint, loadCacheIndex, saveCacheIndex, cacheHit } from '../../src/tts/cache.ts';
import type { Segment } from '../../src/annotate.ts';

const seg: Segment = {
  id: 'c1-s1', kind: 'dialogue', speaker: '老周', text: '你到底看见了什么？',
  voice: 'zh-CN-YunxiNeural', rate: '-4%', pitch: '+0Hz', gapAfterMs: 300,
};

test('segmentFingerprint：同输入稳定，输出长度定长', () => {
  assert.equal(segmentFingerprint('edge', seg), segmentFingerprint('edge', seg));
  assert.match(segmentFingerprint('edge', seg), /^[0-9a-f]{16}$/);
});

test('segmentFingerprint：改字/换音色/换语速/换引擎任一变化都失配（M1 核心语义）', () => {
  const base = segmentFingerprint('edge', seg);
  const edit = segmentFingerprint('edge', { ...seg, text: '你到底看见了什么!' });
  const voice = segmentFingerprint('edge', { ...seg, voice: 'zh-CN-XiaoxiaoNeural' });
  const rate = segmentFingerprint('edge', { ...seg, rate: '+0%' });
  const engine = segmentFingerprint('volcengine', seg);
  assert.notEqual(base, edit, '改字必须失配');
  assert.notEqual(base, voice, '换音色必须失配');
  assert.notEqual(base, rate, '改语速必须失配');
  assert.notEqual(base, engine, '换引擎必须失配');
  // gapAfterMs 只影响装配不影响音频：参与与否的判定见实现（不参与），此处固化语义
  assert.equal(base, segmentFingerprint('edge', { ...seg, gapAfterMs: 9999 }));
});

test('cacheHit：三态——文件不在 miss；旧缓存无索引信任命中；指纹匹配 hit / 失配 miss', () => {
  const fp = segmentFingerprint('edge', seg);
  assert.equal(cacheHit(false, undefined, fp), false, '文件不在必须 miss');
  assert.equal(cacheHit(true, undefined, fp), true, '旧缓存首遇（无索引条目）信任命中');
  assert.equal(cacheHit(true, fp, fp), true, '指纹匹配命中');
  assert.equal(cacheHit(true, 'deadbeefdeadbeef', fp), false, '指纹失配 miss（改字场景）');
});

test('loadCacheIndex/saveCacheIndex：往返一致；缺失与损坏容错为空对象', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tts-cache-'));
  try {
    assert.deepEqual(loadCacheIndex(dir), {}, '索引不存在 → {}');
    writeFileSync(join(dir, '.cache-index.json'), '{oops 不是 json', 'utf-8');
    assert.deepEqual(loadCacheIndex(dir), {}, '索引损坏 → {}（按无索引处理，旧缓存信任策略接管）');
    await saveCacheIndex(dir, { 'c1-s1': 'abc123' });
    assert.deepEqual(loadCacheIndex(dir), { 'c1-s1': 'abc123' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
