/**
 * resume 质量闸门预算决策单测（battle4 v4-待办③）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveResumeBudget } from '../../src/services/resume-budget.ts';

describe('resolveResumeBudget', () => {
  it('① --max-revise 显式传入 → 覆盖快照，闸门开', () => {
    const d = resolveResumeBudget({ qualityGate: false, maxRevise: 0 }, 3);
    assert.equal(d.source, 'flag');
    assert.equal(d.budget.qualityGate, true);
    assert.equal(d.budget.maxRevise, 3);
  });

  it('② 快照已开 qualityGate 且无 flag → 沿用快照原值', () => {
    const d = resolveResumeBudget({ qualityGate: true, maxRevise: 1 }, undefined);
    assert.equal(d.source, 'snapshot');
    assert.equal(d.budget.qualityGate, true);
    assert.equal(d.budget.maxRevise, 1);
  });

  it('③ 快照未开且无 flag → 默认补开（maxRevise=2），battle4 裸奔漏洞闭合', () => {
    const d = resolveResumeBudget({}, undefined);
    assert.equal(d.source, 'default-on');
    assert.equal(d.budget.qualityGate, true);
    assert.equal(d.budget.maxRevise, 2);
  });

  it('③ 快照完全没 budget（空对象/数组/null）→ 也补开', () => {
    for (const empty of [null, [], 'x', 0]) {
      const d = resolveResumeBudget(empty as never, undefined);
      assert.equal(d.source, 'default-on', `输入 ${JSON.stringify(empty)}`);
      assert.equal(d.budget.qualityGate, true);
    }
  });

  it('覆盖/补开时保留快照里的其他字段', () => {
    const snap = { qualityGate: false, maxRevise: 0, otherFlag: 'keep' };
    const d = resolveResumeBudget(snap, 5);
    assert.equal(d.budget.otherFlag, 'keep');

    const d2 = resolveResumeBudget({ otherFlag: 'keep2' }, undefined);
    assert.equal(d2.budget.otherFlag, 'keep2');
  });

  it('flag 优先级最高：快照已开也会被 flag 覆盖次数', () => {
    const d = resolveResumeBudget({ qualityGate: true, maxRevise: 1 }, 4);
    assert.equal(d.source, 'flag');
    assert.equal(d.budget.maxRevise, 4);
  });

  it('defaultMaxRevise 可调', () => {
    const d = resolveResumeBudget({}, undefined, 1);
    assert.equal(d.budget.maxRevise, 1);
  });
});
