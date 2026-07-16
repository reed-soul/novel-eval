/**
 * 单章质量速览 — 在 ChapterReader 工具栏上方展示
 *
 * 这个页面的任务只有一个：帮用户看清「这一章哪里差」。
 *   1. 八维分数（横向条）——本章得分，低分标红
 *   2. 重复片段（本章实时检测）——本章正文里出现≥3次的重复短语
 *
 * 不塞全书统计——那是项目级视图的事，不该混进单章页面。
 */
import { useState, useEffect } from 'react';
import {
  getChapterEval, diagnoseChapter,
  type EvalHistoryRecord, type ChapterDiagnosis,
} from '../api/client.ts';
import {
  EVALUATION_DIMENSION_KEYS,
  EVALUATION_DIMENSION_LABELS,
} from '@novel-eval/shared/dto';

interface Props {
  projectId: string;
  chapterNumber: number;
}

const LOW_THRESHOLD = 65;

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--success, #30a46c)';
  if (score >= 65) return 'var(--accent, #6e56cf)';
  return 'var(--danger, #e5484d)';
}

export function ChapterQualityPanel({ projectId, chapterNumber }: Props) {
  const [evalHistory, setEvalHistory] = useState<EvalHistoryRecord[]>([]);
  const [diagnosis, setDiagnosis] = useState<ChapterDiagnosis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      getChapterEval(projectId, chapterNumber),
      diagnoseChapter(projectId, chapterNumber),
    ])
      .then(([e, d]) => {
        setEvalHistory(e.history);
        setDiagnosis(d.diagnose);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [projectId, chapterNumber]);

  if (loading) {
    return <div className="quality-panel-placeholder">加载本章评估数据...</div>;
  }
  if (error) {
    return <div className="quality-panel-placeholder">评估数据加载失败：{error}</div>;
  }
  if (evalHistory.length === 0) {
    return (
      <div className="quality-panel-empty">
        本章暂无评估数据（质量门槛评估后自动生成）
      </div>
    );
  }

  // 取最新一轮评估
  const latest = evalHistory[evalHistory.length - 1];
  const dims = latest.dimensions ?? {};
  const dimEntries = EVALUATION_DIMENSION_KEYS
    .filter((k) => dims[k])
    .map((k) => ({ key: k, label: EVALUATION_DIMENSION_LABELS[k], score: dims[k].score }));
  const lowDims = dimEntries.filter((d) => d.score < LOW_THRESHOLD);

  // 本章重复热点：来自实时诊断（detectRepetition 跑本章正文）
  const hotspots = diagnosis?.repetition.hotspots ?? [];

  return (
    <div className="chapter-quality-panel">
      {/* 1. 八维分数（本章） */}
      {dimEntries.length > 0 && (
        <div className="quality-section">
          <div className="quality-section-title">
            八维评分
            {latest.totalScore != null && (
              <span className="quality-total">
                总分 <strong style={{ color: scoreColor(latest.totalScore) }}>{latest.totalScore}</strong>
                {latest.grade && <span className="quality-grade">{latest.grade}</span>}
              </span>
            )}
          </div>
          <div className="dim-scores">
            {dimEntries.map((d) => (
              <div key={d.key} className="dim-score-row">
                <span className="dim-label">{d.label}</span>
                <div className="dim-bar-track">
                  <div
                    className="dim-bar-fill"
                    style={{ width: `${d.score}%`, background: scoreColor(d.score) }}
                  />
                </div>
                <span className="dim-score-value" style={{ color: scoreColor(d.score) }}>{d.score}</span>
              </div>
            ))}
          </div>
          {lowDims.length > 0 && (
            <div className="quality-hint">
              低分维度：{lowDims.map((d) => `${d.label}(${d.score})`).join('、')}
            </div>
          )}
        </div>
      )}

      {/* 2. 重复片段（本章实时检测） */}
      {hotspots.length > 0 && (
        <div className="quality-section quality-warn">
          <div className="quality-section-title">
            高频重复片段（建议消除）
          </div>
          <div className="hotspot-chips">
            {hotspots.slice(0, 8).map((h, i) => (
              <span key={i} className="hotspot-chip">{h}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
