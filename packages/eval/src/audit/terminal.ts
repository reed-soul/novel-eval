/**
 * Audit 终端摘要输出
 */
import type { PlotAuditReport } from './types.ts';
import { LOGIC_HOLE_LABELS } from './types.ts';

const SEVERITY_BADGE: Record<string, string> = { P0: '✗', P1: '⚠', P2: '·' };

export function formatAuditSummary(report: PlotAuditReport): string {
  const lines: string[] = [];
  const { novel, graphStats, summary, holes, coverage } = report;

  lines.push(`《${novel.title}》剧情逻辑审计（推敲器）`);
  lines.push(
    `图：${graphStats.events} 事件 / ${graphStats.edges} 边，主因果链 ${graphStats.mainChainEvents}，`
    + `孤悬 ${graphStats.orphanEventIds.length}｜故事线：${novel.storylines.join('、')}`,
  );
  if (coverage.extractedChapters < coverage.totalChapters) {
    lines.push(
      `⚠ 覆盖不完整：${coverage.extractedChapters}/${coverage.totalChapters} 章抽取成功`
      + (coverage.failedChapterIds.length ? `（失败：${coverage.failedChapterIds.join(', ')}）` : ''),
    );
  }
  lines.push(`洞：P0 ×${summary.p0}　P1 ×${summary.p1}　P2 ×${summary.p2}`);

  const order = ['P0', 'P1', 'P2'];
  const sorted = [...holes].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );
  for (const h of sorted.slice(0, 20)) {
    const chapters = h.evidenceChapterIds.slice(0, 3).join(',') || '—';
    lines.push(
      `  [${h.severity}${SEVERITY_BADGE[h.severity]}][${LOGIC_HOLE_LABELS[h.type]}] ${chapters} ${h.title}`,
    );
  }
  if (sorted.length > 20) lines.push(`  …其余 ${sorted.length - 20} 条见 JSON 报告`);

  return lines.join('\n');
}
