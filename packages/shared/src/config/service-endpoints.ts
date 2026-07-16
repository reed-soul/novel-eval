/**
 * 统一服务端口与 Writer API URL 解析。
 *
 * - 服务端用 resolveServicePort 决定 listen 端口（默认 4000）
 * - CLI / api-client 用 resolveWriterApiUrl（WRITER_API_URL 优先，否则按 PORT 拼 URL）
 */

export type ServiceEndpointEnv = {
  PORT?: string | undefined;
  WRITER_API_URL?: string | undefined;
};

const DEFAULT_PORT = 4000;

export function resolveServicePort(env: ServiceEndpointEnv): number {
  const raw = env.PORT;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_PORT;
}

export function resolveWriterApiUrl(env: ServiceEndpointEnv): string {
  const explicit = env.WRITER_API_URL;
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return explicit.trim().replace(/\/$/, '');
  }
  const port = resolveServicePort(env);
  return `http://127.0.0.1:${port}`;
}
