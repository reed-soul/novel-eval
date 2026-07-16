import { useEffect } from 'react';
import { useJobProgress } from '../hooks/useJobProgress.ts';

export interface ProgressPanelProps {
  jobId: string | null;
  onDone?: (result: unknown) => void;
  onPause?: () => void;
  onResume?: (newJobId: string) => void;
  onCancel?: () => void;
}

export function ProgressPanel({ jobId, onDone, onPause, onResume, onCancel }: ProgressPanelProps) {
  const { events, status, result } = useJobProgress(jobId);

  useEffect(() => {
    if (status === 'completed' && onDone) {
      const timer = setTimeout(() => onDone(result), 100);
      return () => clearTimeout(timer);
    }
  }, [status, onDone, result]);

  if (!jobId) return null;

  return (
    <div className="card" style={{ position: 'sticky', top: 20, maxHeight: '60vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>
          进度{' '}
          {status === 'running' && '⏳ 运行中'}
          {status === 'paused' && '🟡 已暂停'}
          {status === 'cancelled' && '⚪ 已取消'}
          {status === 'completed' && '✅'}
          {status === 'failed' && '❌'}
        </h2>
        {/* 控制按钮：只在运行中显示暂停/取消；暂停态显示继续/取消 */}
        <div style={{ display: 'flex', gap: 8 }}>
          {status === 'running' && onPause && (
            <button className="btn" onClick={onPause} title="当前章写完后停止">⏸ 暂停</button>
          )}
          {status === 'paused' && onResume && (
            <button className="btn btn-primary" onClick={() => jobId && onResume(jobId)}>▶ 继续</button>
          )}
          {(status === 'running' || status === 'paused') && onCancel && (
            <button className="btn" onClick={onCancel} title="放弃当前任务">⏹ 取消</button>
          )}
        </div>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8, marginTop: 8 }}>
        {events.map((e, i) => (
          <div key={i}>
            <span style={{ color: 'var(--muted)' }}>[{e.step}]</span> {e.msg}
          </div>
        ))}
        {status === 'completed' && result != null && (
          <div style={{ color: 'var(--green)', marginTop: 8 }}>
            ✅ 完成：{JSON.stringify(result)}
          </div>
        )}
        {status === 'failed' && result != null && (
          <div style={{ color: 'var(--red)', marginTop: 8 }}>❌ 失败：{String(result)}</div>
        )}
        {status === 'running' && events.length === 0 && (
          <div style={{ color: 'var(--muted)' }}>等待开始...</div>
        )}
        {status === 'paused' && (
          <div style={{ color: 'var(--muted)', marginTop: 8 }}>
            任务已暂停，当前章节写完后保存。点「继续」从下一章恢复。
          </div>
        )}
      </div>
    </div>
  );
}
