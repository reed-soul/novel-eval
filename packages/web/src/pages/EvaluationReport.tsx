import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { RadarChart } from '../components/RadarChart.tsx';

export function EvaluationReport() {
  const { taskId } = useParams();
  
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    return <div className="p-8 text-center text-text-secondary animate-pulse">正在加载评估报告...</div>;
  }

  if (error || !report) {
    return <div className="p-8 text-center text-red-500">获取报告失败: {error}</div>;
  }

  const { overall, dimensions, novel, suggestions } = report;

  // Radar Data Extraction
  const radarData = [
    dimensions.worldBuilding?.score || 0,
    dimensions.characterization?.score || 0,
    dimensions.plotStructure?.score || 0,
    dimensions.proseAndTone?.score || 0,
    dimensions.marketPotential?.score || 0,
  ].map(v => v * 10); // assuming 10-point scale in backend, scale to 100 for radar

  const radarLabels = [
    '世界构建', '人物塑造', '情节架构', '文笔调性', '市场潜力'
  ];

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'S': return 'text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]';
      case 'A': return 'text-accent-primary drop-shadow-[0_0_8px_rgba(0,255,255,0.8)]';
      case 'B': return 'text-green-400';
      case 'C': return 'text-yellow-400';
      default: return 'text-red-400';
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-border-dim pb-6">
        <div>
          <h1 className="text-4xl font-bold text-text-primary mb-2">{novel.title}</h1>
          <p className="text-text-secondary flex gap-4">
            <span>作者: {novel.author}</span>
            <span>字数: {novel.wordCount} 字</span>
            <span>章节: {novel.totalChapters} 章</span>
          </p>
        </div>
        <div className="mt-4 md:mt-0 text-right">
          <div className="text-sm text-text-muted mb-1">综合评级</div>
          <div className={`text-6xl font-black ${getGradeColor(overall.grade)}`}>
            {overall.grade}
            <span className="text-2xl text-text-secondary ml-2 font-normal">({overall.totalScore.toFixed(1)})</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Radar Chart Section */}
        <div className="glass-panel lg:col-span-1 flex flex-col items-center justify-center p-6 rounded-xl border border-border-dim">
          <RadarChart data={radarData} labels={radarLabels} size={320} />
        </div>

        {/* Detailed Dimensions */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-semibold text-text-primary mb-4 border-l-4 border-accent-primary pl-3">维度深度分析</h2>
          {Object.entries(dimensions).map(([key, dim]: [string, any]) => (
            <div key={key} className="bg-bg-secondary border border-border-dim hover:border-border-muted transition-colors rounded-xl overflow-hidden">
              <div className="p-4 flex flex-col sm:flex-row gap-4">
                <div className="sm:w-24 shrink-0 flex flex-col items-center justify-center border-r border-border-dim pr-4">
                  <span className="text-3xl font-bold text-accent-secondary">{dim.score.toFixed(1)}</span>
                  <span className="text-xs text-text-muted uppercase mt-1">{key}</span>
                </div>
                <div>
                  <p className="text-text-primary text-sm leading-relaxed">{dim.analysis}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Suggestions Section */}
      {suggestions && suggestions.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-text-primary mb-4 border-l-4 border-accent-secondary pl-3">核心优化建议</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {suggestions.map((sugg: string, i: number) => (
              <div key={i} className="glass-panel rounded-xl border border-border-dim">
                <div className="p-4 flex items-start gap-3">
                  <span className="text-accent-primary font-bold text-lg">{i + 1}.</span>
                  <p className="text-text-secondary text-sm">{sugg}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
