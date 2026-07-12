import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api/client.ts';

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Project[]>('/projects')
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="container loading">加载中...</div>;
  if (error) return <div className="container error">错误：{error}</div>;

  return (
    <div className="container">
      <div className="header">
        <h1>📚 写作项目</h1>
        <Link to="/projects/new"><button className="btn btn-primary">✍️ 新建项目</button></Link>
      </div>
      {projects.length === 0 ? (
        <div className="empty">暂无项目。用 CLI 创建：<code>pnpm write -- init ...</code></div>
      ) : (
        <div className="project-list">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="project-card">
                <h3>{p.title}</h3>
                <div className="meta">
                  <span>{p.genre} · {p.audience}</span>
                  <span className={`badge badge-${p.status}`}>{p.status}</span>
                  <span>{p.createdAt.slice(0, 10)}</span>
                </div>
                <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                  <span>主题：{p.topic.slice(0, 60)}{p.topic.length > 60 ? '…' : ''}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
