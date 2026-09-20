/**
 * resolveRedteamEngineSpec — AUDIT_REDTEAM_MODEL 的两种取值语义。
 * 引擎名（engines.yml 键）→ 整引擎配置（跨 provider 家族红队）；
 * 模型 id → 同 provider 换模型（原行为，保持向后兼容）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRedteamEngineSpec } from '../../src/audit/run.ts';
import type { EngineConfig } from '@novel-eval/shared';

const main: EngineConfig = {
  provider: 'bigmodel',
  baseUrl: 'https://open.bigmodel.cn/api/anthropic',
  model: 'glm-5.3',
} as EngineConfig;

const deepseek: EngineConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/anthropic',
  model: 'deepseek-v4-pro',
} as EngineConfig;

describe('resolveRedteamEngineSpec', () => {
  it('引擎名命中 engines 表 → 整引擎切换（跨家族红队）', () => {
    const got = resolveRedteamEngineSpec('deepseek', main, { bigmodel: main, deepseek });
    assert.equal(got, deepseek, '应返回 engines 表中的完整配置（provider+baseUrl+model 全换）');
  });

  it('模型 id → 同 provider 只换模型（向后兼容）', () => {
    const got = resolveRedteamEngineSpec('glm-5.3-flash', main, { bigmodel: main, deepseek });
    assert.equal(got.provider, 'bigmodel');
    assert.equal(got.model, 'glm-5.3-flash');
    assert.equal(got.baseUrl, main.baseUrl);
  });

  it('未知取值按模型 id 处理，不抛错（可用性交给 createEngine）', () => {
    const got = resolveRedteamEngineSpec('whatever-model', main, {});
    assert.equal(got.model, 'whatever-model');
    assert.equal(got.provider, 'bigmodel');
  });
});
