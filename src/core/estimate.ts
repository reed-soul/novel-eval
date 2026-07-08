/**
 * 评估耗时与费用预估（确认屏用，允许 ±50% 误差）
 */
export interface EvaluationEstimate {
  minutesMin: number;
  minutesMax: number;
  costMinRmb: number;
  costMaxRmb: number;
}

/** 基于 spike 外推：~¥0.021/章 Map + ~¥0.9 Reduce 固定 */
export function estimateEvaluation(chapterCount: number): EvaluationEstimate {
  const mapCost = chapterCount * 0.021;
  const reduceCost = 0.9;
  const total = mapCost + reduceCost;
  const batchMinutes = Math.ceil(chapterCount / 5) * 0.35;
  const totalMinutes = Math.ceil(batchMinutes + 2);
  return {
    minutesMin: Math.max(1, Math.floor(totalMinutes * 0.7)),
    minutesMax: Math.ceil(totalMinutes * 1.5),
    costMinRmb: Math.round(total * 0.7 * 100) / 100,
    costMaxRmb: Math.round(total * 1.5 * 100) / 100,
  };
}
