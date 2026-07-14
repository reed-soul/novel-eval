import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type BibleRaw, type NarrativeState } from '../api/client.ts';

export function StateView() {
  const { id } = useParams<{ id: string }>();
  const [bible, setBible] = useState<BibleRaw | null>(null);
  const [narrative, setNarrative] = useState<NarrativeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.allSettled([
      api<BibleRaw>(`/projects/${id}/bible/raw`),
      api<NarrativeState>(`/projects/${id}/narrative`),
    ])
      .then(([b, n]) => {
        if (b.status === 'fulfilled') setBible(b.value);
        if (n.status === 'fulfilled') setNarrative(n.value);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="container loading">加载中...</div>;

  return (
    <div className="container">
      <div className="page-header">
        <h2>📖 设定与叙事状态</h2>
        <Link to={`/projects/${id}`} className="back-link">← 返回项目</Link>
      </div>

      {error && <div className="error">{error}</div>}

      {/* Bible 设定全文 */}
      {bible?.fullText && (
        <div className="card">
          <h2>Bible 设定全文</h2>
          <div className="chapter-content" style={{ fontSize: 14 }}>{bible.fullText}</div>
        </div>
      )}

      {/* 角色状态树 */}
      {bible?.characterState?.characters && (
        <div className="card">
          <h2>角色状态树</h2>
          {bible.characterState.characters.map((c, i) => (
            <div key={i} className="char-card">
              <h4>{c.name}</h4>
              <div className="char-fields">
                <div>物品：{c.items?.join('、') || '无'}</div>
                <div>能力：{c.abilities?.join('、') || '无'}</div>
                <div>状态：{c.status || '未知'}</div>
                <div>关系：{c.relationships?.join('；') || '无'}</div>
                <div>事件：{c.events?.join('；') || '无'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 叙事状态 */}
      {narrative && (
        <>
          <div className="card">
            <h2>宏观主线摘要（更新到第 {narrative.upToChapter} 章）</h2>
            <div className="chapter-content" style={{ fontSize: 14 }}>{narrative.macroSummary}</div>
          </div>

          <div className="card">
            <h2>未回收伏笔（{narrative.openForeshadows.length} 个）</h2>
            {narrative.openForeshadows.length === 0 ? (
              <div className="empty">全部已回收</div>
            ) : (
              <ul className="foreshadow-list">
                {narrative.openForeshadows.map((f, i) => (
                  <li key={i} className={f.resolveChapter ? 'resolved' : ''}>
                    <strong>第{f.setupChapter}章埋设</strong>：{f.description}
                    {f.resolveChapter && <span> → 第{f.resolveChapter}章回收</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {narrative.arcSummaries.length > 0 && (
            <div className="card">
              <h2>卷摘要（{narrative.arcSummaries.length} 份）</h2>
              {narrative.arcSummaries.map((a, i) => (
                <div key={i} className="char-card">
                  <h4>第 1-{a.upToChapter} 章</h4>
                  <div className="char-fields">{a.content}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
