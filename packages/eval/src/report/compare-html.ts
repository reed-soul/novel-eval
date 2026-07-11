import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type { CompareResult } from '../types.ts';
import { DIMENSION_KEYS, DIMENSION_LABELS } from '../types.ts';
import { escapeHtml } from './escape.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function generateCompareReport(result: CompareResult, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const echartsJs = readFileSync(resolve(__dirname, 'echarts.min.js'), 'utf-8');
  const dataBlock = JSON.stringify(result).replace(/</g, '\\u003c');

  const radarIndicators = DIMENSION_KEYS.map((k) =>
    `{ name: '${DIMENSION_LABELS[k]}', max: 100 }`,
  ).join(',');

  const baselineValues = DIMENSION_KEYS.map((k) => result.dimensionDeltas[k].baseline).join(',');
  const currentValues = DIMENSION_KEYS.map((k) => result.dimensionDeltas[k].current).join(',');

  const deltaRows = DIMENSION_KEYS.map((k) => {
    const d = result.dimensionDeltas[k];
    const sign = d.delta >= 0 ? '+' : '';
    const cls = d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : '';
    return `<tr><td>${DIMENSION_LABELS[k]}</td><td>${d.baseline}</td><td>${d.current}</td><td class="${cls}">${sign}${d.delta}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>改稿对比 - ${escapeHtml(result.current.title)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; background: #fafafa; }
  h1 { font-size: 22px; }
  .summary { background: #fff; padding: 20px; border-radius: 8px; margin: 16px 0; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .delta { font-size: 28px; font-weight: 700; color: #2563eb; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f8fafc; }
  .up { color: #16a34a; } .down { color: #dc2626; }
  #radar { height: 360px; background: #fff; border-radius: 8px; margin: 16px 0; }
  .sug { background: #fff; padding: 12px; margin: 8px 0; border-radius: 6px; font-size: 14px; }
</style>
</head>
<body>
<h1>改稿对比报告</h1>
<div class="summary">
  <div>基线：${escapeHtml(result.baseline.title)} — ${result.baseline.overall}（${result.baseline.grade}）</div>
  <div>当前：${escapeHtml(result.current.title)} — ${result.current.overall}（${result.current.grade}）</div>
  <div class="delta">总分变化：${result.overallDelta >= 0 ? '+' : ''}${result.overallDelta}</div>
</div>
<div id="radar"></div>
<table><thead><tr><th>维度</th><th>基线</th><th>当前</th><th>变化</th></tr></thead><tbody>${deltaRows}</tbody></table>
${result.suggestionsAdded.length ? `<h2>新增建议</h2>${result.suggestionsAdded.map((s) => `<div class="sug">+ ${escapeHtml(s)}</div>`).join('')}` : ''}
${result.suggestionsRemoved.length ? `<h2>消失建议</h2>${result.suggestionsRemoved.map((s) => `<div class="sug">- ${escapeHtml(s)}</div>`).join('')}` : ''}
<script type="application/json" id="compare-data">${dataBlock}</script>
<script>${echartsJs}</script>
<script>
  var chart = echarts.init(document.getElementById('radar'));
  chart.setOption({
    legend: { data: ['基线', '当前'] },
    radar: { indicator: [${radarIndicators}], radius: 120 },
    series: [{
      type: 'radar',
      data: [
        { value: [${baselineValues}], name: '基线', areaStyle: { opacity: 0.15 } },
        { value: [${currentValues}], name: '当前', areaStyle: { opacity: 0.25 } },
      ],
    }],
  });
</script>
</body>
</html>`;

  const htmlPath = resolve(outputDir, 'compare.html');
  writeFileSync(htmlPath, html, 'utf-8');
  return htmlPath;
}
