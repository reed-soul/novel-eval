/**
 * Unit tests for P1-3 三局统计化（repeats.ts 纯统计逻辑）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRepeatsConfig, isRunPass, rangeOf, medianOf, shouldExtend, summarize,
  type RunOutcome, type RepeatsConfig,
} from '../../src/repeats.ts';

function outcome(partial: Partial<RunOutcome>): RunOutcome {
  return {
    runIndex: 0, engineName: 'bigmodel', totalScore: 86, marketScore: 82,
    platformGatePass: true, taskId: 't', costRmb: 1,
    ...partial,
  };
}

function cfg(partial: Partial<RepeatsConfig> = {}): RepeatsConfig {
  return resolveRepeatsConfig(partial);
}

describe('resolveRepeatsConfig', () => {
  it('默认：repeats 3 → require 2（多数），maxRuns 5', () => {
    const c = cfg();
    assert.equal(c.repeats, 3);
    assert.equal(c.require, 2);
    assert.equal(c.maxRuns, 5);
    assert.equal(c.minOverall, 85);
    assert.equal(c.minMarket, 80);
    assert.equal(c.rangeThreshold, 6);
  });

  it('显式 --repeats 3 --require 2 生效', () => {
    const c = cfg({ repeats: 3, require: 2 });
    assert.equal(c.repeats, 3);
    assert.equal(c.require, 2);
  });

  it('只给 repeats 时 require 取多数', () => {
    assert.equal(cfg({ repeats: 5 }).require, 3);
    assert.equal(cfg({ repeats: 1 }).require, 1);
  });

  it('require 越界报错', () => {
    assert.throws(() => cfg({ repeats: 3, require: 4 }), /require/);
    assert.throws(() => cfg({ repeats: 3, require: 0 }), /require/);
  });

  it('repeats 非法报错', () => {
    assert.throws(() => cfg({ repeats: 0 }), /repeats/);
  });
});

describe('isRunPass 单局过门', () => {
  it('门不 block + 总分线 + 市场线 → 过', () => {
    assert.ok(isRunPass({ totalScore: 85, marketScore: 80, platformGatePass: true }, cfg()));
  });

  it('市场分 <80 一票否决（总分再高也不算过）', () => {
    assert.ok(!isRunPass({ totalScore: 92, marketScore: 79, platformGatePass: true }, cfg()));
  });

  it('总分 <85 不过', () => {
    assert.ok(!isRunPass({ totalScore: 84, marketScore: 88, platformGatePass: true }, cfg()));
  });

  it('投稿门 block 不过', () => {
    assert.ok(!isRunPass({ totalScore: 90, marketScore: 88, platformGatePass: false }, cfg()));
  });
});

describe('统计原语', () => {
  it('rangeOf', () => {
    assert.equal(rangeOf([86, 84, 90]), 6);
    assert.equal(rangeOf([]), 0);
    assert.equal(rangeOf([85]), 0);
  });

  it('medianOf 奇数取中、偶数取均值四舍五入', () => {
    assert.equal(medianOf([86, 84, 90]), 86);
    assert.equal(medianOf([85, 86]), 86);
    assert.equal(medianOf([84, 85]), 85);   // 84.5 → Math.round 半值进位
  });
});

describe('shouldExtend 加跑判定', () => {
  it('未达基准局数 → 必须跑', () => {
    assert.ok(shouldExtend([outcome({})], cfg({ repeats: 3 })));
    assert.ok(shouldExtend([], cfg({ repeats: 3 })));
  });

  it('基准局数已满 + 总分极差 ≤6 → 不加跑', () => {
    const outcomes = [outcome({ totalScore: 85 }), outcome({ totalScore: 86 }), outcome({ totalScore: 88 })];
    assert.ok(!shouldExtend(outcomes, cfg({ repeats: 3, maxRuns: 5 })));
  });

  it('基准局数已满 + 总分极差 >6 → 加跑', () => {
    const outcomes = [outcome({ totalScore: 84 }), outcome({ totalScore: 86 }), outcome({ totalScore: 92 })];
    assert.ok(shouldExtend(outcomes, cfg({ repeats: 3, maxRuns: 5 })));
  });

  it('市场分极差 >6 同样触发加跑（评分器方差治理的核心项）', () => {
    const outcomes = [
      outcome({ totalScore: 86, marketScore: 84 }),
      outcome({ totalScore: 86, marketScore: 85 }),
      outcome({ totalScore: 87, marketScore: 92 }),   // 总分极差 1，市场极差 8
    ];
    assert.ok(shouldExtend(outcomes, cfg({ repeats: 3, maxRuns: 5 })));
  });

  it('到上限后不再加跑', () => {
    const outcomes = [
      outcome({ totalScore: 70 }), outcome({ totalScore: 95 }), outcome({ totalScore: 84 }),
      outcome({ totalScore: 88 }), outcome({ totalScore: 90 }),
    ];
    assert.ok(!shouldExtend(outcomes, cfg({ repeats: 3, maxRuns: 5 })));
  });
});

describe('summarize 汇总判定', () => {
  it('3 局 2 过 + require 2 → 过门', () => {
    const outcomes = [
      outcome({ runIndex: 1, totalScore: 86, marketScore: 82 }),
      outcome({ runIndex: 2, totalScore: 84, marketScore: 81 }),   // 总分 84 <85 不过
      outcome({ runIndex: 3, totalScore: 87, marketScore: 83 }),
    ];
    const s = summarize(outcomes, cfg({ repeats: 3, require: 2 }));
    assert.equal(s.passCount, 2);
    assert.ok(s.verdictPass);
    assert.equal(s.medianOverall, 86);
    assert.equal(s.totalRange, 3);
    assert.ok(!s.extended);
  });

  it('2/3 过 + require 3 → 不过门', () => {
    const outcomes = [
      outcome({ totalScore: 86 }), outcome({ totalScore: 87 }),
      outcome({ totalScore: 84, marketScore: 81 }),
    ];
    const s = summarize(outcomes, cfg({ repeats: 3, require: 3 }));
    assert.equal(s.passCount, 2);
    assert.ok(!s.verdictPass);
  });

  it('加跑后 extended 标记 + 费用累计 + 引擎名去重', () => {
    const outcomes = [
      outcome({ runIndex: 1, engineName: 'bigmodel', costRmb: 1.2 }),
      outcome({ runIndex: 2, engineName: 'bigmodel', costRmb: 1.1 }),
      outcome({ runIndex: 3, engineName: 'bigmodel', costRmb: 1.3 }),
      outcome({ runIndex: 4, engineName: 'deepseek', costRmb: 1.5 }),
    ];
    const s = summarize(outcomes, cfg({ repeats: 3, require: 2 }));
    assert.ok(s.extended);
    assert.ok(Math.abs(s.totalCostRmb - 5.1) < 1e-9);
    assert.deepEqual(s.engineNames, ['bigmodel', 'deepseek']);
  });
});
