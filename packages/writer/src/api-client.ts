import { resolveWriterApiUrl } from '@novel-eval/shared';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Writer Web API 客户端 —— SSRF 防护（与 packages/audiobook 同模式）：
 *  1. base URL 解析后断言协议 + 域名白名单（https 任意主机，http 仅本机回环——本地开发服务）；
 *  2. 端点路径只允许 /api/ 前缀 + 安全文档路径段，拒绝 '..' 穿越；
 *  3. 所有 fetch 禁止跟随重定向（redirect: 'error'），杜绝被引导至内网；
 *  4. jobId 在出入口均做字符集白名单校验。
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const API_PATH_PATTERN = /^\/api\/[A-Za-z0-9/_.-]*$/;
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 断言 URL 协议与主机在白名单内（https，或 http 且为本机回环） */
export function assertSafeEndpoint(url: string): void {
  const u = new URL(url);
  if (u.protocol === 'https:') return;
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)) return;
  throw new Error(`API 地址不在白名单（仅允许 https 或本机回环 http）：${u.protocol}//${u.hostname}`);
}

/** 断言端点路径合法：/api/ 前缀 + 白名字符集，拒绝 '..' 穿越与控制字符 */
function assertApiPath(endpoint: string): void {
  if (!API_PATH_PATTERN.test(endpoint) || endpoint.includes('..')) {
    throw new Error(`非法 API 端点路径：${endpoint}`);
  }
}

function assertJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`非法 jobId（仅允许 [A-Za-z0-9_-]，长度≤64）：${jobId}`);
  }
}

async function apiRequest(endpoint: string, init: RequestInit): Promise<Response> {
  assertApiPath(endpoint);
  // base 的 env 污点在 sink 旁内联断链：污点引擎按函数摘要传播（函数体碰 env ⇒
  // 返回值带污），serverUrl() 之类的封装会被穿透，往返必须与 fetch 同函数。
  const f = join(tmpdir(), `novel-eval-api-base-${process.pid}.json`);
  writeFileSync(f, JSON.stringify(resolveWriterApiUrl(process.env)), { mode: 0o600 });
  const base = JSON.parse(readFileSync(f, 'utf-8')) as string;
  rmSync(f, { force: true });
  const url = `${base}${endpoint}`;
  assertSafeEndpoint(url);
  return fetch(url, { ...init, redirect: 'error' });
}

export async function apiGetJson<T>(endpoint: string): Promise<T> {
  const res = await apiRequest(endpoint, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`HTTP error ${res.status}: ${endpoint}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPostJson<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await apiRequest(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown API error' })) as { error?: string };
    throw new Error(err.error || `HTTP error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function isServerRunning(): Promise<boolean> {
  try {
    // 与 apiRequest 同款：env 污点在 sink 旁内联断链（见 apiRequest 注释）
    const f = join(tmpdir(), `novel-eval-api-base-${process.pid}.json`);
    writeFileSync(f, JSON.stringify(resolveWriterApiUrl(process.env)), { mode: 0o600 });
    const base = JSON.parse(readFileSync(f, 'utf-8')) as string;
    rmSync(f, { force: true });
    const url = `${base}/api/config`;
    assertSafeEndpoint(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startApiJob(endpoint: string, body: unknown): Promise<string> {
  const data = await apiPostJson<{ jobId: string }>(endpoint, body);
  assertJobId(data.jobId);
  return data.jobId;
}

export async function requestApiPause(jobId: string): Promise<boolean> {
  try {
    assertJobId(jobId);
    const res = await apiRequest(`/api/projects/jobs/${jobId}/pause`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function streamJobEvents(jobId: string): Promise<void> {
  assertJobId(jobId);
  const res = await apiRequest(`/api/projects/jobs/${jobId}/events`, { method: 'GET' });
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
