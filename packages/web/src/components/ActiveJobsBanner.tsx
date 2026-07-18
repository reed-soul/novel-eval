/**
 * Global banner: show running/paused writer jobs across projects with live SSE lines.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { listActiveJobs, type ActiveJobListItem } from '../api/client.ts';
import { useJobProgress } from '../hooks/useJobProgress.ts';

const POLL_MS = 4000;

function jobTypeLabel(type: string): string {
  if (type === 'chapter') return '写章';
  if (type === 'bible') return 'Bible';
  if (type === 'outline') return '蓝图';
  if (type === 'correction') return '修正';
  if (type === 'rebuild') return '状态重建';
  if (type === 'edit') return '编辑';
  return type;
}

function JobProgressLine({ job }: { job: ActiveJobListItem }) {
  const { events, status } = useJobProgress(
    job.status === 'running' || job.status === 'paused' ? job.id : null,
  );
  const latest = events.length > 0 ? events[events.length - 1] : null;
  const chapterHint = job.type === 'chapter' && job.toChapter
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

export function ActiveJobsBanner() {
  const location = useLocation();
  const [jobs, setJobs] = useState<ActiveJobListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      listActiveJobs()
        .then((res) => {
          if (!cancelled) setJobs(res.jobs);
        })
        .catch(() => {
          if (!cancelled) setJobs([]);
        });
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [location.pathname]);

  if (jobs.length === 0) return null;

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
          运行中的任务（{jobs.length}）
        </div>
        {jobs.map((job) => (
          <JobProgressLine key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
