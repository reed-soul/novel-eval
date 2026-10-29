/**
 * resume 质量闸门预算决策（battle4 v4-待办③）。
 *
 * 背景：battle4 实测 A 本 resume 后 2-18 章零评估记录——原 job 快照未开
 * qualityGate 时，续写章节裸奔，且 --max-revise 传入也不生效（只打提示）。
 *
 * 三级语义（纯函数，CLI 层据此打印与传参）：
 *   ① --max-revise 显式传入 → 覆盖快照（闸门开、次数用传入值）
 *   ② 快照已开 qualityGate  → 沿用快照
 *   ③ 都没有               → 默认补开（maxRevise=defaultMaxRevise，防裸奔）
 */
import type { JsonValue } from '../repositories/validation.ts';

export type ResumeBudgetSource = 'flag' | 'snapshot' | 'default-on';

export interface ResumeBudgetDecision {
  source: ResumeBudgetSource;
  budget: Record<string, unknown>;
}

export function resolveResumeBudget(
  snapshotBudget: JsonValue,
  maxRevise: number | undefined,
  defaultMaxRevise = 2,
): ResumeBudgetDecision {
  const base = isPlainObject(snapshotBudget)
    ? (snapshotBudget as Record<string, unknown>)
    : {};
  if (maxRevise !== undefined) {
    return { source: 'flag', budget: { ...base, qualityGate: true, maxRevise } };
  }
  if (base.qualityGate === true) {
    return { source: 'snapshot', budget: base };
  }
  return {
    source: 'default-on',
    budget: { ...base, qualityGate: true, maxRevise: defaultMaxRevise },
  };
}

function isPlainObject(v: JsonValue): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
