import { useState, useEffect, useRef, useCallback } from 'react';

export interface ProgressEvent {
  step: string;
  msg: string;
  ts?: number;
  event?: 'done' | 'error' | 'paused' | 'cancelled';
  result?: unknown;
  error?: string;
}

export type JobProgressStatus = 'idle' | 'running' | 'done' | 'error' | 'paused' | 'cancelled';

const MAX_RETRIES = 3;

/**
 * 订阅 job 进度（SSE）。
 *
 * 暂停/取消是终态事件（job 已退出循环），收到后断开 SSE。
 * 网络抖动（onerror）走指数退避重连，避免静默卡死在 running。
 */
export function useJobProgress(jobId: string | null) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [status, setStatus] = useState<JobProgressStatus>('idle');
  const [result, setResult] = useState<unknown>(null);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    if (!jobId) { setStatus('idle'); return; }
    setEvents([]);
    setStatus('running');
    setResult(null);
    retryRef.current = 0;

    const connect = () => {
      const es = new EventSource(`/api/projects/jobs/${jobId}/events`);
      esRef.current = es;

      es.onmessage = (e) => {
        const data = JSON.parse(e.data) as ProgressEvent;
        if (data.event === 'done') {
          setStatus('done');
          setResult(data.result);
          retryRef.current = 0;
          close();
        } else if (data.event === 'error') {
          setStatus('error');
          setResult(data.error);
          retryRef.current = 0;
          close();
        } else if (data.event === 'paused') {
          setStatus('paused');
          retryRef.current = 0;
          close();
        } else if (data.event === 'cancelled') {
          setStatus('cancelled');
          retryRef.current = 0;
          close();
        } else {
          setEvents((prev) => [...prev, data]);
        }
      };

      es.onerror = () => {
        // SSE 连接断开。若已是终态，不动；否则尝试重连（指数退避）。
        esRef.current?.close();
        esRef.current = null;
        if (retryRef.current >= MAX_RETRIES) {
          // 退避用尽：退回 polling（由调用方决定），这里维持上次 status
          return;
        }
        const delay = 500 * Math.pow(2, retryRef.current);
        retryRef.current += 1;
        retryTimer.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      close();
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [jobId, close]);

  return { events, status, result, close };
}
