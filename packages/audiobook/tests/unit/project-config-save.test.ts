/**
 * M1 配置中心写路径：saveProjectConfig 校验拦截 + 往返一致。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig, saveProjectConfig } from '../../src/project-config.ts';

const OPTS = { dataDir: '', projectId: 'b1', title: '测试书' };

test('saveProjectConfig：往返一致（写入推荐位置 <safeName>.json）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projcfg-'));
  try {
    const cfg = {
      pron: [{ match: '110', read: '幺幺零' }],
      voiceBySpeaker: [{ match: '老周', voice: 'zh-CN-YunjianNeural', rate: '-14%', pitch: '-10Hz' }],
      cast: ['老周', '小马'],
      narrator: 'zh-CN-YunjianNeural',
    };
    const file = saveProjectConfig({ ...OPTS, dataDir: dir, config: cfg });
    assert.ok(file.endsWith('测试书.json'), `写入推荐位置：${file}`);
    assert.ok(existsSync(file));
    const { config, source } = loadProjectConfig({ ...OPTS, dataDir: dir });
    assert.equal(source, file);
    assert.deepEqual(config, cfg);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveProjectConfig：坏数据写入前拦截（不毒化后续 load）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projcfg-'));
  try {
    assert.throws(() => saveProjectConfig({ ...OPTS, dataDir: dir, config: { pron: [{ match: 'x' }] as never } }), /match.*read|read/i);
    assert.throws(() => saveProjectConfig({ ...OPTS, dataDir: dir, config: { voiceBySpeaker: [{ match: 'a', voice: 'v', rate: '快一点' }] } }), /rate/);
    assert.throws(() => saveProjectConfig({ ...OPTS, dataDir: dir, config: { cast: [''] } }), /cast/);
    // 全部被拒：目录里不应留下半成品配置
    const { source } = loadProjectConfig({ ...OPTS, dataDir: dir });
    assert.equal(source, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
