import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api, apiPost, type Project, type ChapterListItem,
  type JobInfo, getActiveJob, pauseJob, resumeJob, cancelJob,
} from '../api/client.ts';
import { ProgressPanel } from '../components/ProgressPanel.tsx';
import { QualityPanel } from '../components/QualityPanel.tsx';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<JobInfo | null>(null);
  const [genFrom, setGenFrom] = useState(1);
  const [genTo, setGenTo] = useState(5);
  const [useGate, setUseGate] = useState(true);

  const reload = () => {
    if (!id) return;
    Promise.all([
      api<Project>(`/projects/${id}`),
      api<{ chapters: ChapterListItem[] }>(`/projects/${id}/chapters`),
      getActiveJob(id),
    ])
      .then(([p, c, aj]) => {
        setProject(p); setChapters(c.chapters);
        setActiveJob(aj.job);
        // 若有活动 job 且当前没有追踪的 jobId，自动接上（刷新页面后重连）
        if (aj.job && !jobId) setJobId(aj.job.id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [id]);

  const startBible = async () => {
    const data = await apiPost<{ jobId: string }>(`/projects/${id}/bible/generate`);
    if (data.jobId) { setJobId(data.jobId); setActiveJob({ id: data.jobId, type: 'bible', projectId: id!, status: 'running' }); }
  };

  const startOutline = async () => {
    const data = await apiPost<{ jobId: string }>(`/projects/${id}/outline/generate`, { chapters: 12 });
    if (data.jobId) { setJobId(data.jobId); setActiveJob({ id: data.jobId, type: 'outline', projectId: id!, status: 'running' }); }
  };

  const startChapters = async () => {
    const data = await apiPost<{ jobId: string }>(`/projects/${id}/chapters/generate`, {
      from: genFrom, to: genTo, qualityGate: useGate, maxRevise: 1,
    });
    if (data.jobId) {
      setJobId(data.jobId);
      setActiveJob({ id: data.jobId, type: 'chapter', projectId: id!, status: 'running', fromChapter: genFrom, toChapter: genTo });
    }
  };

  const handlePause = async () => {
    if (!jobId) return;
    try { await pauseJob(jobId); } catch (e) { setError((e as Error).message); }
  };

  const handleResume = async (oldJobId: string) => {
    try {
      const data = await resumeJob(oldJobId);
      setJobId(data.jobId);
      setActiveJob({ id: data.jobId, type: 'chapter', projectId: id!, status: 'running' });
    } catch (e) { setError((e as Error).message); }
  };

  const handleCancel = async () => {
    if (!jobId) return;
    try {
      await cancelJob(jobId);
      setActiveJob(null);
    } catch (e) { setError((e as Error).message); }
  };

  if (loading) return <div className="container loading">加载中...</div>;
  if (error) return <div className="container error">错误：{error}</div>;
  if (!project) return <div className="container empty">项目不存在</div>;

  const writtenCount = chapters.filter((c) => c.written).length;
  const progress = chapters.length > 0 ? (writtenCount / chapters.length) * 100 : 0;
  const jobActive = activeJob && (activeJob.status === 'running' || activeJob.status === 'paused');

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

      {/* 任务状态条（运行中/已暂停）*/}
      {jobActive && activeJob && (
        <div className="card" style={{
          borderColor: activeJob.status === 'running' ? 'var(--green)' : 'var(--yellow, #d4a017)',
          background: activeJob.status === 'running' ? 'rgba(76,175,80,0.05)' : 'rgba(212,160,23,0.05)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14 }}>
              {activeJob.status === 'running' && '🟢 '}
              {activeJob.status === 'paused' && '🟡 '}
              {activeJob.type === 'chapter' && activeJob.toChapter
                ? `${activeJob.type === 'chapter' ? '写作' : activeJob.type}任务 · 进度：第 ${(activeJob.lastChapter ?? (activeJob.fromChapter ?? 1) - 1) + 1}/${activeJob.toChapter} 章`
                : `${activeJob.type} 任务进行中`}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {activeJob.status === 'running' && (
                <button className="btn" onClick={handlePause} title="当前章写完后停止">⏸ 暂停</button>
              )}
              {activeJob.status === 'paused' && (
                <button className="btn btn-primary" onClick={() => handleResume(activeJob.id)}>▶ 继续</button>
              )}
              <button className="btn" onClick={handleCancel} title="放弃当前任务">⏹ 取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 生成操作 */}
      <div className="card">
        <h2>生成操作</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={startBible} disabled={!!jobActive}>📖 生成 Bible</button>
          <button className="btn btn-primary" onClick={startOutline} disabled={!!jobActive}>📋 生成蓝图（12章）</button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>生成章节：</span>
          <input type="number" value={genFrom} onChange={(e) => setGenFrom(parseInt(e.target.value) || 1)} style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
          <span>到</span>
          <input type="number" value={genTo} onChange={(e) => setGenTo(parseInt(e.target.value) || 1)} style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
          <label style={{ fontSize: 14 }}>
            <input type="checkbox" checked={useGate} onChange={(e) => setUseGate(e.target.checked)} /> 质量门槛
          </label>
          <button className="btn btn-primary" onClick={startChapters} disabled={!!jobActive}>✍️ 生成</button>
        </div>
      </div>

      {jobId && (
        <ProgressPanel
          jobId={jobId}
          onDone={reload}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
        />
      )}

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

      {id && (
        <div className="card">
          <h2>质量分析</h2>
          <QualityPanel projectId={id} />
        </div>
      )}

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
