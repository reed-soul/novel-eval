/**
 * Unit tests for platform rubric loading + submission gate computation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlatform, computePlatformGate, PLATFORM_NAMES } from '../../src/config.ts';
import { DIMENSION_KEYS, type DimensionKey, type DimensionScore } from '../../src/types.ts';

function dims(scores: Partial<Record<DimensionKey, number>>): Record<DimensionKey, DimensionScore> {
  return Object.fromEntries(
    DIMENSION_KEYS.map((k) => [k, { score: scores[k] ?? 85, analysis: 'test' }]),
  ) as Record<DimensionKey, DimensionScore>;
}

describe('loadPlatform', () => {
  it('全部平台可加载，general 无 rubric 无红线', () => {
    const general = loadPlatform('general');
    assert.equal(general.rubric, '');
    assert.equal(general.redLines.length, 0);
  });

  it('盐选/番茄 rubric 非空且红线指向八维', () => {
    for (const name of ['yanxuan', 'fanqie'] as const) {
      const p = loadPlatform(name);
      assert.ok(p.rubric.length > 50, `${name} rubric should be substantial`);
      assert.ok(p.redLines.length >= 1);
      for (const line of p.redLines) {
        assert.ok(DIMENSION_KEYS.includes(line.dimension), `${name} redLine ${line.dimension} must be a dimension`);
        assert.ok(line.min > 0 && line.min <= 100);
      }
    }
  });

  it('豆瓣无红线（文学向不卡商业分）', () => {
    assert.equal(loadPlatform('douban').redLines.length, 0);
  });

  it('未知平台抛错并列出可用项', () => {
    assert.throws(() => loadPlatform('zhihu'), /可用：/);
  });

  it('缺省为 general', () => {
    assert.equal(loadPlatform().name, 'general');
    assert.equal(loadPlatform('').name, 'general');
  });
});

describe('computePlatformGate', () => {
  it('番茄红线：marketPotential 低于 80 → block（森铁教训场景）', () => {
    const fanqie = loadPlatform('fanqie');
    const gate = computePlatformGate(fanqie, dims({ marketPotential: 72, pacingRetention: 86 }));
    assert.equal(gate.verdict, 'block');
    assert.ok(gate.reasons.some((r) => r.includes('marketPotential')));
    assert.equal(gate.lowestDimension?.dimension, 'marketPotential');
    assert.equal(gate.lowestDimension?.score, 72);
  });

  it('红线边缘分（恰好等于 min）→ pass', () => {
    const gate = computePlatformGate(loadPlatform('fanqie'), dims({ marketPotential: 80, pacingRetention: 81 }));
    assert.equal(gate.verdict, 'pass');
  });

  it('番茄双红线全过 → pass', () => {
    const gate = computePlatformGate(loadPlatform('fanqie'), dims({ marketPotential: 90, pacingRetention: 85 }));
    assert.equal(gate.verdict, 'pass');
    assert.equal(gate.checks.length, 2);
    assert.equal(gate.reasons.length, 0);
  });

  it('豆瓣无红线 → 永远 pass，但仍报最低维', () => {
    const gate = computePlatformGate(loadPlatform('douban'), dims({ marketPotential: 60 }));
    assert.equal(gate.verdict, 'pass');
    assert.equal(gate.lowestDimension?.dimension, 'marketPotential');
  });

  it('PLATFORM_NAMES 与 yml 一致', () => {
    for (const name of PLATFORM_NAMES) {
      assert.doesNotThrow(() => loadPlatform(name));
    }
  });
});
