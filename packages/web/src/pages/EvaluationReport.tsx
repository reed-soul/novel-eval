import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { RadarChart } from '../components/RadarChart.tsx';
import {
  getEvaluationReport,
  importRevisionTasks,
  api,
  type EvaluationReportResponse,
  type Project,
} from '../api/client.ts';
import type {
  EvaluationDimensionKey,
  EvaluationDimensionDto,
  EvaluationEmotionalPointDto,
  EvaluationSuggestionDto,
  EvaluationExcerptDto,
  EvaluationMarketComparableDto,
} from '@novel-eval/shared';
import {
  EVALUATION_DIMENSION_KEYS,
  EVALUATION_DIMENSION_LABELS,
} from '@novel-eval/shared/dto';
import type { CharacterProfile, CharacterRelationship } from '@novel-eval/shared';

interface TensionPointView extends EvaluationEmotionalPointDto {
  x: number;
  y: number;
  idx: number;
}

interface ActiveTensionPoint {
  x: number;
  y: number;
  idx: number;
  tension: number;
  chapterId: string;
  annotation?: string | null;
}

function dimensionScore(dimensions: Record<string, EvaluationDimensionDto>, key: string): number {
  return dimensions[key]?.score ?? 0;
}

function dimensionLabel(key: string): string {
  for (const dimensionKey of EVALUATION_DIMENSION_KEYS) {
    if (dimensionKey === key) return EVALUATION_DIMENSION_LABELS[dimensionKey];
  }
  return key;
}

function excerptAnchorId(excerpt: EvaluationExcerptDto, fallbackIndex: number): string {
  const chapter = excerpt.chapterId ?? 'chapter';
  const index = excerpt.excerptIndex ?? fallbackIndex;
  return `excerpt-${chapter}-${index}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

function excerptRefKey(chapterId: string, excerptIndex: number): string {
  return `${chapterId}#${excerptIndex}`;
}

function excerptLabel(excerpt: EvaluationExcerptDto, fallbackIndex: number): string {
  const chapter = excerpt.chapterId ?? '未知章节';
  const index = excerpt.excerptIndex ?? fallbackIndex;
  return `${chapter} #${index + 1}`;
}

export function EvaluationReport() {
  const { taskId } = useParams();
  const [searchParams] = useSearchParams();

  const [report, setReport] = useState<EvaluationReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTensionPoint, setActiveTensionPoint] = useState<ActiveTensionPoint | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [importProjectId, setImportProjectId] = useState(searchParams.get('projectId') ?? '');
  const [maxSuggestions, setMaxSuggestions] = useState(8);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  useEffect(() => {
    if (!taskId) return;
    getEvaluationReport(taskId)
      .then((data) => {
        setReport(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '报告不存在或仍在生成中');
        setLoading(false);
      });
  }, [taskId]);

  useEffect(() => {
    api<Project[]>('/projects')
      .then((list) => setProjects(Array.isArray(list) ? list : []))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    const fromQuery = searchParams.get('projectId') ?? '';
    if (fromQuery) setImportProjectId(fromQuery);
  }, [searchParams]);

  const evalHomePath = importProjectId
    ? `/eval?projectId=${encodeURIComponent(importProjectId)}`
    : '/eval';

  const importSuggestions = async () => {
    if (!report || !importProjectId) {
      setImportMsg('请先选择要导入的写作项目');
      return;
    }
    setImportBusy(true);
    setImportMsg('');
    try {
      const outcome = await importRevisionTasks(importProjectId, {
        suggestions: report.suggestions ?? [],
        sourceEvalTaskId: taskId ?? null,
        replaceOpen,
        maxSuggestions,
      });
      setImportMsg(
        `已导入 ${outcome.createdCount} 条修订任务` +
          (outcome.dismissedOpenCount > 0 ? `（关闭旧 open ${outcome.dismissedOpenCount}）` : ''),
      );
    } catch (e: unknown) {
      setImportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  };

  if (loading) {
    return <div className="container loading">正在加载评估报告...</div>;
  }

  if (error || !report) {
    return (
      <div className="container error" style={{ textAlign: 'center' }}>
        <h3>获取报告失败</h3>
        <p>{error}</p>
        <Link to={evalHomePath} className="btn btn-primary" style={{ marginTop: 16 }}>返回评估列表</Link>
      </div>
    );
  }

  const { overall, dimensions, novel, suggestions } = report;
  const excerpts = report.excerpts ?? [];
  const excerptsByRef = new Map<string, { excerpt: EvaluationExcerptDto; index: number }>();
  excerpts.forEach((excerpt, index) => {
    if (excerpt.chapterId && typeof excerpt.excerptIndex === 'number') {
      excerptsByRef.set(excerptRefKey(excerpt.chapterId, excerpt.excerptIndex), { excerpt, index });
    }
  });
  const excerptRefsByDimension = new Map<string, Array<{ excerpt: EvaluationExcerptDto; index: number }>>();
  excerpts.forEach((excerpt, index) => {
    const existing = excerptRefsByDimension.get(excerpt.dimension) ?? [];
    existing.push({ excerpt, index });
    excerptRefsByDimension.set(excerpt.dimension, existing);
  });
  const dimensionEntries = EVALUATION_DIMENSION_KEYS
    .map((key) => ({ key, label: EVALUATION_DIMENSION_LABELS[key], dim: dimensions[key] }))
    .filter((entry): entry is {
      key: EvaluationDimensionKey;
      label: string;
      dim: EvaluationDimensionDto;
    } => entry.dim !== undefined);

  const radarData = EVALUATION_DIMENSION_KEYS.map((key) => dimensionScore(dimensions, key));
  const radarLabels = EVALUATION_DIMENSION_KEYS.map((key) => EVALUATION_DIMENSION_LABELS[key]);

  const getGradeClass = (grade: string) => {
    switch (grade) {
      case 'S': return 'report-grade-s';
      case 'A': return 'report-grade-a';
      case 'B': return 'report-grade-b';
      case 'C': return 'report-grade-c';
      default: return 'report-grade-d';
    }
  };

  const tensionCurve = report.emotionalCurve ?? [];
  const svgWidth = 800;
  const svgHeight = 220;
  const svgPadding = { top: 20, right: 45, bottom: 35, left: 45 };

  const chartWidth = svgWidth - svgPadding.left - svgPadding.right;
  const chartHeight = svgHeight - svgPadding.top - svgPadding.bottom;

  const tensionPoints: TensionPointView[] = tensionCurve.map((pt, idx) => {
    const x = svgPadding.left + (idx / Math.max(1, tensionCurve.length - 1)) * chartWidth;
    const y = svgPadding.top + chartHeight - (pt.tension / 100) * chartHeight;
    return { ...pt, x, y, idx };
  });

  const tensionLinePath = tensionPoints.length > 0
    ? `M ${tensionPoints.map((p) => `${p.x},${p.y}`).join(' L ')}`
    : '';

  const tensionAreaPath = tensionPoints.length > 0
    ? `${tensionLinePath} L ${tensionPoints[tensionPoints.length - 1].x},${svgHeight - svgPadding.bottom} L ${tensionPoints[0].x},${svgHeight - svgPadding.bottom} Z`
    : '';

  const characters: CharacterProfile[] = report.characters ?? [];

  return (
    <div className="container">
      <div className="eval-report-header">
        <div>
          <Link to={evalHomePath} className="back-link" style={{ marginBottom: 12 }}>
            ← 返回评估中心
          </Link>
          <div className="eval-title" style={{ fontSize: 32 }}>{novel.title}</div>
          <p className="project-subheading">
            <span>作者: {novel.author}</span>
            <span>字数: {novel.wordCount?.toLocaleString() || novel.wordCount} 字</span>
            <span>章节: {novel.totalChapters} 章</span>
            {novel.genre && <span>类型: {novel.genre}</span>}
            {novel.targetAudience && <span>受众: {novel.targetAudience}</span>}
          </p>
        </div>
        <div className="report-grade-box">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>综合评级</div>
          <div className={`report-grade-value ${getGradeClass(overall.grade)}`}>
            {overall.grade}
            <span style={{ fontSize: 20, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 'normal' }}>
              ({overall.totalScore?.toFixed(1) || overall.totalScore})
            </span>
          </div>
        </div>
      </div>

      {report.coverage && (
        <div
          className={`coverage-banner ${report.coverage.complete ? 'coverage-ok' : 'coverage-warn'}`}
          role="status"
        >
          <strong>{report.coverage.complete ? '覆盖完整' : '覆盖不完整'}</strong>
          <span>
            证据回链 {report.coverage.evidenceLinkedCount ?? 0}/{report.coverage.excerptCount}
            {report.coverage.evidenceLinkRate !== undefined
              ? `（${Math.round(report.coverage.evidenceLinkRate * 100)}%）`
              : ''}
          </span>
          <span>
            跳章 {report.coverage.skippedChapterCount ?? 0}
            {report.coverage.chapterSkipRate !== undefined
              ? `（${Math.round(report.coverage.chapterSkipRate * 100)}%）`
              : ''}
          </span>
          {!report.coverage.complete && (report.coverage.incompleteReasons?.length ?? 0) > 0 && (
            <span className="coverage-reasons">{report.coverage.incompleteReasons!.join('；')}</span>
          )}
        </div>
      )}

      <div className="report-grid">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2 style={{ alignSelf: 'flex-start', marginBottom: 16 }}>维度解析</h2>
          <RadarChart data={radarData} labels={radarLabels} size={300} />
        </div>

        <div className="dim-list">
          {dimensionEntries.map(({ key, label, dim }) => {
            const dimExcerpts = excerptRefsByDimension.get(key) ?? [];
            return (
            <div key={key} className="dim-item">
              <div className="dim-score-box">
                <span className="dim-score-value">{dim.score?.toFixed(1) || dim.score}</span>
                <span className="dim-score-label">{label}</span>
              </div>
              <div style={{ flexGrow: 1 }}>
                <p className="dim-analysis-text">{dim.analysis}</p>
                {dimExcerpts.length > 0 && (
                  <div className="excerpt-link-row">
                    {dimExcerpts.slice(0, 3).map(({ excerpt, index }) => (
                      <a key={excerptAnchorId(excerpt, index)} href={`#${excerptAnchorId(excerpt, index)}`}>
                        证据 {excerptLabel(excerpt, index)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {tensionCurve.length > 0 && (
        <div className="card tension-chart-card" style={{ marginTop: 32 }}>
          <h2>章节情绪张力曲线</h2>
          <div className="tension-chart-wrapper" ref={chartContainerRef} style={{ marginTop: 24 }}>
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              width="100%"
              height="100%"
              style={{ overflow: 'visible' }}
            >
              <defs>
                <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.4"/>
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0"/>
                </linearGradient>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {[0, 25, 50, 75, 100].map((gridVal) => {
                const y = svgPadding.top + chartHeight - (gridVal / 100) * chartHeight;
                return (
                  <g key={gridVal}>
                    <line
                      x1={svgPadding.left}
                      y1={y}
                      x2={svgWidth - svgPadding.right}
                      y2={y}
                      stroke="var(--border)"
                      strokeWidth="1"
                      strokeDasharray="4,4"
                    />
                    <text
                      x={svgPadding.left - 10}
                      y={y}
                      fill="var(--text-muted)"
                      fontSize="10"
                      textAnchor="end"
                      dominantBaseline="middle"
                    >
                      {gridVal}
                    </text>
                  </g>
                );
              })}

              {tensionAreaPath && (
                <path d={tensionAreaPath} fill="url(#chart-grad)" />
              )}

              {tensionLinePath && (
                <path
                  d={tensionLinePath}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="3"
                  filter="url(#glow)"
                />
              )}

              {tensionPoints.map((pt) => (
                <circle
                  key={pt.idx}
                  cx={pt.x}
                  cy={pt.y}
                  r={activeTensionPoint?.idx === pt.idx ? 7 : 4}
                  fill="var(--bg)"
                  stroke="var(--primary)"
                  strokeWidth="3"
                  style={{ cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={(e) => {
                    const svgElement = e.currentTarget.ownerSVGElement;
                    const rectSvg = svgElement?.getBoundingClientRect();
                    const ratio = rectSvg ? rectSvg.width / svgWidth : 1;

                    setActiveTensionPoint({
                      x: pt.x * ratio,
                      y: pt.y * ratio,
                      idx: pt.idx,
                      tension: pt.tension,
                      chapterId: pt.chapterId,
                      annotation: pt.annotation,
                    });
                  }}
                  onMouseLeave={() => {
                    setActiveTensionPoint(null);
                  }}
                />
              ))}

              {tensionPoints.filter((_, i) => {
                if (tensionPoints.length <= 15) return true;
                if (tensionPoints.length <= 40) return i % 2 === 0;
                return i % 5 === 0;
              }).map((pt) => (
                <text
                  key={pt.idx}
                  x={pt.x}
                  y={svgHeight - svgPadding.bottom + 18}
                  fill="var(--text-muted)"
                  fontSize="10"
                  textAnchor="middle"
                >
                  {pt.chapterId.replace('chapter-', 'Ch.')}
                </text>
              ))}
            </svg>

            {activeTensionPoint && (
              <div
                className="chart-tooltip"
                style={{
                  left: `${activeTensionPoint.x}px`,
                  top: `${activeTensionPoint.y - 12}px`,
                  transform: 'translate(-50%, -100%)',
                }}
              >
                <div style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 4 }}>
                  第 {activeTensionPoint.idx + 1} 章 ({activeTensionPoint.chapterId})
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>张力值:</span>
                  <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{activeTensionPoint.tension}</span>
                </div>
                {activeTensionPoint.annotation && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, fontStyle: 'italic', lineHeight: 1.4 }}>
                    {activeTensionPoint.annotation}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {characters.length > 0 && (
        <div className="card" style={{ marginTop: 32 }}>
          <h2>人物谱系与人设弧光</h2>
          <div className="character-grid" style={{ marginTop: 20 }}>
            {characters.map((char, idx) => (
              <div key={idx} className="character-card">
                <div>
                  <div className="char-header">
                    <span className="char-name">{char.name}</span>
                    <span className="char-role-badge">{char.role}</span>
                  </div>
                  {char.aliases && char.aliases.length > 0 && (
                    <div className="char-meta-row">
                      别名：{char.aliases.join('、')}
                    </div>
                  )}
                  {char.firstAppearance && (
                    <div className="char-meta-row">
                      首次登场：{char.firstAppearance}
                    </div>
                  )}
                  {char.arc && (
                    <div className="char-arc">
                      <strong>人物弧光：</strong>{char.arc}
                    </div>
                  )}
                </div>
                {char.relationships && char.relationships.length > 0 && (
                  <div className="char-relations">
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>人物关系</div>
                    {char.relationships.map((rel: CharacterRelationship, rIdx: number) => (
                      <div key={rIdx} className="char-relation-item">
                        <span>{rel.target} ({rel.type})</span>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rel.strength}</span>
                          <div className="char-relation-strength">
                            <div className="char-relation-fill" style={{ width: `${rel.strength}%` }}></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.marketBenchmark && (
        <div className="card" style={{ marginTop: 32 }}>
          <h2>市场定位与受众对标</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
              <div>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 6 }}>市场定位</div>
                <p className="dim-analysis-text" style={{ color: 'var(--text)', fontSize: 14, margin: 0 }}>
                  {report.marketBenchmark.positioning}
                </p>
              </div>
              <div>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 6 }}>受众契合度</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="progress-bar" style={{ flexGrow: 1, margin: 0 }}>
                    <div className="progress-fill" style={{ width: `${report.marketBenchmark.audienceFit}%` }}></div>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>{report.marketBenchmark.audienceFit}%</span>
                </div>
              </div>
            </div>

            {report.marketBenchmark.comparables && report.marketBenchmark.comparables.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>同类作品竞品对比</div>
                <div className="market-comps-grid">
                  {report.marketBenchmark.comparables.map((comp: EvaluationMarketComparableDto, idx: number) => (
                    <div key={idx} className="comp-card">
                      <div className="comp-title-bar">
                        <span className="comp-title">《{comp.title}》</span>
                        <span className="comp-similarity">相似度 {comp.similarity}%</span>
                      </div>
                      <div className="comp-detail">
                        <strong>对标理由：</strong>{comp.matchReason}
                      </div>
                      <div className="comp-detail">
                        <strong>差异化卖点：</strong>{comp.differentiation}
                      </div>
                      {comp.referenceNote && (
                        <div className="comp-detail" style={{ borderLeft: '2px solid var(--border)', paddingLeft: 8, fontStyle: 'italic', fontSize: 11 }}>
                          <strong>参考价值：</strong>{comp.referenceNote}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.marketBenchmark.disclaimer && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 10 }}>
                * {report.marketBenchmark.disclaimer}
              </div>
            )}
          </div>
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="card" style={{ marginTop: 32 }}>
          <h2>核心优化建议</h2>
          <div
            style={{
              marginTop: 16,
              padding: 14,
              border: '1px solid var(--border)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>导入为修订清单 → 在项目里打开修正</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <label style={{ fontSize: 13 }}>
                写作项目{' '}
                <select
                  value={importProjectId}
                  onChange={(e) => setImportProjectId(e.target.value)}
                  style={{ marginLeft: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
                >
                  <option value="">选择项目…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                最多导入{' '}
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={maxSuggestions}
                  onChange={(e) => setMaxSuggestions(parseInt(e.target.value, 10) || 8)}
                  style={{ width: 64, marginLeft: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={replaceOpen}
                  onChange={(e) => setReplaceOpen(e.target.checked)}
                />{' '}
                替换现有 open 任务
              </label>
              <button
                className="btn btn-primary"
                disabled={importBusy || !importProjectId}
                onClick={() => void importSuggestions()}
              >
                {importBusy ? '导入中…' : '导入修订任务'}
              </button>
              {importProjectId && (
                <Link to={`/projects/${importProjectId}`} className="btn">
                  打开项目 →
                </Link>
              )}
            </div>
            {importMsg && (
              <div style={{ fontSize: 13, color: importMsg.startsWith('已导入') ? 'var(--green)' : 'var(--red)' }}>
                {importMsg}
              </div>
            )}
          </div>
          <div className="suggestions-grid" style={{ marginTop: 24 }}>
            {suggestions.map((sugg: EvaluationSuggestionDto, i: number) => (
              <div key={i} className="suggestion-card">
                <span className="suggestion-num">{i + 1}.</span>
                <div className="suggestion-body">
                  <div className="suggestion-tag-bar">
                    <span className="suggestion-tag">{dimensionLabel(sugg.dimension)}</span>
                    {sugg.type && <span className="suggestion-tag">{sugg.type}</span>}
                  </div>
                  <p className="dim-analysis-text" style={{ margin: 0, color: 'var(--text)' }}>
                    {sugg.content}
                  </p>
                  {sugg.excerptRef && (
                    <div className="excerpt-link-row" style={{ marginTop: 8 }}>
                      {(() => {
                        const linked = excerptsByRef.get(excerptRefKey(
                          sugg.excerptRef.chapterId,
                          sugg.excerptRef.excerptIndex,
                        ));
                        if (!linked) return null;
                        return (
                          <a href={`#${excerptAnchorId(linked.excerpt, linked.index)}`}>
                            查看证据 {excerptLabel(linked.excerpt, linked.index)}
                          </a>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {excerpts.length > 0 && (
        <div className="card" style={{ marginTop: 32 }}>
          <h2>证据摘录</h2>
          <div className="excerpt-grid">
            {excerpts.map((excerpt, index) => (
              <div
                key={excerptAnchorId(excerpt, index)}
                id={excerptAnchorId(excerpt, index)}
                className="excerpt-card"
              >
                <div className="excerpt-card-meta">
                  <span>{dimensionLabel(excerpt.dimension)}</span>
                  <span>{excerptLabel(excerpt, index)}</span>
                  {typeof excerpt.offset === 'number' && <span>offset {excerpt.offset}</span>}
                </div>
                <blockquote>{excerpt.text}</blockquote>
                <p>{excerpt.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
