/**
 * 总分聚合 + 等级查表 + 配置加载单测（对齐设计文档 v2.2 第二章/第三章）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverall, lookupGrade, loadConfig } from '../../src/config.ts';
import type { DimensionKey, GradeThresholds } from '../../src/types.ts';

const thresholds: GradeThresholds = { S: 90, A: 80, B: 70, C: 60, D: 0 };
const weights: Record<DimensionKey, number> = {
  storyStructure: 0.25,
  characterization: 0.25,
  writingQuality: 0.15,
  emotionalResonance: 0.20,
  marketPotential: 0.15,
};

describe('computeOverall', () => {
  it('维度分 × 权重 → 加权总分（四舍五入）', () => {
    const dims = {
      storyStructure: { score: 80 },
      characterization: { score: 80 },
      writingQuality: { score: 80 },
      emotionalResonance: { score: 80 },
      marketPotential: { score: 80 },
    } as Record<DimensionKey, { score: number }>;
    // 80 × (0.25+0.25+0.15+0.20+0.15) = 80 × 1.0 = 80
    assert.equal(computeOverall(dims, weights), 80);
  });

  it('各维度不同分时正确加权', () => {
    const dims = {
      storyStructure: { score: 100 },
      characterization: { score: 100 },
      writingQuality: { score: 60 },
      emotionalResonance: { score: 60 },
      marketPotential: { score: 60 },
    } as Record<DimensionKey, { score: number }>;
    // 100×0.5 + 60×0.5 = 80
    assert.equal(computeOverall(dims, weights), 80);
  });

  it('全满分 → 100', () => {
    const dims = {
      storyStructure: { score: 100 },
      characterization: { score: 100 },
      writingQuality: { score: 100 },
      emotionalResonance: { score: 100 },
      marketPotential: { score: 100 },
    } as Record<DimensionKey, { score: number }>;
    assert.equal(computeOverall(dims, weights), 100);
  });

  it('全零分 → 0', () => {
    const dims = {
      storyStructure: { score: 0 },
      characterization: { score: 0 },
      writingQuality: { score: 0 },
      emotionalResonance: { score: 0 },
      marketPotential: { score: 0 },
    } as Record<DimensionKey, { score: number }>;
    assert.equal(computeOverall(dims, weights), 0);
  });

  it('四舍五入到整数', () => {
    const dims = {
      storyStructure: { score: 73 },
      characterization: { score: 73 },
      writingQuality: { score: 73 },
      emotionalResonance: { score: 73 },
      marketPotential: { score: 73 },
    } as Record<DimensionKey, { score: number }>;
    // 73 × 1.0 = 73
    assert.equal(computeOverall(dims, weights), 73);
  });

  it('缺失维度按 0 计（容错）', () => {
    const dims = {
      storyStructure: { score: 100 },
      characterization: { score: 100 },
      writingQuality: { score: 100 },
      emotionalResonance: { score: 100 },
      marketPotential: { score: 0 },  // 缺失按 0
    } as Record<DimensionKey, { score: number }>;
    // 100×0.85 + 0×0.15 = 85
    assert.equal(computeOverall(dims, weights), 85);
  });
});

describe('lookupGrade', () => {
  it('S 级（>=90）', () => {
    assert.equal(lookupGrade(90, thresholds), 'S');
    assert.equal(lookupGrade(100, thresholds), 'S');
  });

  it('A 级（80-89）', () => {
    assert.equal(lookupGrade(80, thresholds), 'A');
    assert.equal(lookupGrade(89, thresholds), 'A');
  });

  it('B 级（70-79）', () => {
    assert.equal(lookupGrade(70, thresholds), 'B');
    assert.equal(lookupGrade(79, thresholds), 'B');
  });

  it('C 级（60-69）', () => {
    assert.equal(lookupGrade(60, thresholds), 'C');
    assert.equal(lookupGrade(69, thresholds), 'C');
  });

  it('D 级（<60）', () => {
    assert.equal(lookupGrade(59, thresholds), 'D');
    assert.equal(lookupGrade(0, thresholds), 'D');
  });

  it('边界值用 >=（90 是 S 不是 A）', () => {
    assert.equal(lookupGrade(90, thresholds), 'S');
    assert.equal(lookupGrade(80, thresholds), 'A');
    assert.equal(lookupGrade(70, thresholds), 'B');
    assert.equal(lookupGrade(60, thresholds), 'C');
  });
});

describe('loadConfig', () => {
  it('加载 default profile', () => {
    const config = loadConfig('default');
    assert.equal(config.profileName, 'default');
    assert.ok(config.profile.weights);
    assert.ok(config.gradeThresholds);
    assert.ok(config.engine);
  });

  it('加载 revision profile（改稿模式权重不同）', () => {
    const config = loadConfig('revision');
    assert.equal(config.profileName, 'revision');
    // revision 模式 marketPotential 权重应低于 default，writingQuality 权重应高于 default
    const def = loadConfig('default');
    assert.ok(config.profile.weights.marketPotential < def.profile.weights.marketPotential);
    assert.ok(config.profile.weights.writingQuality > def.profile.weights.writingQuality);
  });

  it('加载 submission profile（投稿模式 marketPotential 权重最高）', () => {
    const config = loadConfig('submission');
    assert.equal(config.profileName, 'submission');
    // submission 模式 marketPotential 是该 profile 中权重最高的维度
    const w = config.profile.weights;
    assert.ok(w.marketPotential >= Math.max(w.storyStructure, w.characterization, w.pacingRetention));
  });

  it('默认权重合计为 1.0', () => {
    const config = loadConfig('default');
    const sum = Object.values(config.profile.weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, `权重合计 ${sum} 应为 1.0`);
  });

  it('引擎配置含 baseUrl + model', () => {
    const config = loadConfig('default');
    assert.ok(config.engine.baseUrl);
    assert.ok(config.engine.model);
  });

  it('不存在的 profile 抛错', () => {
    assert.throws(() => loadConfig('nonexistent'));
  });
});
