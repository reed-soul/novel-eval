import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, type ChapterScore, type LessonItem } from '../api/client.ts';

interface Props {
  projectId: string;
}

const GRADE_COLOR: Record<string, string> = {
  S: '#7c3aed', A: '#16a34a', B: '#ca8a04', C: '#ea580c', D: '#dc2626',
};

const LOW_SCORE = 75;

function isLowScore(score: ChapterScore): boolean {
  return score.score < LOW_SCORE || score.grade === 'C' || score.grade === 'D';
}

export function QualityPanel({ projectId }: Props) {
  const [scores, setScores] = useState<ChapterScore[]>([]);
  const [lessons, setLessons] = useState<LessonItem[]>([]);
  const [tab, setTab] = useState<'trend' | 'lessons'>('trend');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api<{ scores: ChapterScore[] }>(`/projects/${projectId}/scores`),
      api<{ lessons: LessonItem[] }>(`/projects/${projectId}/lessons`),
    ])
      .then(([s, l]) => {
        setScores(s.scores);
        setLessons(l.lessons);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setScores([]);
        setLessons([]);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: 14 }}>加载评估数据...</div>;

  if (error) {
    return (
      <div className="error" style={{ fontSize: 14 }}>
        评估数据加载失败：{error}
      </div>
    );
  }

  if (scores.length === 0 && lessons.length === 0) {
    return (
      <div style={{ color: 'var(--muted)', fontSize: 14 }}>
        暂无评估数据。写完章节后质量门槛会自动记分；也可
        <Link to={`/eval?projectId=${encodeURIComponent(projectId)}`} style={{ marginLeft: 4 }}>
          发起全书评估 →
        </Link>
      </div>
    );
  }

  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((s, c) => s + c.score, 0) / scores.length)
    : 0;
  const aCount = scores.filter((s) => s.grade === 'A' || s.grade === 'S').length;
  const lowScores = scores.filter(isLowScore);
  const maxScore = 100;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className={`btn ${tab === 'trend' ? 'btn-primary' : ''}`} onClick={() => setTab('trend')}>
          📊 质量趋势（{scores.length} 章）
        </button>
        <button className={`btn ${tab === 'lessons' ? 'btn-primary' : ''}`} onClick={() => setTab('lessons')}>
          🧠 写作经验（{lessons.length} 条）
        </button>
        <Link
          to={`/eval?projectId=${encodeURIComponent(projectId)}`}
          className="btn"
          style={{ fontSize: 13 }}
        >
          全书评估 →
        </Link>
      </div>

      {tab === 'trend' && (
        <div>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12, fontSize: 14, flexWrap: 'wrap' }}>
            <span>
              平均分：
              <strong style={{ color: GRADE_COLOR[avgScore >= 80 ? 'A' : avgScore >= 75 ? 'B' : 'C'] }}>
                {avgScore}
              </strong>
            </span>
            <span>
              A 级：
              <strong style={{ color: '#16a34a' }}>{aCount}</strong> / {scores.length}
            </span>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 2,
            height: 100,
            overflowX: 'auto',
            padding: '4px 0',
          }}>
            {scores.map((s) => (
              <Link
                key={s.chapter}
                to={
                  isLowScore(s)
                    ? `/projects/${projectId}/chapters/${s.chapter}/correction`
                    : `/projects/${projectId}/chapters/${s.chapter}`
                }
                title={
                  isLowScore(s)
                    ? `第 ${s.chapter} 章：${s.score} 分（${s.grade}）· 点击去修正`
                    : `第 ${s.chapter} 章：${s.score} 分（${s.grade}）`
                }
                style={{
                  minWidth: 8,
                  height: `${(s.score / maxScore) * 100}%`,
                  background: GRADE_COLOR[s.grade] ?? '#999',
                  borderRadius: '2px 2px 0 0',
                  flex: '1 0 auto',
                  maxWidth: 20,
                  display: 'block',
                  opacity: isLowScore(s) ? 1 : 0.85,
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 2, fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
            {scores.filter((_, i) => i % 5 === 0).map((s) => (
              <span key={s.chapter} style={{ minWidth: 40, textAlign: 'center' }}>{s.chapter}</span>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            颜色：
            <span style={{ color: GRADE_COLOR.A }}>■A(80+)</span>{' '}
            <span style={{ color: GRADE_COLOR.B }}>■B(70-79)</span>{' '}
            <span style={{ color: GRADE_COLOR.C }}>■C(60-69)</span>
            ；低分柱可点进修正
          </div>
          {lowScores.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                建议修正（{lowScores.length}）
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {lowScores.map((s) => (
                  <Link
                    key={s.chapter}
                    to={`/projects/${projectId}/chapters/${s.chapter}/correction`}
                    className="btn"
                    style={{ fontSize: 13 }}
                  >
                    第 {s.chapter} 章 · {s.score}（{s.grade}）
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'lessons' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {lessons.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>
              暂无经验数据。写完 10 章后系统会自动聚合经验。
            </div>
          ) : (
            lessons.map((l, i) => (
              <div key={i} style={{
                border: '1px solid var(--border)', borderRadius: 6, padding: 10,
                background: l.avgScore < 75 ? 'rgba(234,88,12,0.05)' : 'transparent',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong style={{ fontSize: 14 }}>{l.pattern}</strong>
                  <span style={{
                    fontSize: 13, fontWeight: 600,
                    color: l.avgScore >= 80 ? '#16a34a' : l.avgScore >= 75 ? '#ca8a04' : '#ea580c',
                  }}>
                    {l.dimension ?? '综合'}：{l.avgScore} 分
                  </span>
                </div>
                {l.commonIssues.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                    {l.commonIssues.map((issue, j) => <div key={j}>⚠ {issue}</div>)}
                  </div>
                )}
                {l.effectiveFixes.length > 0 && (
                  <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4, lineHeight: 1.5 }}>
                    {l.effectiveFixes.map((fix, j) => <div key={j}>✓ {fix}</div>)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
