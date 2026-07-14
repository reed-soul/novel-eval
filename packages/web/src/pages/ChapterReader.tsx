import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api, type ChapterDetail } from '../api/client.ts';
import { ChapterQualityPanel } from '../components/ChapterQualityPanel.tsx';

export function ChapterReader() {
  const { id, n } = useParams<{ id: string; n: string }>();
  const navigate = useNavigate();
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!id || !n) return;
    setLoading(true);
    api<ChapterDetail>(`/projects/${id}/chapters/${n}`)
      .then((ch) => { setChapter(ch); setEditContent(ch.content ?? ''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id, n]);

  const saveEdit = async () => {
    if (!id || !n || !chapter) return;
    setSaving(true);
    const res = await fetch(`/api/projects/${id}/chapters/${n}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.error) { setError(data.error); return; }
    setEditing(false);
    load();  // 重新加载
  };

  if (loading) return <div className="container loading">加载中...</div>;
  if (error) return <div className="container error">错误：{error}</div>;
  if (!chapter) return <div className="container empty">章节不存在</div>;

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h2>第 {chapter.number} 章《{chapter.title}》</h2>
          <div className="project-subheading">
            {chapter.wordCount} 字 · {chapter.written ? '✓ 已写' : '✗ 未写'}
          </div>
        </div>
        <Link to={`/projects/${id}`} className="back-link">← 返回项目</Link>
      </div>

      <div className="outline-info">
        <dl>
          <dt>幕/段落</dt><dd>第{chapter.outline.act}幕 · {chapter.outline.beat}</dd>
          <dt>定位</dt><dd>{chapter.outline.role}</dd>
          <dt>核心作用</dt><dd>{chapter.outline.purpose}</dd>
          <dt>悬念/转折</dt><dd>{chapter.outline.suspenseLevel}/10 · {chapter.outline.twistLevel}/10</dd>
          <dt>伏笔操作</dt><dd>{chapter.outline.foreshadowing || '无'}</dd>
          <dt>梗概</dt><dd>{chapter.outline.summary}</dd>
        </dl>
      </div>

      {chapter.written && (
        <ChapterQualityPanel projectId={id!} chapterNumber={chapter.number} />
      )}

      {editing ? (
        <div className="card">
          <h2>编辑正文</h2>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            style={{ width: '100%', minHeight: '400px', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.9, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}
          />
          <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
            <button className="btn" onClick={() => { setEditing(false); setEditContent(chapter.content ?? ''); }}>取消</button>
          </div>
        </div>
      ) : chapter.content ? (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12, gap: 8 }}>
            <button
              className="btn"
              onClick={() => navigate(`/projects/${id}/chapters/${chapter.number}/correction`)}
              title="根据历史评估经验，对本章做针对性局部修正"
            >🔧 按经验修正</button>
            <button className="btn" onClick={() => setEditing(true)}>✏️ 编辑</button>
          </div>
          <div className="chapter-content">{chapter.content}</div>
        </div>
      ) : (
        <div className="empty">本章尚未生成。用 CLI 生成：<code>pnpm write -- chapter {id} --number {chapter.number}</code></div>
      )}

      <div className="chapter-nav">
        {chapter.hasPrev ? (
          <Link to={`/projects/${id}/chapters/${chapter.number - 1}`}>← 第 {chapter.number - 1} 章</Link>
        ) : <span />}
        {chapter.hasNext ? (
          <Link to={`/projects/${id}/chapters/${chapter.number + 1}`}>第 {chapter.number + 1} 章 →</Link>
        ) : <span />}
      </div>
    </div>
  );
}
