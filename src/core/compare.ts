/**
 * 改稿对比：纯读 JSON，不调 LLM
 */
import { readFileSync } from 'node:fs';
import type { CompareResult, DimensionKey, EvaluationResult } from '../types.ts';
import { DIMENSION_KEYS, DIMENSION_LABELS } from '../types.ts';

export function loadResultJson(path: string): EvaluationResult {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as EvaluationResult;
}

export function compareResults(baseline: EvaluationResult, current: EvaluationResult): CompareResult {
  const dimensionDeltas = Object.fromEntries(
    DIMENSION_KEYS.map((k) => {
      const b = baseline.dimensions[k]?.score ?? 0;
      const c = current.dimensions[k]?.score ?? 0;
      return [k, { baseline: b, current: c, delta: c - b }];
    }),
  ) as Record<DimensionKey, CompareResult['dimensionDeltas'][DimensionKey]>;

  const baselineSug = new Set(baseline.suggestions.map((s) => s.content.trim()));
  const currentSug = new Set(current.suggestions.map((s) => s.content.trim()));

  return {
    baseline: {
      taskId: baseline.task.id,
      title: baseline.novel.title,
      overall: baseline.overall.totalScore,
      grade: baseline.overall.grade,
      completedAt: baseline.task.completedAt,
    },
    current: {
      taskId: current.task.id,
      title: current.novel.title,
      overall: current.overall.totalScore,
      grade: current.overall.grade,
      completedAt: current.task.completedAt,
    },
    dimensionDeltas,
    overallDelta: current.overall.totalScore - baseline.overall.totalScore,
    suggestionsAdded: current.suggestions
      .map((s) => s.content.trim())
      .filter((c) => !baselineSug.has(c)),
    suggestionsRemoved: baseline.suggestions
      .map((s) => s.content.trim())
      .filter((c) => !currentSug.has(c)),
  };
}

export function formatCompareTerminal(result: CompareResult): string {
  const lines: string[] = [
    '改稿对比',
    '─'.repeat(40),
    `基线：${result.baseline.title}（${result.baseline.overall} ${result.baseline.grade}）`,
    `当前：${result.current.title}（${result.current.overall} ${result.current.grade}）`,
    `总分变化：${result.overallDelta >= 0 ? '+' : ''}${result.overallDelta}`,
    '',
    '五维变化：',
  ];
  for (const k of DIMENSION_KEYS) {
    const d = result.dimensionDeltas[k];
    const sign = d.delta >= 0 ? '+' : '';
    lines.push(`  ${DIMENSION_LABELS[k].padEnd(8)} ${d.baseline} → ${d.current} (${sign}${d.delta})`);
  }
  if (result.suggestionsAdded.length) {
    lines.push('', `新增建议（${result.suggestionsAdded.length}）：`);
    result.suggestionsAdded.slice(0, 5).forEach((s) => lines.push(`  + ${s.slice(0, 80)}${s.length > 80 ? '…' : ''}`));
  }
  if (result.suggestionsRemoved.length) {
    lines.push('', `消失建议（${result.suggestionsRemoved.length}）：`);
    result.suggestionsRemoved.slice(0, 5).forEach((s) => lines.push(`  - ${s.slice(0, 80)}${s.length > 80 ? '…' : ''}`));
  }
  return lines.join('\n');
}
