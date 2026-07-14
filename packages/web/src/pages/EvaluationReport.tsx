import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { RadarChart } from '../components/RadarChart.tsx';

const DIMENSION_LABELS: Record<string, string> = {
  storyStructure: '故事架构',
  characterization: '人物塑造',
  writingQuality: '文笔质量',
  emotionalResonance: '情感共鸣',
  marketPotential: '市场潜力',
};

export function EvaluationReport() {
  const { taskId } = useParams();
  
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTensionPoint, setActiveTensionPoint] = useState<any>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!taskId) return;
    fetch(`/api/eval/${taskId}/result`)
      .then(res => {
        if (!res.ok) throw new Error('报告不存在或仍在生成中');
        return res.json();
      })
      .then(data => {
        setReport(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [taskId]);

  if (loading) {
    return <div className="container loading">正在加载评估报告...</div>;
  }

  if (error || !report) {
    return (
      <div className="container error" style={{ textAlign: 'center' }}>
        <h3>获取报告失败</h3>
        <p>{error}</p>
        <Link to="/eval" className="btn btn-primary" style={{ marginTop: 16 }}>返回评估列表</Link>
      </div>
    );
  }

  const { overall, dimensions, novel, suggestions } = report;

  // Radar Data Extraction (Aligned with actual backend keys)
  const radarData = [
    dimensions.storyStructure?.score || 0,
    dimensions.characterization?.score || 0,
    dimensions.writingQuality?.score || 0,
    dimensions.emotionalResonance?.score || 0,
    dimensions.marketPotential?.score || 0,
  ];

  const radarLabels = [
    DIMENSION_LABELS.storyStructure,
    DIMENSION_LABELS.characterization,
    DIMENSION_LABELS.writingQuality,
    DIMENSION_LABELS.emotionalResonance,
    DIMENSION_LABELS.marketPotential,
  ];

  const getGradeClass = (grade: string) => {
    switch (grade) {
      case 'S': return 'report-grade-s';
      case 'A': return 'report-grade-a';
      case 'B': return 'report-grade-b';
      case 'C': return 'report-grade-c';
      default: return 'report-grade-d';
    }
  };

  // SVG Tension Curve Coordinate computations
  const tensionCurve = report.emotionalCurve || [];
  const svgWidth = 800;
  const svgHeight = 220;
  const svgPadding = { top: 20, right: 45, bottom: 35, left: 45 };
  
  const chartWidth = svgWidth - svgPadding.left - svgPadding.right;
  const chartHeight = svgHeight - svgPadding.top - svgPadding.bottom;
  
  const tensionPoints = tensionCurve.map((pt: any, idx: number) => {
    const x = svgPadding.left + (idx / Math.max(1, tensionCurve.length - 1)) * chartWidth;
    const y = svgPadding.top + chartHeight - (pt.tension / 100) * chartHeight;
    return { ...pt, x, y, idx };
  });

  const tensionLinePath = tensionPoints.length > 0
    ? `M ${tensionPoints.map(p => `${p.x},${p.y}`).join(' L ')}`
    : '';

  const tensionAreaPath = tensionPoints.length > 0
    ? `${tensionLinePath} L ${tensionPoints[tensionPoints.length - 1].x},${svgHeight - svgPadding.bottom} L ${tensionPoints[0].x},${svgHeight - svgPadding.bottom} Z`
    : '';

  return (
    <div className="container">
      {/* Report Header */}
      <div className="eval-report-header">
        <div>
          <Link to="/eval" className="back-link" style={{ marginBottom: 12 }}>
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

      {/* Main Grid: Radar and Details */}
      <div className="report-grid">
        {/* Left Column: Radar Chart */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2 style={{ alignSelf: 'flex-start', marginBottom: 16 }}>维度解析</h2>
          <RadarChart data={radarData} labels={radarLabels} size={300} />
        </div>

        {/* Right Column: Detailed Dimensions */}
        <div className="dim-list">
          {Object.entries(dimensions).map(([key, dim]: [string, any]) => (
            <div key={key} className="dim-item">
              <div className="dim-score-box">
                <span className="dim-score-value">{dim.score?.toFixed(1) || dim.score}</span>
                <span className="dim-score-label">{DIMENSION_LABELS[key] || key}</span>
              </div>
              <div style={{ flexGrow: 1 }}>
                <p className="dim-analysis-text">{dim.analysis}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tension Curve SVG Line Chart */}
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

              {/* Grid Lines */}
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

              {/* Area Path */}
              {tensionAreaPath && (
                <path d={tensionAreaPath} fill="url(#chart-grad)" />
              )}

              {/* Line Path */}
              {tensionLinePath && (
                <path 
                  d={tensionLinePath} 
                  fill="none" 
                  stroke="var(--primary)" 
                  strokeWidth="3" 
                  filter="url(#glow)"
                />
              )}

              {/* Points */}
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
                    const rect = chartContainerRef.current?.getBoundingClientRect();
                    if (rect) {
                      const svgElement = e.currentTarget.ownerSVGElement;
                      const rectSvg = svgElement?.getBoundingClientRect();
                      const ratio = rectSvg ? rectSvg.width / svgWidth : 1;
                      
                      setActiveTensionPoint({
                        x: pt.x * ratio,
                        y: pt.y * ratio,
                        idx: pt.idx,
                        tension: pt.tension,
                        chapterId: pt.chapterId,
                        annotation: pt.annotation
                      });
                    }
                  }}
                  onMouseLeave={() => {
                    setActiveTensionPoint(null);
                  }}
                />
              ))}
              
              {/* X Axis Labels */}
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

            {/* Tension Tooltip overlay */}
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

      {/* Characters Spectrum Section */}
      {report.characters && report.characters.length > 0 && (
        <div className="card" style={{ marginTop: 32 }}>
          <h2>人物谱系与人设弧光</h2>
          <div className="character-grid" style={{ marginTop: 20 }}>
            {report.characters.map((char: any, idx: number) => (
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
                    {char.relationships.map((rel: any, rIdx: number) => (
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

      {/* Market Benchmark Section */}
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
                  {report.marketBenchmark.comparables.map((comp: any, idx: number) => (
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

      {/* Suggestions Section */}
      {suggestions && suggestions.length > 0 && (
        <div className="card" style={{ marginTop: 32 }}>
          <h2>核心优化建议</h2>
          <div className="suggestions-grid" style={{ marginTop: 24 }}>
            {suggestions.map((sugg: any, i: number) => (
              <div key={i} className="suggestion-card">
                <span className="suggestion-num">{i + 1}.</span>
                <div className="suggestion-body">
                  <div className="suggestion-tag-bar">
                    <span className="suggestion-tag">{DIMENSION_LABELS[sugg.dimension] || sugg.dimension}</span>
                    {sugg.type && <span className="suggestion-tag">{sugg.type}</span>}
                  </div>
                  <p className="dim-analysis-text" style={{ margin: 0, color: 'var(--text)' }}>
                    {sugg.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
