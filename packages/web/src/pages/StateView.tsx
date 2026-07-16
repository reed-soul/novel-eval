import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getStoryState, type BibleRaw, type StoryStateResponse } from '../api/client.ts';

export function StateView() {
  const { id } = useParams<{ id: string }>();
  const [bible, setBible] = useState<BibleRaw | null>(null);
  const [storyState, setStoryState] = useState<StoryStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.allSettled([
      api<BibleRaw>(`/projects/${id}/bible/raw`),
      getStoryState(id),
    ])
      .then(([b, s]) => {
        if (b.status === 'fulfilled') setBible(b.value);
        if (s.status === 'fulfilled') setStoryState(s.value);
        if (b.status === 'rejected' && s.status === 'rejected') {
          setError('暂无 Bible 或 story state');
        }
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

      {/* Story state */}
      {storyState && (
        <>
          <div className="card">
            <h2>当前 story state（更新到第 {storyState.latestWrittenOutlinePosition ?? 0} 章）</h2>
            {storyState.current ? (
              <div className="chapter-content" style={{ fontSize: 14 }}>{storyState.current.summary}</div>
            ) : (
              <div className="empty">尚未发布章节状态。</div>
            )}
          </div>

          <div className="card">
            <h2>开放伏笔（{storyState.current?.state.foreshadows.length ?? 0} 个）</h2>
            {(storyState.current?.state.foreshadows.length ?? 0) === 0 ? (
              <div className="empty">暂无开放伏笔</div>
            ) : (
              <ul className="foreshadow-list">
                {storyState.current?.state.foreshadows.map((f, i) => (
                  <li key={i}>
                    <strong>{typeof f === 'string' ? f : JSON.stringify(f)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2>章节状态链（{storyState.currentStates.length}）</h2>
            {storyState.currentStates.length === 0 ? (
              <div className="empty">暂无状态修订。</div>
            ) : (
              storyState.currentStates.map((revision) => (
                <div key={revision.storyStateRevisionId} className="char-card">
                  <h4>第 {revision.outlinePosition} 章 · {revision.status}</h4>
                  <div className="char-fields">
                    <div>{revision.summary}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {revision.model} · {new Date(revision.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
