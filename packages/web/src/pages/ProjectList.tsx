import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api/client.ts';

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProjects = () => {
    api<Project[]>('/projects')
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProjects();
    // 列表页轮询：让状态徽章（writing → completed）随写作进展更新。
    // 仅当页面可见时轮询，切走标签页暂停以省请求。
    pollRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') fetchProjects();
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  if (loading) return <div className="container loading">加载中...</div>;
  if (error) return <div className="container error">错误：{error}</div>;

  return (
    <div className="container">
      <div className="page-header">
        <h2>所有写作项目</h2>
        <Link to="/projects/new"><button className="btn btn-primary">✍️ 新建项目</button></Link>
      </div>
      {projects.length === 0 ? (
        <div className="empty">
          暂无项目。
          <Link to="/projects/new" style={{ marginLeft: 8 }}>新建项目 →</Link>
        </div>
      ) : (
        <div className="project-list">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="project-card">
                <h3>{p.title}</h3>
                <div className="meta">
                  <span>{p.genreProfile} · {p.targetAudience}</span>
                  <span className={`badge badge-${p.status}`}>{p.status}</span>
                  <span>{p.createdAt.slice(0, 10)}</span>
                </div>
                <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                  <span>主题：{p.premise.slice(0, 60)}{p.premise.length > 60 ? '…' : ''}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
