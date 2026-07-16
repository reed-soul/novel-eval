import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.ts';
import type { ChapterScore } from '../api/client.ts';
import { RadarChart } from '../components/RadarChart.tsx';

interface Foreshadow {
  description: string;
  setupChapter?: number;
  resolveChapter?: number | null;
}
interface DashboardData {
  scores: ChapterScore[];
  narrative: { macroSummary?: string; openForeshadows?: Foreshadow[] };
  characters: { name: string; status?: string }[];
}

const GRADE_COLORS: Record<string, string> = {
  S: '#7c3aed', A: '#059669', B: '#d97706', C: '#dc2626', D: '#6b7280',
};

export function Dashboard() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<DashboardData>(`/projects/${id}/dashboard`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  if (error) return <div className="card"><p>加载失败：{error}</p></div>;
  if (!data) return <div className="card"><p>加载中…</p></div>;

  const { scores, narrative, characters } = data;
  const totalChapters = scores.length;

  // 等级分布
  const gradeCount: Record<string, number> = {};
  for (const s of scores) gradeCount[s.grade] = (gradeCount[s.grade] ?? 0) + 1;
  const gradeLabels = Object.keys(gradeCount);
  const gradeValues = gradeLabels.map((g) => gradeCount[g]);

  // 平均分
  const avg = totalChapters ? Math.round(scores.reduce((s, x) => s + x.score, 0) / totalChapters) : 0;

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>📊 评估仪表盘</h2>
        <Link to={`/projects/${id}`} className="btn" style={{ fontSize: 13 }}>← 返回项目</Link>
      </div>

      {/* 概览卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--primary)' }}>{totalChapters}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>已评估章节</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: avg >= 80 ? '#059669' : avg >= 70 ? '#d97706' : '#dc2626' }}>{avg}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>平均分</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#059669' }}>{gradeCount['A'] ?? 0}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>A级章节数</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#dc2626' }}>{(gradeCount['C'] ?? 0) + (gradeCount['D'] ?? 0)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>C/D级(待改进)</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* 章节质量趋势带 */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ marginTop: 0 }}>章节质量趋势</h3>
          {totalChapters === 0 ? <p className="empty">暂无评估数据</p> : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {scores.map((s) => (
                  <Link
                    key={s.chapter}
                    to={`/projects/${id}/chapters/${s.chapter}`}
                    title={`第${s.chapter}章 ${s.grade}(${s.score})`}
                    style={{
                      display: 'inline-block', width: 18, height: 24, borderRadius: 3,
                      background: GRADE_COLORS[s.grade] ?? '#6b7280',
                      opacity: 0.4 + (s.score / 100) * 0.6,
                      textDecoration: 'none',
                    }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                {['S', 'A', 'B', 'C', 'D'].map((g) => (
                  <span key={g} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: GRADE_COLORS[g] }} />
                    {g}级 {gradeCount[g] ?? 0}章
                  </span>
                ))}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>点击色块跳转到对应章节</p>
            </>
          )}
        </div>

        {/* 等级分布雷达 */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>等级分布</h3>
          {gradeLabels.length > 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <RadarChart data={gradeValues} labels={gradeLabels.map((g) => `${g}级`)} size={260} />
            </div>
          ) : <p className="empty">无数据</p>}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>各等级章节数量分布</p>
        </div>

        {/* 角色当前状态 */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>角色状态</h3>
          {characters.length === 0 ? <p className="empty">无角色数据</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {characters.slice(0, 8).map((c) => (
                <div key={c.name} style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                  {c.status && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{c.status}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 伏笔回收追踪 */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ marginTop: 0 }}>伏笔回收追踪</h3>
          {(narrative.openForeshadows?.length ?? 0) === 0 ? <p className="empty">无伏笔数据</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(narrative.openForeshadows ?? []).map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
                  <span style={{ fontSize: 18, lineHeight: 1.2 }}>{f.resolveChapter ? '✅' : '⏳'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>{f.description}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {f.setupChapter ? `埋设于第${f.setupChapter}章` : ''}
                      {f.resolveChapter ? ` → 已回收于第${f.resolveChapter}章` : ' → 待回收'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 宏观主线摘要 */}
      {narrative.macroSummary && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>宏观主线摘要</h3>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, margin: 0 }}>{narrative.macroSummary}</p>
        </div>
      )}
    </div>
  );
}
