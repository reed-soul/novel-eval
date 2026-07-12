import { useState, useEffect, useRef, useCallback } from 'react';

export interface ProgressEvent {
  step: string;
  msg: string;
  ts?: number;
  event?: 'done' | 'error';
  result?: unknown;
  error?: string;
}

export function useJobProgress(jobId: string | null) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<unknown>(null);
  const esRef = useRef<EventSource | null>(null);

  const close = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    if (!jobId) { setStatus('idle'); return; }
    setEvents([]);
    setStatus('running');
    setResult(null);

    const es = new EventSource(`/api/projects/jobs/${jobId}/events`);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as ProgressEvent;
      if (data.event === 'done') {
        setStatus('done');
        setResult(data.result);
        close();
      } else if (data.event === 'error') {
        setStatus('error');
        setResult(data.error);
        close();
      } else {
        setEvents((prev) => [...prev, data]);
      }
    };

    es.onerror = () => {
      // SSE 连接断开（非业务错误），不改变 status
      close();
    };

    return () => close();
  }, [jobId, close]);

  return { events, status, result, close };
}
