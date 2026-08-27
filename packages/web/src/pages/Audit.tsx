import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Project } from '../api/client.ts';

/** 与 eval 包 audit/types.ts 的 PlotAuditReport 对齐（前端本地视图类型） */
interface AuditHole {
  id: string;
  severity: 'P0' | 'P1' | 'P2';
  type: string;
  title: string;
  detail: string;
  suggestedFix: string;
  fixCost: 'surgical' | 'rewrite';
  source: string;
  evidenceChapterIds: string[];
  evidenceQuote: string;
}

interface AuditReport {
  schemaVersion: string;
  novel: { title: string; totalChapters: number; wordCount: number; storylines: string[] };
  graphStats: {
    events: number;
    edges: number;
    mainChainEvents: number;
    orphanEventIds: string[];
    edgesByType: Record<string, number>;
  };
  holes: AuditHole[];
  summary: { p0: number; p1: number; p2: number };
  coverage: { extractedChapters: number; totalChapters: number; failedChapterIds: string[] };
}

const SEVERITY_STYLE: Record<string, { badge: string; label: string }> = {
  P0: { badge: '#dc2626', label: 'P0 必修' },
  P1: { badge: '#d97706', label: 'P1 应修' },
  P2: { badge: 'var(--text-muted)', label: 'P2 参考' },
};

const TYPE_LABELS: Record<string, string> = {
  'causal-break': '因果断裂',
  'coincidence-driven': '巧合驱动',
  'orphan-plot': '孤悬情节',
  'timeline-contradiction': '时间线矛盾',
  'fact-contradiction': '事实矛盾',
  'missing-motive': '动机缺失',
  'missing-enablement': '使能缺失',
  'unfair-clue': '线索不公',
  'punishment-mismatch': '罪罚错配',
  'alternative-explanation': '替代解释未封堵',
  'hub-dependence': '单点依赖',
};

export function Audit() {
  const [searchParams] = useSearchParams();
  const [file, setFile] = useState<File | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(searchParams.get('projectId') ?? '');
  const [genre, setGenre] = useState<string>('悬疑');
  const [climaxChapter, setClimaxChapter] = useState<string>('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [report, setReport] = useState<AuditReport | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'P0' | 'P1' | 'P2'>('all');
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data: unknown) => setProjects(Array.isArray(data) ? data.filter(isProject) : []))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const handleUpload = async () => {
    if (!file && !selectedProjectId) {
      alert('请上传全本 txt/md，或选择一个现有项目');
      return;
    }

    setStatus('running');
    setLogs(['[系统] 正在准备审计任务...']);
    setReport(null);

    try {
      let uploadFile = file;
      if (!uploadFile && selectedProjectId) {
        setLogs((prev) => [...prev, `[系统] 正在打包项目 ${selectedProjectId} 的正文...`]);
        const res = await fetch(`/api/projects/${selectedProjectId}/export?format=txt`);
        if (!res.ok) throw new Error('打包失败');
        const blob = await res.blob();
        uploadFile = new File([blob], `${selectedProjectId}.txt`, { type: 'text/plain' });
      }

      const formData = new FormData();
      formData.append('file', uploadFile as Blob);
      if (genre.trim()) formData.append('genre', genre.trim());
      if (climaxChapter.trim() && Number.isInteger(Number(climaxChapter))) {
        formData.append('climaxChapter', climaxChapter.trim());
      }
      if (selectedProjectId) {
        formData.append('title', projects.find((p) => p.id === selectedProjectId)?.title ?? selectedProjectId);
      }

      const res = await fetch('/api/audit/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('上传失败');
      const data: unknown = await res.json();
      if (typeof (data as { taskId?: unknown })?.taskId !== 'string') throw new Error('缺少 taskId');
      setTaskId((data as { taskId: string }).taskId);
    } catch (err: unknown) {
      setStatus('failed');
      setLogs((prev) => [...prev, `[系统错误] ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  useEffect(() => {
    if (!taskId || status !== 'running') return;

    const eventSource = new EventSource(`/api/audit/${taskId}/stream`);

    eventSource.addEventListener('progress', (e) => {
      setLogs((prev) => [...prev, e.data]);
    });

    eventSource.addEventListener('done', () => {
      eventSource.close();
      setLogs((prev) => [...prev, '[系统] 审计完成，正在载入报告...']);
      fetch(`/api/audit/${taskId}/result`)
        .then((r) => {
          if (!r.ok) throw new Error('报告不存在');
          return r.json();
        })
        .then((data: AuditReport) => {
          setReport(data);
          setStatus('done');
        })
        .catch((err: unknown) => {
          setStatus('failed');
          setLogs((prev) => [...prev, `[系统错误] ${err instanceof Error ? err.message : String(err)}`]);
        });
    });

    eventSource.addEventListener('error', () => {
      eventSource.close();
      setStatus('failed');
      setLogs((prev) => [...prev, '[系统错误] 审计中断或失败']);
    });

    return () => eventSource.close();
  }, [taskId, status]);

  const visibleHoles = report
    ? report.holes.filter((h) => severityFilter === 'all' || h.severity === severityFilter)
    : [];

  const reset = () => {
    setStatus('idle');
    setTaskId(null);
    setReport(null);
    setLogs([]);
    setFile(null);
    setClimaxChapter('');
  };

  return (
    <div className="container">
      <div className="eval-title">剧情逻辑审计（推敲器）</div>
      <div className="eval-subtitle">
        五阶段审计：事件-因果抽取 → 跨章建链 → 图分析 → 公平清单/世情探针 → 对抗式红队。
        产出 11 类逻辑洞（P0 必修 / P1 应修 / P2 参考）。盐选拒稿「剧情逻辑经不起推敲」的专项体检。
      </div>

      {status === 'idle' && (
        <div className="card">
          <h2 style={{ marginBottom: 20 }}>新建审计任务</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            <div className="eval-form-grid">
              <div className="eval-form-group">
                <label>类型（注入公平/世情探针上下文）</label>
                <input type="text" className="input" value={genre} onChange={(e) => setGenre(e.target.value)} />
              </div>
              <div className="eval-form-group">
                <label>高潮章号（选填，缺省 = 最后一章）</label>
                <input
                  type="number" min={1} className="input" value={climaxChapter}
                  onChange={(e) => setClimaxChapter(e.target.value)} placeholder="如 14"
                />
              </div>
            </div>

            <div className="eval-form-group">
              <label>方式 A：上传全本 TXT / MD</label>
              <input
                type="file"
                accept=".txt,.md"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  if (e.target.files?.[0]) setSelectedProjectId('');
                }}
              />
            </div>

            <div className="eval-divider">OR</div>

            <div className="eval-form-group">
              <label>方式 B：选择已有项目（自动导出正文）</label>
              <select
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  if (e.target.value) setFile(null);
                }}
                className="input"
              >
                <option value="">-- 请选择项目 --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title} ({p.status})</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleUpload}
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 10, padding: 12 }}
              disabled={!file && !selectedProjectId}
            >
              🔍 开始剧情逻辑审计
            </button>
          </div>
        </div>
      )}

      {status === 'running' && (
        <div className="card">
          <h2>审计进度 ⏳</h2>
          <div ref={logsRef} style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8, marginTop: 8, maxHeight: '60vh', overflowY: 'auto' }}>
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div className="card">
          <h2>❌ 审计失败</h2>
          <div style={{ fontFamily: 'monospace', fontSize: 13, marginTop: 8 }}>
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 16 }} onClick={reset}>重新开始</button>
        </div>
      )}

      {status === 'done' && report && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <h2 style={{ margin: 0 }}>《{report.novel.title}》审计报告</h2>
            <button className="btn" onClick={reset}>再审一本</button>
          </div>

          <p className="project-subheading" style={{ marginTop: 10 }}>
            <span>{report.novel.totalChapters} 章 / {report.novel.wordCount?.toLocaleString()} 字</span>
            <span>故事线：{report.novel.storylines.join('、')}</span>
            <span>事件 {report.graphStats.events} / 边 {report.graphStats.edges} / 主因果链 {report.graphStats.mainChainEvents}</span>
            {report.coverage.extractedChapters < report.coverage.totalChapters && (
              <span style={{ color: '#d97706' }}>
                ⚠ 覆盖 {report.coverage.extractedChapters}/{report.coverage.totalChapters} 章
              </span>
            )}
          </p>

          <div style={{ display: 'flex', gap: 16, margin: '16px 0', fontSize: 15 }}>
            <span><strong style={{ color: '#dc2626' }}>P0 ×{report.summary.p0}</strong> 必修</span>
            <span><strong style={{ color: '#d97706' }}>P1 ×{report.summary.p1}</strong> 应修</span>
            <span><strong style={{ color: 'var(--text-muted)' }}>P2 ×{report.summary.p2}</strong> 参考</span>
          </div>

          <div style={{ marginBottom: 12 }}>
            {(['all', 'P0', 'P1', 'P2'] as const).map((sev) => (
              <button
                key={sev}
                className={`btn ${severityFilter === sev ? 'btn-primary' : ''}`}
                style={{ marginRight: 8, padding: '4px 12px', fontSize: 13 }}
                onClick={() => setSeverityFilter(sev)}
              >
                {sev === 'all' ? `全部 ${report.holes.length}` : `${SEVERITY_STYLE[sev].label}`}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {visibleHoles.map((hole) => (
              <div
                key={hole.id}
                style={{
                  border: '1px solid var(--border, #ddd)',
                  borderLeft: `4px solid ${SEVERITY_STYLE[hole.severity].badge}`,
                  borderRadius: 8,
                  padding: '12px 16px',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ color: SEVERITY_STYLE[hole.severity].badge }}>{hole.severity}</strong>
                  <span className="tag" style={{ fontSize: 12 }}>
                    {TYPE_LABELS[hole.type] ?? hole.type}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {hole.evidenceChapterIds.slice(0, 4).join(' , ') || '—'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    来源 {hole.source}
                    {hole.fixCost === 'rewrite' ? ' · 重写级' : ' · 手术级'}
                  </span>
                </div>
                <div style={{ fontWeight: 600, marginTop: 6 }}>{hole.title}</div>
                <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>{hole.detail}</div>
                {hole.suggestedFix && (
                  <div style={{ fontSize: 13, marginTop: 6, color: 'var(--text-muted)' }}>
                    修法建议：{hole.suggestedFix}
                  </div>
                )}
                {hole.evidenceQuote && (
                  <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    「{hole.evidenceQuote.slice(0, 120)}」
                  </div>
                )}
              </div>
            ))}
            {visibleHoles.length === 0 && (
              <p style={{ color: 'var(--text-muted)' }}>该级别下没有洞。</p>
            )}
          </div>

          <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            使用须知：推敲器是「找茬雷达」不是及格线——P0 计数存在运行间波动；判据是硬矛盾（时间/物理/去向类）修复后零复发。
            闪回章的时间线倒错与「线索后置揭示」类提示常为误报，需人工复核。
          </p>
        </div>
      )}
    </div>
  );
}

function isProject(value: unknown): value is Project {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'id' in value && 'title' in value && typeof (value as { id: unknown }).id === 'string';
}
