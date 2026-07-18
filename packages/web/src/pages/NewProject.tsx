import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ProgressPanel } from '../components/ProgressPanel.tsx';

type Mode = 'bible' | 'create' | 'auto';

export function NewProject() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', genre: '', audience: '', topic: '' });
  const [chapters, setChapters] = useState(60);
  const [wordCount, setWordCount] = useState(2800);
  const [useGate, setUseGate] = useState(true);
  const [maxRevise, setMaxRevise] = useState(1);
  const [approvePlanning, setApprovePlanning] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (mode: Mode) => {
    setError('');
    if (!form.title || !form.genre || !form.audience || !form.topic) {
      setError('请填写所有字段');
      return;
    }
    if (mode === 'auto' && !approvePlanning) {
      setError('全自动生成需要勾选「批准规划」（bible + 蓝图生成后自动批准并写章）');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'auto') {
        const res = await fetch('/api/projects/auto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            chapters,
            wordCount,
            qualityGate: useGate,
            maxRevise: useGate ? maxRevise : 0,
            approvePlanning: true,
          }),
        });
        const data: unknown = await res.json();
        if (!res.ok || typeof data !== 'object' || data === null || !('project' in data)) {
          const message = typeof data === 'object' && data !== null && 'error' in data
            ? String((data as { error: unknown }).error)
            : `请求失败（${res.status}）`;
          setError(message);
          return;
        }
        const payload = data as { project: { id: string }; jobId?: string; error?: string };
        if (payload.error) {
          setError(payload.error);
          return;
        }
        setProjectId(payload.project.id);
        if (payload.jobId) setJobId(payload.jobId);
        else navigate(`/projects/${payload.project.id}`);
        return;
      }

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, generate: mode === 'bible' }),
      });
      const data: unknown = await res.json();
      if (typeof data !== 'object' || data === null) {
        setError('创建失败');
        return;
      }
      const payload = data as { project?: { id: string }; jobId?: string; error?: string };
      if (payload.error) {
        setError(payload.error);
        return;
      }
      if (!payload.project) {
        setError('创建失败');
        return;
      }
      setProjectId(payload.project.id);
      if (payload.jobId) setJobId(payload.jobId);
      else navigate(`/projects/${payload.project.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="page-header">
        <h2>✍️ 新建写作项目</h2>
        <Link to="/" className="back-link">← 返回列表</Link>
      </div>

      <div className="card">
        <div style={{ display: 'grid', gap: 12 }}>
          <input className="input" placeholder="书名" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={!!jobId} />
          <input className="input" placeholder="类型（如 科幻/悬疑/玄幻）" value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} disabled={!!jobId} />
          <input className="input" placeholder="目标受众（如 青年男性）" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} disabled={!!jobId} />
          <textarea className="input" placeholder="核心创意/主题（一句话描述你想写的故事）" rows={3} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} disabled={!!jobId} />
        </div>

        <div style={{
          marginTop: 16,
          paddingTop: 16,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
        }}>
          <strong style={{ fontSize: 14 }}>全自动参数</strong>
          <label style={{ fontSize: 14 }}>
            章数
            <input
              type="number"
              min={1}
              value={chapters}
              disabled={!!jobId}
              onChange={(e) => setChapters(parseInt(e.target.value, 10) || 1)}
              style={{ width: 72, marginLeft: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
            />
          </label>
          <label style={{ fontSize: 14 }}>
            每章字数
            <input
              type="number"
              min={1}
              value={wordCount}
              disabled={!!jobId}
              onChange={(e) => setWordCount(parseInt(e.target.value, 10) || 1)}
              style={{ width: 80, marginLeft: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
            />
          </label>
          <label style={{ fontSize: 14 }}>
            <input
              type="checkbox"
              checked={useGate}
              disabled={!!jobId}
              onChange={(e) => setUseGate(e.target.checked)}
            />{' '}
            质量门槛
          </label>
          {useGate && (
            <label style={{ fontSize: 14 }}>
              最大改写
              <input
                type="number"
                min={0}
                value={maxRevise}
                disabled={!!jobId}
                onChange={(e) => setMaxRevise(parseInt(e.target.value, 10) || 0)}
                style={{ width: 60, marginLeft: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
              />
            </label>
          )}
          <label style={{ fontSize: 14 }}>
            <input
              type="checkbox"
              checked={approvePlanning}
              disabled={!!jobId}
              onChange={(e) => setApprovePlanning(e.target.checked)}
            />{' '}
            批准规划（auto 必需）
          </label>
        </div>

        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            disabled={busy || !!jobId}
            onClick={() => submit('auto')}
            title="bible → 批准 → 蓝图 → 批准 → 写完全部章节"
          >
            🚀 全自动生成
          </button>
          <button className="btn btn-primary" disabled={busy || !!jobId} onClick={() => submit('bible')}>
            创建 + 生成 Bible
          </button>
          <button className="btn" disabled={busy || !!jobId} onClick={() => submit('create')}>
            仅创建项目
          </button>
        </div>
        <p style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
          全自动会在服务端连续跑完规划与正文（可暂停/取消章节阶段），进度出现在下方与顶栏。
        </p>
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
