/**
 * Project revision-task inbox: list, open correction, mark done/dismissed.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listRevisionTasks,
  openCorrection,
  setRevisionTaskStatus,
  type RevisionTask,
  type RevisionTaskStatus,
} from '../api/client.ts';

export interface RevisionTaskInboxProps {
  projectId: string;
}

export function RevisionTaskInbox({ projectId }: RevisionTaskInboxProps) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<RevisionTask[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([
      listRevisionTasks(projectId, 'open'),
      listRevisionTasks(projectId, 'in_progress'),
    ])
      .then(([open, inProgress]) => {
        setTasks([...inProgress.tasks, ...open.tasks]);
        setError('');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onOpen = async (task: RevisionTask) => {
    setBusyId(task.id);
    try {
      const opened = await openCorrection(projectId, task.id);
      navigate(opened.path);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onStatus = async (task: RevisionTask, status: RevisionTaskStatus) => {
    setBusyId(task.id);
    try {
      await setRevisionTaskStatus(projectId, task.id, status);
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (error && tasks.length === 0) {
    return (
      <div className="card">
        <h2>修订任务</h2>
        <div className="error" style={{ marginTop: 8 }}>{error}</div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="card">
        <h2>修订任务</h2>
        <p className="empty" style={{ marginTop: 8 }}>
          暂无待办。完成「质量评估」后可在报告页导入建议。
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>修订任务（{tasks.length}）</h2>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {tasks.map((task) => {
          const canOpen = task.scope === 'chapter'
            || (task.relatedChapters.length === 1)
            || Boolean(task.excerptRef?.chapterId);
          return (
            <div
              key={task.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6, fontSize: 12 }}>
                <span className="badge">{task.status}</span>
                <span className="badge">{task.scope}</span>
                {task.dimension && <span className="badge">{task.dimension}</span>}
              </div>
              <p style={{ margin: '0 0 10px', lineHeight: 1.6, fontSize: 14 }}>{task.content}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {canOpen && (
                  <button
                    className="btn btn-primary"
                    disabled={busyId === task.id}
                    onClick={() => void onOpen(task)}
                  >
                    打开修正
                  </button>
                )}
                {!canOpen && (
                  <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
                    跨章任务请拆分或手动选章
                  </span>
                )}
                <button
                  className="btn"
                  disabled={busyId === task.id}
                  onClick={() => void onStatus(task, 'done')}
                >
                  完成
                </button>
                <button
                  className="btn"
                  disabled={busyId === task.id}
                  onClick={() => void onStatus(task, 'dismissed')}
                >
                  忽略
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
