/**
 * writer 配置加载单测
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadWriterConfig } from '../../src/config.ts';

describe('loadWriterConfig', () => {
  it('加载 writer.yml + shared engines.yml', () => {
    const config = loadWriterConfig();
    assert.ok(config.engine);
    assert.equal(config.engineName, 'bigmodel');
    assert.equal(config.engine.model, 'glm-5.2');
    assert.ok(config.generation);
  });

  it('engines 表含 bigmodel 和 deepseek', () => {
    const config = loadWriterConfig();
    assert.ok(config.engines);
    assert.ok(config.engines.bigmodel, '应含 bigmodel');
    assert.ok(config.engines.deepseek, '应含 deepseek');
    assert.equal(config.engines.deepseek.provider, 'deepseek');
    assert.equal(config.engines.deepseek.model, 'deepseek-v4-pro');
  });

  it('generation 配置含默认章节数与温度', () => {
    const config = loadWriterConfig();
    assert.equal(config.generation.defaultChapters, 50);
    assert.equal(config.generation.chapterWordCount, 2500);
    assert.equal(config.generation.bibleTemperature, 0.5);
  });
});
