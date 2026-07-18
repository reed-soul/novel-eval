import { useState, useEffect, useRef, useCallback } from 'react';

export interface ProgressEvent {
  seq?: number;
  step: string;
  msg: string;
  ts?: number;
  event?: 'completed' | 'failed' | 'paused' | 'cancelled' | 'done' | 'error';
  result?: unknown;
  error?: string;
}

export type JobProgressStatus = 'idle' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 1500;

interface JobStatusPayload {
  status?: string;
  result?: unknown;
  error?: string;
}

function isTerminalStatus(status: string): status is Exclude<JobProgressStatus, 'idle' | 'running'> {
  return status === 'completed'
    || status === 'failed'
    || status === 'paused'
    || status === 'cancelled';
}

function readDraftRevisionId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('draftRevisionId' in value)) {
    return undefined;
  }
  const id = (value as { draftRevisionId: unknown }).draftRevisionId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * 订阅 job 进度（SSE）。
 *
 * 暂停/取消是终态事件（job 已退出循环），收到后断开 SSE。
 * 网络抖动（onerror）走指数退避重连，并带上 last event id（?after=）。
 * 重连耗尽后轮询 GET /jobs/:id，避免永久卡在 running。
 */
export function useJobProgress(jobId: string | null) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [status, setStatus] = useState<JobProgressStatus>('idle');
  const [result, setResult] = useState<unknown>(null);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const statusRef = useRef<JobProgressStatus>('idle');

  const close = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!jobId) { setStatus('idle'); return; }
    setEvents([]);
    setStatus('running');
    setResult(null);
    retryRef.current = 0;
    lastEventIdRef.current = null;

    let cancelled = false;

    const applyTerminal = (next: Exclude<JobProgressStatus, 'idle' | 'running'>, payload?: unknown) => {
      setStatus(next);
      if (payload !== undefined) setResult(payload);
      retryRef.current = 0;
      close();
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };

    const pollJobStatus = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/projects/jobs/${jobId}`);
        if (!res.ok) {
          pollTimer.current = setTimeout(() => { void pollJobStatus(); }, POLL_INTERVAL_MS);
          return;
        }
        const data = await res.json() as JobStatusPayload;
        const remoteStatus = typeof data.status === 'string' ? data.status : '';
        if (isTerminalStatus(remoteStatus)) {
          let payload: unknown = data.result;
          if (remoteStatus === 'failed') {
            const draftFromResult = readDraftRevisionId(data.result);
            payload = draftFromResult
              ? {
                  message: typeof data.error === 'string' ? data.error : 'job failed',
                  draftRevisionId: draftFromResult,
                }
              : data.error;
          }
          applyTerminal(remoteStatus, payload);
          return;
        }
        if (remoteStatus === 'running' || remoteStatus === 'queued') {
          pollTimer.current = setTimeout(() => { void pollJobStatus(); }, POLL_INTERVAL_MS);
          return;
        }
        // Unknown status — keep polling briefly rather than spinning forever as "running"
        pollTimer.current = setTimeout(() => { void pollJobStatus(); }, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) {
          pollTimer.current = setTimeout(() => { void pollJobStatus(); }, POLL_INTERVAL_MS);
        }
      }
    };

    const connect = () => {
      if (cancelled) return;
      const after = lastEventIdRef.current;
      const url = after
        ? `/api/projects/jobs/${jobId}/events?after=${encodeURIComponent(after)}`
        : `/api/projects/jobs/${jobId}/events`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (e) => {
        if (e.lastEventId) {
          lastEventIdRef.current = e.lastEventId;
        }
        const data = JSON.parse(e.data) as ProgressEvent;
        if (typeof data.seq === 'number') {
          lastEventIdRef.current = String(data.seq);
        }
        if (data.event === 'completed' || data.event === 'done') {
          applyTerminal('completed', data.result);
        } else if (data.event === 'failed' || data.event === 'error') {
          applyTerminal('failed', data.error);
        } else if (data.event === 'paused') {
          applyTerminal('paused');
        } else if (data.event === 'cancelled') {
          applyTerminal('cancelled');
        } else {
          setEvents((prev) => [...prev, data]);
        }
      };

      es.onerror = () => {
        esRef.current?.close();
        esRef.current = null;
        if (cancelled) return;
        if (statusRef.current !== 'running') return;
        if (retryRef.current >= MAX_RETRIES) {
          void pollJobStatus();
          return;
        }
        const delay = 500 * Math.pow(2, retryRef.current);
        retryRef.current += 1;
        retryTimer.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      close();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [jobId, close]);

  return { events, status, result, close };
}
