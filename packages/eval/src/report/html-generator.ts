/**
 * HTML 报告生成器 — 产品化版本
 *
 * 分层：report.html + report.data.json
 * 核心交互：证据 drill-down 面板、四类可视化、分组建议
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvaluationResult, Suggestion } from '../types.ts';
import { DIMENSION_KEYS, DIMENSION_LABELS } from '../types.ts';
import { escapeHtml, renderExcerptRefs } from './escape.ts';
import { buildRelationGraph } from './charts/relation-graph.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ReportOutput {
  htmlPath: string;
  dataPath: string;
}

export function generateReport(result: EvaluationResult, outputDir: string): ReportOutput {
  mkdirSync(outputDir, { recursive: true });
  const dataPath = resolve(outputDir, 'report.data.json');
  writeFileSync(dataPath, JSON.stringify(result, null, 2), 'utf-8');
  const htmlPath = resolve(outputDir, 'report.html');
  writeFileSync(htmlPath, buildHtml(result), 'utf-8');
  return { htmlPath, dataPath };
}

function groupSuggestions(suggestions: Suggestion[]): Map<string, Suggestion[]> {
  const map = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const key = s.dimension || '其他';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}

function renderSuggestionsGrouped(suggestions: Suggestion[]): string {
  if (!suggestions.length) return '<p class="empty">无</p>';
  const groups = groupSuggestions(suggestions);
  return [...groups.entries()].map(([dim, items]) => `
    <div class="sug-group">
      <h3 class="sug-group-title">${escapeHtml(dim)}</h3>
      <ul class="sug-list">
        ${items.map((s) => {
          const refBtn = s.excerptRef
            ? `<button type="button" class="evidence-btn excerpt-ref" data-chapter="${escapeHtml(s.excerptRef.chapterId)}" data-index="${s.excerptRef.excerptIndex}">查看证据</button>`
            : '';
          const chapters = s.relatedChapters?.length
            ? `<span class="sug-chapters">章节：${s.relatedChapters.map(escapeHtml).join(', ')}</span>`
            : '';
          return `<li class="suggestion">
            ${s.type ? `<span class="sug-type">${escapeHtml(s.type)}</span>` : ''}
            <p class="sug-content">${escapeHtml(s.content)}</p>
            <div class="sug-meta">${chapters} ${refBtn}</div>
          </li>`;
        }).join('')}
      </ul>
    </div>`).join('');
}

function renderMarketBoard(result: EvaluationResult): string {
  const m = result.marketBenchmark;
  if (!m) return '<p class="empty">市场对标分析未生成</p>';
  const cards = m.comparables.map((c) => `
    <div class="market-card">
      <div class="market-title">${escapeHtml(c.title)}</div>
      <div class="market-sim">相似度 ${c.similarity}%</div>
      <p><strong>相似：</strong>${escapeHtml(c.matchReason)}</p>
      <p><strong>差异：</strong>${escapeHtml(c.differentiation)}</p>
      <p class="market-note">${escapeHtml(c.referenceNote)}</p>
    </div>`).join('');
  return `
    <div class="market-disclaimer">${escapeHtml(m.disclaimer)}</div>
    <p class="market-position"><strong>定位：</strong>${escapeHtml(m.positioning)} · 受众匹配 ${m.audienceFit}%</p>
    <div class="market-grid">${cards}</div>`;
}

function renderTimeline(result: EvaluationResult): string {
  if (!result.chapters.length) return '<p class="empty">无</p>';
  return `<div class="timeline-scroll"><div class="timeline-inner">
    ${result.chapters.map((ch) => {
      const tension = ch.emotionalTension;
      const color = tension >= 70 ? '#dc2626' : tension >= 40 ? '#f59e0b' : '#94a3b8';
      const events = ch.keyEvents.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
      return `<div class="timeline-item" data-chapter="${escapeHtml(ch.id)}">
        <div class="timeline-marker" style="background:${color}" title="张力 ${tension}"></div>
        <div class="timeline-body">
          <div class="timeline-head">${escapeHtml(ch.id)} ${escapeHtml(ch.title)} <span class="tension-badge">${tension}</span></div>
          <ul class="timeline-events">${events}</ul>
        </div>
      </div>`;
    }).join('')}
  </div></div>`;
}

function buildHtml(result: EvaluationResult): string {
  const echartsJs = readFileSync(resolve(__dirname, 'echarts.min.js'), 'utf-8');
  const dataBlock = JSON.stringify(result).replace(/</g, '\\u003c');
  const graph = buildRelationGraph(result.characters);

  const metaParts = [
    escapeHtml(result.novel.title),
    escapeHtml(result.novel.author),
    `${result.novel.wordCount.toLocaleString()} 字`,
    `${result.novel.totalChapters} 章`,
  ];
  if (result.novel.genre) metaParts.push(escapeHtml(result.novel.genre));
  if (result.novel.targetAudience) metaParts.push(escapeHtml(result.novel.targetAudience));

  const dimensionCards = DIMENSION_KEYS.map((k) => {
    const dim = result.dimensions[k];
    if (!dim) return '';
    const subscores = dim.subscores
      ? Object.entries(dim.subscores).map(([sk, sv]) =>
          `<span class="subscore">${escapeHtml(sk)}: ${sv}</span>`).join('')
      : '';
    return `<div class="dim-card" id="dim-${k}">
      <div class="dim-header">
        <span class="dim-name">${DIMENSION_LABELS[k]}</span>
        <span class="dim-score">${dim.score}</span>
      </div>
      ${subscores ? `<div class="subscores">${subscores}</div>` : ''}
      <div class="dim-analysis">${renderExcerptRefs(dim.analysis)}</div>
    </div>`;
  }).join('');

  const scoreBars = DIMENSION_KEYS.map((k) => {
    const score = result.dimensions[k]?.score ?? 0;
    return `<div class="score-bar-row">
      <span class="score-bar-label">${DIMENSION_LABELS[k]}</span>
      <div class="score-bar-track"><div class="score-bar-fill" style="width:${score}%"></div></div>
      <span class="score-bar-val">${score}</span>
    </div>`;
  }).join('');

  const charactersHtml = result.characters.map((c) => `
    <div class="char-card">
      <div class="char-name">${escapeHtml(c.name)} <span class="char-role">${escapeHtml(c.role)}</span></div>
      ${c.aliases?.length ? `<div class="char-aliases">别名：${c.aliases.map(escapeHtml).join('、')}</div>` : ''}
      ${c.arc ? `<div class="char-arc">${escapeHtml(c.arc)}</div>` : ''}
    </div>`).join('');

  const graphSection = graph.hasGraph
    ? '<div id="relation-graph" class="chart-box"></div>'
    : '<p class="empty">人物关系数据不足，仅展示角色卡片</p>';

  const radarIndicators = DIMENSION_KEYS.map((k) =>
    `{ name: '${DIMENSION_LABELS[k]}', max: 100 }`).join(',');
  const radarValues = DIMENSION_KEYS.map((k) => result.dimensions[k]?.score ?? 0).join(',');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Novel Eval — ${escapeHtml(result.novel.title)}</title>
<style>
  :root { --primary: #2563eb; --bg: #f8fafc; --card: #fff; --text: #1e293b; --muted: #64748b; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; color: var(--text); background: var(--bg); }
  .container { max-width: 1100px; margin: 0 auto; padding: 24px 20px 80px; }
  h1 { font-size: 26px; margin: 0 0 8px; }
  h2 { font-size: 18px; border-left: 4px solid var(--primary); padding-left: 12px; margin: 0 0 16px; }
  .meta { color: var(--muted); font-size: 14px; margin-bottom: 24px; }
  section { margin-bottom: 36px; }
  .overview { display: grid; grid-template-columns: 140px 1fr 380px; gap: 24px; align-items: center; background: var(--card); padding: 24px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  @media (max-width: 800px) { .overview { grid-template-columns: 1fr; } }
  .total-score .num { font-size: 52px; font-weight: 700; color: var(--primary); line-height: 1; }
  .total-score .grade { font-size: 20px; color: var(--muted); }
  .score-bars { display: flex; flex-direction: column; gap: 8px; }
  .score-bar-row { display: grid; grid-template-columns: 72px 1fr 36px; gap: 8px; align-items: center; font-size: 13px; }
  .score-bar-track { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
  .score-bar-fill { height: 100%; background: var(--primary); border-radius: 4px; }
  #radar { height: 300px; }
  .chart-box { width: 100%; height: 320px; background: var(--card); border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  .dim-card, .char-card, .suggestion, .market-card { background: var(--card); padding: 16px 20px; border-radius: 10px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  .dim-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .dim-name { font-weight: 600; }
  .dim-score { font-size: 22px; font-weight: 700; color: var(--primary); }
  .subscore { display: inline-block; background: #eff6ff; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin: 0 6px 6px 0; }
  .dim-analysis { font-size: 14px; line-height: 1.75; }
  .excerpt-ref, .evidence-btn { color: var(--primary); cursor: pointer; text-decoration: underline; background: none; border: none; font: inherit; padding: 0; }
  .excerpt-ref:hover, .evidence-btn:hover { background: #dbeafe; }
  .sug-group { margin-bottom: 20px; }
  .sug-group-title { font-size: 15px; margin: 0 0 8px; color: var(--primary); }
  .sug-list { list-style: none; padding: 0; margin: 0; }
  .sug-type { display: inline-block; background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 8px; }
  .sug-content { margin: 6px 0; line-height: 1.65; }
  .sug-meta { font-size: 12px; color: var(--muted); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .market-disclaimer { background: #fffbeb; border: 1px solid #fde68a; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; color: #92400e; }
  .market-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .market-title { font-weight: 600; font-size: 16px; }
  .market-sim { color: var(--primary); font-size: 13px; margin: 4px 0 8px; }
  .market-note { font-size: 12px; color: var(--muted); }
  .timeline-scroll { overflow-x: auto; padding-bottom: 8px; }
  .timeline-inner { display: flex; gap: 16px; min-width: min-content; }
  .timeline-item { flex: 0 0 220px; background: var(--card); border-radius: 10px; padding: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.06); cursor: pointer; }
  .timeline-item:hover { box-shadow: 0 4px 12px rgba(0,0,0,.08); }
  .timeline-marker { width: 100%; height: 4px; border-radius: 2px; margin-bottom: 8px; }
  .timeline-head { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
  .tension-badge { background: #f1f5f9; padding: 1px 6px; border-radius: 4px; font-size: 11px; }
  .timeline-events { margin: 0; padding-left: 18px; font-size: 12px; color: var(--muted); }
  .empty { color: var(--muted); font-size: 14px; }
  .task-info { background: var(--card); padding: 16px; border-radius: 10px; font-size: 13px; color: var(--muted); }
  .char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  #evidence-panel { position: fixed; top: 0; right: -480px; width: min(480px, 100vw); height: 100vh; background: var(--card); box-shadow: -4px 0 24px rgba(0,0,0,.12); transition: right .25s ease; z-index: 1000; display: flex; flex-direction: column; }
  #evidence-panel.open { right: 0; }
  .panel-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
  .panel-header h3 { margin: 0; font-size: 16px; }
  .panel-close { background: none; border: none; font-size: 24px; cursor: pointer; color: var(--muted); line-height: 1; }
  .panel-meta { padding: 12px 20px; background: #f8fafc; font-size: 13px; color: var(--muted); }
  .panel-content { flex: 1; overflow-y: auto; padding: 16px 20px; font-size: 14px; line-height: 1.8; white-space: pre-wrap; word-break: break-word; }
  .panel-content mark { background: #fef08a; padding: 0 2px; }
  #panel-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.3); z-index: 999; }
  #panel-overlay.open { display: block; }
</style>
</head>
<body>
<div class="container">
  <h1>Novel Eval 评估报告</h1>
  <div class="meta">${metaParts.join(' · ')}</div>

  <section>
    <div class="overview">
      <div class="total-score">
        <div class="num">${result.overall.totalScore}</div>
        <div class="grade">等级 ${escapeHtml(result.overall.grade)}</div>
      </div>
      <div class="score-bars">${scoreBars}</div>
      <div id="radar"></div>
    </div>
  </section>

  <section>
    <h2>情绪 / 节奏曲线</h2>
    <div id="curve" class="chart-box"></div>
  </section>

  <section>
    <h2>八维详细分析</h2>
    ${dimensionCards}
  </section>

  <section>
    <h2>改进建议</h2>
    ${renderSuggestionsGrouped(result.suggestions)}
  </section>

  <section>
    <h2>章节事件时间线</h2>
    ${renderTimeline(result)}
  </section>

  <section>
    <h2>人物谱系</h2>
    ${graphSection}
    <div class="char-grid" style="margin-top:16px">${charactersHtml || '<p class="empty">无</p>'}</div>
  </section>

  <section>
    <h2>市场对标</h2>
    ${renderMarketBoard(result)}
  </section>

  <section>
    <h2>评估信息</h2>
    <div class="task-info">
      引擎：${escapeHtml(result.task.engine)} · 输入 ${result.task.cost.inputTokens} tok · 输出 ${result.task.cost.outputTokens} tok · 费用 ¥${result.task.cost.totalRmb.toFixed(4)}<br>
      时间：${escapeHtml(result.task.createdAt)} → ${escapeHtml(result.task.completedAt)}
    </div>
  </section>
</div>

<div id="panel-overlay"></div>
<aside id="evidence-panel">
  <div class="panel-header">
    <h3 id="panel-title">原文证据</h3>
    <button type="button" class="panel-close" id="panel-close" aria-label="关闭">×</button>
  </div>
  <div class="panel-meta" id="panel-meta"></div>
  <div class="panel-content" id="panel-content"></div>
</aside>

<script type="application/json" id="report-data">${dataBlock}</script>
<script>${echartsJs}</script>
<script>
(function() {
  var data = JSON.parse(document.getElementById('report-data').textContent);
  var graphData = ${JSON.stringify(graph)};

  // 雷达图
  var radar = echarts.init(document.getElementById('radar'));
  radar.setOption({
    tooltip: { trigger: 'item' },
    radar: { indicator: [${radarIndicators}], radius: '65%' },
    series: [{ type: 'radar', data: [{ value: [${radarValues}], name: '八维', areaStyle: { opacity: 0.25 } }] }],
  });

  // 情绪曲线
  var curve = echarts.init(document.getElementById('curve'));
  var curveIds = data.emotionalCurve.map(function(p){ return p.chapterId; });
  var curveVals = data.emotionalCurve.map(function(p){ return p.tension; });
  var markPoints = data.emotionalCurve.filter(function(p){ return p.annotation; }).map(function(p){
    return { name: p.annotation, coord: [p.chapterId, p.tension], value: p.annotation };
  });
  curve.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 24, top: 30, bottom: 50 },
    xAxis: { type: 'category', data: curveIds, axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: 100, name: '张力' },
    series: [{
      type: 'line', data: curveVals, smooth: true, areaStyle: { opacity: 0.2 },
      markPoint: { data: markPoints, symbolSize: 48, label: { fontSize: 10 } },
    }],
  });
  curve.on('click', function(params) {
    if (params.componentType === 'series') openChapter(params.name);
  });

  // 人物关系图
  if (graphData.hasGraph) {
    var rg = echarts.init(document.getElementById('relation-graph'));
    rg.setOption({
      tooltip: {},
      series: [{
        type: 'graph', layout: 'force', roam: true,
        data: graphData.nodes,
        links: graphData.links,
        categories: [{ name: '角色' }],
        label: { show: true, position: 'right' },
        force: { repulsion: 120, edgeLength: [80, 160] },
        lineStyle: { curveness: 0.15 },
      }],
    });
  }

  // 证据面板
  var panel = document.getElementById('evidence-panel');
  var overlay = document.getElementById('panel-overlay');
  function closePanel() { panel.classList.remove('open'); overlay.classList.remove('open'); }
  document.getElementById('panel-close').onclick = closePanel;
  overlay.onclick = closePanel;

  function escapeText(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function sliceHighlight(content, excerpt) {
    var text = excerpt.text;
    var offset = excerpt.offset;
    var length = excerpt.length;
    var matchLen = length != null ? length : text.length;
    var radius = 200;
    if (offset != null && (excerpt.matchedBy === 'exact' || excerpt.matchedBy === 'fuzzy')) {
      var s = Math.max(0, offset - radius), e = Math.min(content.length, offset + matchLen + radius);
      return escapeText(content.slice(s, offset)) + '<mark>' + escapeText(content.slice(offset, offset + matchLen)) + '</mark>' + escapeText(content.slice(offset + matchLen, e));
    }
    var idx = content.indexOf(text);
    if (idx >= 0) {
      var s2 = Math.max(0, idx - radius), e2 = Math.min(content.length, idx + text.length + radius);
      return escapeText(content.slice(s2, idx)) + '<mark>' + escapeText(text) + '</mark>' + escapeText(content.slice(idx + text.length, e2));
    }
    return '<mark>' + escapeText(text) + '</mark><p style="color:#64748b">（未能定位原文上下文，仅展示摘录）</p>';
  }

  function showEvidence(chapterId, index) {
    var chapter = data.chapters.find(function(c){ return c.id === chapterId; });
    if (!chapter || !chapter.excerpts || !chapter.excerpts[index]) return;
    var ex = chapter.excerpts[index];
    document.getElementById('panel-title').textContent = chapterId + ' · 证据 #' + index;
    document.getElementById('panel-meta').innerHTML =
      '维度：<strong>' + escapeText(ex.dimension) + '</strong> · ' + escapeText(ex.reason);
    document.getElementById('panel-content').innerHTML =
      '<p style="font-weight:600;margin-top:0">' + escapeText(chapter.title) + '</p>' +
      sliceHighlight(chapter.content || '', ex);
    panel.classList.add('open');
    overlay.classList.add('open');
  }

  function openChapter(chapterId) {
    var chapter = data.chapters.find(function(c){ return c.id === chapterId; });
    if (!chapter) return;
    document.getElementById('panel-title').textContent = chapterId;
    document.getElementById('panel-meta').textContent = chapter.title + ' · 张力 ' + chapter.emotionalTension;
    document.getElementById('panel-content').innerHTML = escapeText(chapter.content || chapter.summary || '');
    panel.classList.add('open');
    overlay.classList.add('open');
  }

  document.querySelectorAll('.excerpt-ref, .evidence-btn').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.preventDefault();
      showEvidence(el.getAttribute('data-chapter'), parseInt(el.getAttribute('data-index'), 10));
    });
  });

  document.querySelectorAll('.timeline-item').forEach(function(el) {
    el.addEventListener('click', function() { openChapter(el.getAttribute('data-chapter')); });
  });

  window.addEventListener('resize', function() {
    radar.resize(); curve.resize();
    if (graphData.hasGraph) { var rg = echarts.getInstanceByDom(document.getElementById('relation-graph')); if (rg) rg.resize(); }
  });
})();
</script>
</body>
</html>`;
}
