import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Project, type ChapterListItem } from '../api/client.ts';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api<Project>(`/projects/${id}`),
      api<{ chapters: ChapterListItem[] }>(`/projects/${id}/chapters`),
    ])
      .then(([p, c]) => { setProject(p); setChapters(c.chapters); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="container loading">加载中...</div>;
  if (error) return <div className="container error">错误：{error}</div>;
  if (!project) return <div className="container empty">项目不存在</div>;

  const writtenCount = chapters.filter((c) => c.written).length;
  const progress = chapters.length > 0 ? (writtenCount / chapters.length) * 100 : 0;

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>{project.title}</h1>
          <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
            {project.genre} · {project.audience} · <span className={`badge badge-${project.status}`}>{project.status}</span>
          </div>
        </div>
        <Link to="/">← 返回列表</Link>
      </div>

      <div className="card">
        <h2>主题</h2>
        <p style={{ lineHeight: 1.7 }}>{project.topic}</p>
      </div>

      {chapters.length > 0 && (
        <div className="card">
          <h2>章节进度（{writtenCount}/{chapters.length}）</h2>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          <div className="chapter-grid">
            {chapters.map((c) => (
              <Link key={c.number} to={`/projects/${id}/chapters/${c.number}`} style={{ textDecoration: 'none' }}>
                <div className={`chapter-cell ${c.written ? 'written' : 'pending'} act-${c.act}`} title={`${c.title} · ${c.written ? c.wordCount + '字' : '未写'}`}>
                  {c.number}
                </div>
              </Link>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--green)', borderRadius: 3, marginRight: 4 }} />已写
            <span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--border)', borderRadius: 3, margin: '0 4px 0 12px' }} />未写
            <span style={{ marginLeft: 16 }}>左色条：蓝=第一幕 / 橙=第二幕 / 红=第三幕</span>
          </div>
        </div>
      )}

      <div className="card">
        <h2>设定与状态</h2>
        <Link to={`/projects/${id}/state`} className="btn btn-primary">查看 Bible 与叙事状态 →</Link>
      </div>

      {project.lastChapter && (
        <div className="card">
          <h2>最新章节</h2>
          <Link to={`/projects/${id}/chapters/${project.lastChapter.number}`}>
            第 {project.lastChapter.number} 章《{project.lastChapter.title}》— {project.lastChapter.wordCount} 字 →
          </Link>
        </div>
      )}
    </div>
  );
}
