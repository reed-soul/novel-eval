import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api, apiPost, type Project, type ChapterListItem,
  type JobInfo, getActiveJob, pauseJob, resumeJob, cancelJob,
} from '../api/client.ts';
import { ProgressPanel } from '../components/ProgressPanel.tsx';
import { QualityPanel } from '../components/QualityPanel.tsx';
import { PlanningApproval } from '../components/PlanningApproval.tsx';
import { StaleImpactPanel } from '../components/StaleImpactPanel.tsx';
import { RevisionTaskInbox } from '../components/RevisionTaskInbox.tsx';

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
  const [outlineChapters, setOutlineChapters] = useState(60);
  const [wordCount, setWordCount] = useState(2800);
  const [useGate, setUseGate] = useState(true);
  const [maxRevise, setMaxRevise] = useState(1);
  const [maxCostRmb, setMaxCostRmb] = useState('');
  const [planningApproved, setPlanningApproved] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'merge-txt' | 'merge-md' | 'zip-txt'>('merge-txt');
  const [includeMeta, setIncludeMeta] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = () => {
    setExporting(true);
    try {
      const url = `/api/projects/${id}/export?format=${exportFormat}&includeMeta=${includeMeta}`;
      const link = document.createElement('a');
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setShowExportModal(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

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

  const configuredMaxCost = () => {
    if (maxCostRmb.trim() === '') return null;
    const value = Number(maxCostRmb);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const confirmBudget = (label: string) => {
    const maxCost = configuredMaxCost();
    if (maxCost === null) return true;
    return window.confirm(`${label}将启动。当前预算上限为 ¥${maxCost.toFixed(2)}，请确认继续。`);
  };

  const startBible = async () => {
    if (!confirmBudget('Bible 生成')) return;
    const data = await apiPost<{ jobId: string }>(`/projects/${id}/bible/generate`);
    if (data.jobId) { setJobId(data.jobId); setActiveJob({ id: data.jobId, type: 'bible', projectId: id!, status: 'running' }); }
  };

  const startOutline = async () => {
    if (!confirmBudget('蓝图生成')) return;
    const chapters = Number.isFinite(outlineChapters) && outlineChapters > 0 ? outlineChapters : 60;
    const data = await apiPost<{ jobId: string }>(`/projects/${id}/outline/generate`, { chapters });
    if (data.jobId) { setJobId(data.jobId); setActiveJob({ id: data.jobId, type: 'outline', projectId: id!, status: 'running' }); }
  };

  const startChapters = async () => {
    if (!confirmBudget('章节生成')) return;
    const maxCost = configuredMaxCost();
    const targetWords = Number.isFinite(wordCount) && wordCount > 0 ? wordCount : 2800;
    const revise = useGate
      ? (Number.isFinite(maxRevise) && maxRevise >= 0 ? maxRevise : 0)
      : 0;
    const data = await apiPost<{ jobId: string }>(`/projects/${id}/chapters/generate`, {
      from: genFrom,
      to: genTo,
      wordCount: targetWords,
      qualityGate: useGate,
      maxRevise: revise,
      ...(maxCost === null ? {} : { maxCostRmb: maxCost }),
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
  const chapterJobActive = jobActive && activeJob?.type === 'chapter';

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h2>{project.title}</h2>
          <div className="project-subheading">
            {project.genreProfile} · {project.targetAudience} · <span className={`badge badge-${project.status}`}>{project.status}</span>
          </div>
        </div>
        <Link to="/" className="back-link">← 返回列表</Link>
      </div>

      <div className="card">
        <h2>主题</h2>
        <p style={{ lineHeight: 1.7 }}>{project.premise}</p>
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
              {activeJob.type === 'chapter' && activeJob.status === 'running' && (
                <button className="btn" onClick={handlePause} title="当前章写完后停止">⏸ 暂停</button>
              )}
              {activeJob.type === 'chapter' && activeJob.status === 'paused' && (
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
          <label style={{ fontSize: 14 }}>
            蓝图章数
            <input
              type="number"
              min={1}
              value={outlineChapters}
              onChange={(e) => setOutlineChapters(parseInt(e.target.value, 10) || 1)}
              style={{ width: 72, marginLeft: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
            />
          </label>
          <button className="btn btn-primary" onClick={startOutline} disabled={!!jobActive}>
            📋 生成蓝图（{outlineChapters}章）
          </button>
          <label style={{ fontSize: 14 }}>
            预算上限 ¥
            <input
              type="number"
              min="0"
              step="0.01"
              value={maxCostRmb}
              onChange={(e) => setMaxCostRmb(e.target.value)}
              placeholder="可选"
              style={{ width: 90, marginLeft: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
            />
          </label>
        </div>
        {planningApproved ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14 }}>生成章节：</span>
            <input type="number" value={genFrom} onChange={(e) => setGenFrom(parseInt(e.target.value) || 1)} style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
            <span>到</span>
            <input type="number" value={genTo} onChange={(e) => setGenTo(parseInt(e.target.value) || 1)} style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
            <label style={{ fontSize: 14 }}>
              目标字数
              <input
                type="number"
                min={1}
                value={wordCount}
                onChange={(e) => setWordCount(parseInt(e.target.value, 10) || 1)}
                style={{ width: 80, marginLeft: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
              />
            </label>
            <label style={{ fontSize: 14 }}>
              <input type="checkbox" checked={useGate} onChange={(e) => setUseGate(e.target.checked)} /> 质量门槛
            </label>
            {useGate && (
              <label style={{ fontSize: 14 }}>
                最大改写
                <input
                  type="number"
                  min={0}
                  value={maxRevise}
                  onChange={(e) => setMaxRevise(parseInt(e.target.value, 10) || 0)}
                  style={{ width: 60, marginLeft: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
              </label>
            )}
            <button className="btn btn-primary" onClick={startChapters} disabled={!!jobActive}>✍️ 生成</button>
          </div>
        ) : (
          <div className="empty" style={{ marginTop: 12 }}>批准 Bible 和蓝图后才能生成章节。</div>
        )}
      </div>

      {id && <PlanningApproval projectId={id} onApprovedChange={setPlanningApproved} />}

      {id && <StaleImpactPanel projectId={id} onRebuilt={reload} />}

      {jobId && (
        <ProgressPanel
          jobId={jobId}
          onDone={reload}
          onPause={chapterJobActive ? handlePause : undefined}
          onResume={chapterJobActive ? handleResume : undefined}
          onCancel={jobActive ? handleCancel : undefined}
        />
      )}

      {id && <RevisionTaskInbox projectId={id} />}

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
        <h2>设定与输出</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link to={`/projects/${id}/state`} className="btn btn-primary">查看 Bible 与叙事状态 →</Link>
          <button className="btn btn-primary" onClick={() => setShowExportModal(true)}>📤 导出小说 →</button>
        </div>
      </div>

      {id && (
        <div className="card">
          <h2>质量分析 <Link to={`/projects/${id}/dashboard`} className="btn" style={{ fontSize: 13, marginLeft: 8 }}>📊 打开评估仪表盘 →</Link></h2>
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

      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>导出小说: 《{project.title}》</h3>
              <button className="modal-close" onClick={() => setShowExportModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>选择导出格式 (Format)</label>
                <div className="radio-group">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="format"
                      value="merge-txt"
                      checked={exportFormat === 'merge-txt'}
                      onChange={() => setExportFormat('merge-txt')}
                    />
                    合并为一个文本文件 (.txt) — 适合自读/备份
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="format"
                      value="merge-md"
                      checked={exportFormat === 'merge-md'}
                      onChange={() => setExportFormat('merge-md')}
                    />
                    合并为一个 Markdown 文件 (.md) — 适合编辑排版
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="format"
                      value="zip-txt"
                      checked={exportFormat === 'zip-txt'}
                      onChange={() => setExportFormat('zip-txt')}
                    />
                    分章导出为压缩包 (.zip) — 方便发布到番茄/起点等平台
                  </label>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 20 }}>
                <label>附加选项 (Options)</label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeMeta}
                    onChange={(e) => setIncludeMeta(e.target.checked)}
                  />
                  在正文前附带每章大纲 (Chapter Outline)
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowExportModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
                {exporting ? '正在导出...' : '确认导出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
