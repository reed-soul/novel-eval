import { useJobProgress } from '../hooks/useJobProgress.ts';

export function ProgressPanel({ jobId, onDone }: { jobId: string | null; onDone?: (result: unknown) => void }) {
  const { events, status, result } = useJobProgress(jobId);

  if (!jobId) return null;

  return (
    <div className="card" style={{ position: 'sticky', top: 20, maxHeight: '60vh', overflowY: 'auto' }}>
      <h2>进度 {status === 'running' && '⏳'} {status === 'done' && '✅'} {status === 'error' && '❌'}</h2>
      <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8 }}>
        {events.map((e, i) => (
          <div key={i}>
            <span style={{ color: 'var(--muted)' }}>[{e.step}]</span> {e.msg}
          </div>
        ))}
        {status === 'done' && result != null && (
          <div style={{ color: 'var(--green)', marginTop: 8 }}>
            ✅ 完成：{JSON.stringify(result)}
            {onDone && setTimeout(() => onDone(result), 100) && null}
          </div>
        )}
        {status === 'error' && result != null && (
          <div style={{ color: 'var(--red)', marginTop: 8 }}>❌ 失败：{String(result)}</div>
        )}
        {status === 'running' && events.length === 0 && (
          <div style={{ color: 'var(--muted)' }}>等待开始...</div>
        )}
      </div>
    </div>
  );
}
