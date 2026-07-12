/**
 * 引擎工厂 + DeepSeek adapter 单测
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, BigModelAdapter, DeepSeekAdapter } from '../../src/index.ts';
import type { EngineConfig } from '../../src/index.ts';

describe('createEngine（多引擎工厂）', () => {
  const bigmodelCfg: EngineConfig = {
    provider: 'bigmodel',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-5.2',
    maxBudgetRmb: 10,
    perChapterMaxBudgetRmb: 0.1,
  };
  const deepseekCfg: EngineConfig = {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-pro',
    maxBudgetRmb: 10,
    perChapterMaxBudgetRmb: 0.15,
  };

  it('provider=bigmodel → BigModelAdapter', () => {
    const engine = createEngine(bigmodelCfg);
    assert.equal(engine.name, 'bigmodel');
    assert.ok(engine instanceof BigModelAdapter);
  });

  it('provider=deepseek → DeepSeekAdapter', () => {
    const engine = createEngine(deepseekCfg);
    assert.equal(engine.name, 'deepseek');
    assert.ok(engine instanceof DeepSeekAdapter);
  });

  it('DeepSeek isAvailable 取决于 DEEPSEEK_API_KEY', async () => {
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    // adapter 在构造时读取 env，故无 key 时构造 → 不可用
    const noKeyEngine = createEngine(deepseekCfg);
    assert.equal(await noKeyEngine.isAvailable(), false);

    // 设 key 后重新构造 → 可用（模拟 EngineRegistry 的 setKey→重建）
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const hasKeyEngine = createEngine(deepseekCfg);
    assert.equal(await hasKeyEngine.isAvailable(), true);

    if (saved === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = saved;
  });
});
