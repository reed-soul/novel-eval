/**
 * writer 包占位测试 — 验证 monorepo 接线（shared 引擎配置链路）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { name, version, status, healthCheck } from '../../src/index.ts';

describe('writer 包占位', () => {
  it('导出 name/version/status', () => {
    assert.equal(name, 'writer');
    assert.equal(version, '0.0.0');
    assert.equal(status, 'planned');
  });

  it('healthCheck 能解析 shared 引擎配置（bigmodel + glm-5.2）', () => {
    const r = healthCheck();
    assert.equal(r.ok, true);
    assert.equal(r.engineName, 'bigmodel');
    assert.equal(r.model, 'glm-5.2');
  });
});
