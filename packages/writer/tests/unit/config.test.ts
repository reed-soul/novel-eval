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
    assert.equal(config.generation.defaultChapters, 60);
    assert.equal(config.generation.chapterWordCount, 2800);
    assert.equal(config.generation.temperatures.bible, 0.5);
    assert.equal(config.generation.temperatures.chapter, 0.7);
    assert.equal(config.generation.timeouts.chapterMs, 300000);
    assert.equal(config.qualityGate.passMinScore, 75);
    assert.equal(config.qualityGate.blockGrade, 'D');
    assert.equal(config.repetition.shingleSize, 8);
  });

  it('override.engine 指定 bigmodel 时覆盖默认引擎', () => {
    const config = loadWriterConfig({ engine: 'bigmodel' });
    assert.equal(config.engineName, 'bigmodel');
    assert.equal(config.engine.provider, 'bigmodel');
    assert.equal(config.engine.model, 'glm-5.2');
  });

  it('override.engine 传未知引擎时抛错并列出可用引擎', () => {
    assert.throws(
      () => loadWriterConfig({ engine: 'bigmode' }),
      /未知引擎 "bigmode"[\s\S]*可用引擎：[\s\S]*bigmodel[\s\S]*deepseek/,
    );
  });
});
