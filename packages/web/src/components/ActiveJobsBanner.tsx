/**
 * Global banner: show running writer jobs + eval tasks with live progress.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  listActiveEvalJobs,
  listActiveJobs,
  type ActiveEvalJobListItem,
  type ActiveJobListItem,
} from '../api/client.ts';
import { useJobProgress } from '../hooks/useJobProgress.ts';

const POLL_MS = 4000;

function jobTypeLabel(type: string): string {
  if (type === 'chapter') return '写章';
  if (type === 'bible') return 'Bible';
  if (type === 'outline') return '蓝图';
  if (type === 'correction') return '修正';
  if (type === 'rebuild') return '状态重建';
  if (type === 'edit') return '编辑';
  if (type === 'auto') return '全自动';
  return type;
}

function WriterJobProgressLine({ job }: { job: ActiveJobListItem }) {
  const { events, status } = useJobProgress(
    job.status === 'running' || job.status === 'paused' ? job.id : null,
  );
  const latest = events.length > 0 ? events[events.length - 1] : null;
  const chapterHint = (job.type === 'chapter' || job.type === 'auto') && job.toChapter
    ? ` · 第 ${(job.lastChapter ?? (job.fromChapter ?? 1) - 1) + 1}/${job.toChapter} 章`
    : '';

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      alignItems: 'baseline',
      fontSize: 13,
      lineHeight: 1.5,
    }}>
      <Link to={`/projects/${job.projectId}`} style={{ fontWeight: 600 }}>
        {job.projectTitle}
      </Link>
      <span style={{ color: 'var(--muted)' }}>
        {jobTypeLabel(job.type)}
        {job.status === 'paused' ? '（已暂停）' : ''}
        {chapterHint}
      </span>
      {latest && (
        <span style={{ color: 'var(--text)', flex: '1 1 200px', minWidth: 0 }}>
          <span style={{ color: 'var(--muted)' }}>[{latest.step}]</span>{' '}
          {latest.msg}
        </span>
      )}
      {!latest && status === 'running' && (
        <span style={{ color: 'var(--muted)' }}>等待进度…</span>
      )}
    </div>
  );
}

function EvalJobProgressLine({ job }: { job: ActiveEvalJobListItem }) {
  const label = job.title?.trim() || `评估 ${job.taskId.slice(0, 8)}`;
  const href = job.projectId
    ? `/eval/${job.taskId}?projectId=${encodeURIComponent(job.projectId)}`
    : `/eval/${job.taskId}`;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      alignItems: 'baseline',
      fontSize: 13,
      lineHeight: 1.5,
    }}>
      <Link to={href} style={{ fontWeight: 600 }}>{label}</Link>
      <span style={{ color: 'var(--muted)' }}>全书评估</span>
      {job.latestMessage ? (
        <span style={{ color: 'var(--text)', flex: '1 1 200px', minWidth: 0 }}>
          {job.latestMessage}
        </span>
      ) : (
        <span style={{ color: 'var(--muted)' }}>等待进度…</span>
      )}
      {job.projectId && (
        <Link to={`/projects/${job.projectId}`} style={{ color: 'var(--muted)', fontSize: 12 }}>
          项目 →
        </Link>
      )}
    </div>
  );
}

export function ActiveJobsBanner() {
  const location = useLocation();
  const [writerJobs, setWriterJobs] = useState<ActiveJobListItem[]>([]);
  const [evalJobs, setEvalJobs] = useState<ActiveEvalJobListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      Promise.all([
        listActiveJobs().catch(() => ({ jobs: [] as ActiveJobListItem[] })),
        listActiveEvalJobs().catch(() => ({ jobs: [] as ActiveEvalJobListItem[] })),
      ]).then(([writer, evalRes]) => {
        if (cancelled) return;
        setWriterJobs(writer.jobs);
        setEvalJobs(evalRes.jobs);
      });
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [location.pathname]);

  const total = writerJobs.length + evalJobs.length;
  if (total === 0) return null;

  return (
    <div
      className="active-jobs-banner"
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--accent-soft, color-mix(in srgb, var(--accent, #3d8bfd) 12%, transparent))',
        padding: '10px 20px',
      }}
    >
      <div className="header-container" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
          运行中的任务（{total}）
        </div>
        {writerJobs.map((job) => (
          <WriterJobProgressLine key={job.id} job={job} />
        ))}
        {evalJobs.map((job) => (
          <EvalJobProgressLine key={job.taskId} job={job} />
        ))}
      </div>
    </div>
  );
}
