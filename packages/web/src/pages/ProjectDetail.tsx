import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Project, type ChapterListItem } from '../api/client.ts';
import { ProgressPanel } from '../components/ProgressPanel.tsx';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [genFrom, setGenFrom] = useState(1);
  const [genTo, setGenTo] = useState(5);
  const [useGate, setUseGate] = useState(true);

  const reload = () => {
    if (!id) return;
    Promise.all([
      api<Project>(`/projects/${id}`),
      api<{ chapters: ChapterListItem[] }>(`/projects/${id}/chapters`),
    ])
      .then(([p, c]) => { setProject(p); setChapters(c.chapters); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [id]);

  const startBible = async () => {
    const res = await fetch(`/api/projects/${id}/bible/generate`, { method: 'POST' });
    const data = await res.json();
    if (data.jobId) setJobId(data.jobId);
  };

  const startOutline = async () => {
    const res = await fetch(`/api/projects/${id}/outline/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapters: 12 }),
    });
    const data = await res.json();
    if (data.jobId) setJobId(data.jobId);
  };

  const startChapters = async () => {
    const res = await fetch(`/api/projects/${id}/chapters/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: genFrom, to: genTo, qualityGate: useGate, maxRevise: 1 }),
    });
    const data = await res.json();
    if (data.jobId) setJobId(data.jobId);
  };

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

      {/* 生成操作 */}
      <div className="card">
        <h2>生成操作</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={startBible}>📖 生成 Bible</button>
          <button className="btn btn-primary" onClick={startOutline}>📋 生成蓝图（12章）</button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>生成章节：</span>
          <input type="number" value={genFrom} onChange={(e) => setGenFrom(parseInt(e.target.value) || 1)} style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
          <span>到</span>
          <input type="number" value={genTo} onChange={(e) => setGenTo(parseInt(e.target.value) || 1)} style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
          <label style={{ fontSize: 14 }}>
            <input type="checkbox" checked={useGate} onChange={(e) => setUseGate(e.target.checked)} /> 质量门槛
          </label>
          <button className="btn btn-primary" onClick={startChapters}>✍️ 生成</button>
        </div>
      </div>

      {jobId && <ProgressPanel jobId={jobId} onDone={reload} />}

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
