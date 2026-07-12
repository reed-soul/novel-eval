import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ProgressPanel } from '../components/ProgressPanel.tsx';

export function NewProject() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', genre: '', audience: '', topic: '' });
  const [jobId, setJobId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const submit = async (generate: boolean) => {
    setError('');
    if (!form.title || !form.genre || !form.audience || !form.topic) {
      setError('请填写所有字段');
      return;
    }
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, generate }),
    });
    const data = await res.json();
    if (data.error) { setError(data.error); return; }
    setProjectId(data.project.id);
    if (data.jobId) setJobId(data.jobId);
    else navigate(`/projects/${data.project.id}`);
  };

  return (
    <div className="container">
      <div className="header">
        <h1>✍️ 新建项目</h1>
        <Link to="/">← 返回列表</Link>
      </div>

      <div className="card">
        <div style={{ display: 'grid', gap: 12 }}>
          <input className="input" placeholder="书名" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="input" placeholder="类型（如 科幻/悬疑/玄幻）" value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} />
          <input className="input" placeholder="目标受众（如 青年男性）" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
          <textarea className="input" placeholder="核心创意/主题（一句话描述你想写的故事）" rows={3} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
        </div>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={() => submit(true)}>创建 + 生成 Bible</button>
          <button className="btn" onClick={() => submit(false)}>仅创建项目</button>
        </div>
      </div>

      {jobId && (
        <>
          <ProgressPanel jobId={jobId} onDone={() => projectId && navigate(`/projects/${projectId}`)} />
          {projectId && (
            <div className="card">
              <Link to={`/projects/${projectId}`}>查看项目详情 →</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
