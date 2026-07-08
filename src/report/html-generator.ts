/**
 * HTML 报告生成器（对齐设计文档 v2.2 第七章）
 *
 * 分层：report.html（骨架+echarts+渲染逻辑）+ report.data.json（同目录）
 * 数据用 <script type="application/json"> 内嵌，前端读取后渲染。
 * 安全：所有动态内容 escape；JSON 不拼接字符串。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type { EvaluationResult } from '../types.ts';
import { DIMENSION_KEYS, DIMENSION_LABELS } from '../types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ReportOutput {
  htmlPath: string;
  dataPath: string;
}

export function generateReport(result: EvaluationResult, outputDir: string): ReportOutput {
  mkdirSync(outputDir, { recursive: true });

  const dataJson = JSON.stringify(result, null, 2);
  const dataPath = resolve(outputDir, 'report.data.json');
  writeFileSync(dataPath, dataJson, 'utf-8');

  const html = buildHtml(result);
  const htmlPath = resolve(outputDir, 'report.html');
  writeFileSync(htmlPath, html, 'utf-8');

  return { htmlPath, dataPath };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 把 analysis 里的 [chapterId#excerptIndex] 指针渲染为可点击标记 */
function renderAnalysis(analysis: string): string {
  const escaped = escapeHtml(analysis);
  return escaped.replace(/\[(ch\d+)#(\d+)\]/g, (_, chId, idx) =>
    `<a class="excerpt-ref" data-chapter="${chId}" data-index="${idx}">[${chId}#${idx}]</a>`,
  );
}

function buildHtml(result: EvaluationResult): string {
  const echartsJs = readFileSync(resolve(__dirname, 'echarts.min.js'), 'utf-8');
  // 数据内嵌为 application/json（安全，不执行）
  const dataBlock = JSON.stringify(result);

  const radarIndicators = DIMENSION_KEYS.map((k) =>
    `{ name: '${DIMENSION_LABELS[k]}', max: 100 }`,
  ).join(',');

  const radarValues = DIMENSION_KEYS.map((k) => result.dimensions[k]?.score ?? 0).join(',');

  const curveData = result.emotionalCurve.map((p) =>
    `[${JSON.stringify(p.chapterId)}, ${p.tension}]`,
  ).join(',');

  const dimensionCards = DIMENSION_KEYS.map((k) => {
    const dim = result.dimensions[k];
    if (!dim) return '';
    const subscores = dim.subscores
      ? Object.entries(dim.subscores).map(([sk, sv]) => `<span class="subscore">${escapeHtml(sk)}: ${sv}</span>`).join('')
      : '';
    return `
      <div class="dim-card">
        <div class="dim-header">
          <span class="dim-name">${DIMENSION_LABELS[k]}</span>
          <span class="dim-score">${dim.score}</span>
        </div>
        ${subscores ? `<div class="subscores">${subscores}</div>` : ''}
        <div class="dim-analysis">${renderAnalysis(dim.analysis)}</div>
      </div>`;
  }).join('\n');

  const suggestionsHtml = result.suggestions.map((s) => `
    <li class="suggestion">
      <span class="sug-dim">${escapeHtml(s.dimension)}</span>
      ${s.type ? `<span class="sug-type">${escapeHtml(s.type)}</span>` : ''}
      <p class="sug-content">${escapeHtml(s.content)}</p>
      ${s.relatedChapters?.length ? `<div class="sug-chapters">相关章节：${s.relatedChapters.map(escapeHtml).join(', ')}</div>` : ''}
    </li>`).join('\n');

  const charactersHtml = result.characters.map((c) => `
    <div class="char-card">
      <div class="char-name">${escapeHtml(c.name)} <span class="char-role">${escapeHtml(c.role)}</span></div>
      ${c.aliases?.length ? `<div class="char-aliases">别名：${c.aliases.map(escapeHtml).join('、')}</div>` : ''}
      ${c.arc ? `<div class="char-arc">${escapeHtml(c.arc)}</div>` : ''}
    </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Novel Eval 报告 - ${escapeHtml(result.novel.title)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 1100px; margin: 0 auto; padding: 24px; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 24px; border-bottom: 2px solid #333; padding-bottom: 8px; }
  .meta { color: #666; font-size: 14px; margin: 8px 0 24px; }
  .overview { display: flex; gap: 32px; align-items: center; background: #fff; padding: 24px; border-radius: 8px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .total-score { text-align: center; }
  .total-score .num { font-size: 56px; font-weight: 700; color: #2563eb; }
  .total-score .grade { font-size: 24px; color: #666; }
  #radar { width: 380px; height: 320px; }
  #curve { width: 100%; height: 280px; background: #fff; border-radius: 8px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .dim-card { background: #fff; padding: 16px 20px; border-radius: 8px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .dim-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .dim-name { font-weight: 600; font-size: 16px; }
  .dim-score { font-size: 24px; font-weight: 700; color: #2563eb; }
  .subscores { margin-bottom: 8px; }
  .subscore { display: inline-block; background: #f0f4ff; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 6px; }
  .dim-analysis { font-size: 14px; line-height: 1.7; color: #333; }
  .excerpt-ref { color: #2563eb; cursor: pointer; text-decoration: underline; }
  .excerpt-ref:hover { background: #e0e7ff; }
  .suggestion { list-style: none; background: #fff; padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .sug-dim { display: inline-block; background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 8px; }
  .sug-type { color: #666; font-size: 12px; }
  .sug-content { margin: 6px 0; line-height: 1.6; }
  .sug-chapters { font-size: 12px; color: #888; }
  .char-card { background: #fff; padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .char-name { font-weight: 600; }
  .char-role { color: #666; font-weight: normal; font-size: 13px; }
  .char-aliases, .char-arc { font-size: 13px; color: #555; margin-top: 4px; }
  section { margin-bottom: 32px; }
  h2 { font-size: 18px; border-left: 4px solid #2563eb; padding-left: 10px; }
  .task-info { background: #fff; padding: 16px; border-radius: 8px; font-size: 13px; color: #666; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
</style>
</head>
<body>
<h1>Novel Eval 评估报告</h1>
<div class="meta">${escapeHtml(result.novel.title)} · ${escapeHtml(result.novel.author)} · ${result.novel.wordCount} 字 · ${result.novel.totalChapters} 章</div>

<div class="overview">
  <div class="total-score">
    <div class="num">${result.overall.totalScore}</div>
    <div class="grade">等级 ${escapeHtml(result.overall.grade)}</div>
  </div>
  <div id="radar"></div>
</div>

<section>
  <h2>情绪/节奏曲线</h2>
  <div id="curve"></div>
</section>

<section>
  <h2>五维详细分析</h2>
  ${dimensionCards}
</section>

<section>
  <h2>人物谱系</h2>
  ${charactersHtml || '<p>无</p>'}
</section>

<section>
  <h2>改进建议</h2>
  <ul style="padding:0;">${suggestionsHtml || '<li>无</li>'}</ul>
</section>

<section>
  <h2>评估信息</h2>
  <div class="task-info">
    引擎：${escapeHtml(result.task.engine)} · 输入 token：${result.task.cost.inputTokens} · 输出 token：${result.task.cost.outputTokens} · 费用：¥${result.task.cost.totalRmb.toFixed(4)}<br>
    评估时间：${escapeHtml(result.task.createdAt)} → ${escapeHtml(result.task.completedAt)}
  </div>
</section>

<script type="application/json" id="report-data">${dataBlock.replace(/</g, '\\u003c')}</script>
<script>${echartsJs}</script>
<script>
  var data = JSON.parse(document.getElementById('report-data').textContent);

  // 雷达图
  var radar = echarts.init(document.getElementById('radar'));
  radar.setOption({
    tooltip: {},
    radar: {
      indicator: [${radarIndicators}],
      radius: 120,
    },
    series: [{
      type: 'radar',
      data: [{ value: [${radarValues}], name: '五维评分' }],
      areaStyle: { opacity: 0.3 },
      lineStyle: { width: 2 },
    }],
  });

  // 情绪曲线
  var curve = echarts.init(document.getElementById('curve'));
  curve.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 30, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: [${curveData.replace(/\[\\"/g, '').replace(/\\", \d+\]/g, '')}].length ? data.emotionalCurve.map(function(p){return p.chapterId;}) : [] },
    yAxis: { type: 'value', min: 0, max: 100, name: '张力' },
    series: [{
      type: 'line',
      data: data.emotionalCurve.map(function(p){return p.tension;}),
      areaStyle: { opacity: 0.3 },
      smooth: true,
    }],
  });

  // 指针引用点击：滚动到对应章节
  document.querySelectorAll('.excerpt-ref').forEach(function(el) {
    el.addEventListener('click', function() {
      var ch = el.getAttribute('data-chapter');
      var idx = parseInt(el.getAttribute('data-index'));
      var chapter = data.chapters.find(function(c){return c.id === ch;});
      if (chapter && chapter.excerpts && chapter.excerpts[idx]) {
        alert('章节 ' + ch + ' 证据 #' + idx + '\\n\\n' + chapter.excerpts[idx].text + '\\n\\n维度：' + chapter.excerpts[idx].dimension + '\\n理由：' + chapter.excerpts[idx].reason);
      }
    });
  });
</script>
</body>
</html>`;
}
