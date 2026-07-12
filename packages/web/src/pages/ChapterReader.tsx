import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type ChapterDetail } from '../api/client.ts';

export function ChapterReader() {
  const { id, n } = useParams<{ id: string; n: string }>();
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id || !n) return;
    setLoading(true);
    api<ChapterDetail>(`/projects/${id}/chapters/${n}`)
      .then(setChapter)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, n]);

  if (loading) return <div className="container loading">加载中...</div>;
  if (error) return <div className="container error">错误：{error}</div>;
  if (!chapter) return <div className="container empty">章节不存在</div>;

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>第 {chapter.number} 章《{chapter.title}》</h1>
          <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
            {chapter.wordCount} 字 · {chapter.written ? '✓ 已写' : '✗ 未写'}
          </div>
        </div>
        <Link to={`/projects/${id}`}>← 返回项目</Link>
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

      {chapter.content ? (
        <div className="card">
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
