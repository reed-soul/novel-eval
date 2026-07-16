import { resolveWriterApiUrl } from '@novel-eval/shared';

function serverUrl(): string {
  return resolveWriterApiUrl(process.env);
}

export async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl()}/api/config`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startApiJob(endpoint: string, body: unknown): Promise<string> {
  const res = await fetch(`${serverUrl()}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown API error' })) as { error?: string };
    throw new Error(err.error || `HTTP error ${res.status}`);
  }
  const data = await res.json() as { jobId: string };
  return data.jobId;
}

export async function requestApiPause(jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl()}/api/projects/jobs/${jobId}/pause`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function streamJobEvents(jobId: string): Promise<void> {
  const res = await fetch(`${serverUrl()}/api/projects/jobs/${jobId}/events`);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to stream events: ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Handle CLI Ctrl+C gracefully by requesting a Pause on the Hono server
  let pauseRequested = false;
  const handleInt = async () => {
    if (pauseRequested) {
      console.log('\n强制退出中...');
      process.exit(1);
    }
    pauseRequested = true;
    console.log('\n[CLI] 正在向 Web 服务端请求暂停当前任务（在下一章边界生效）... 再按一次 Ctrl+C 强制退出。');
    await requestApiPause(jobId);
  };
  process.on('SIGINT', handleInt);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          try {
            const evt = JSON.parse(dataStr);
            if (evt.event === 'done') {
              console.log(`\n✓ 任务执行成功`);
              return;
            } else if (evt.event === 'error') {
              console.error(`\n❌ 任务执行失败: ${evt.error}`);
              return;
            } else if (evt.event === 'paused') {
              console.log(`\n⏸️ 任务已成功暂停`);
              return;
            } else if (evt.event === 'cancelled') {
              console.log(`\n⏹️ 任务已取消`);
              return;
            } else if (evt.msg) {
              console.log(`  [${evt.step}] ${evt.msg}`);
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  } finally {
    process.off('SIGINT', handleInt);
  }
}
