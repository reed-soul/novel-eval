/**
 * 环境变量加载器
 * 从 ~/.claude/settings.json 读取 Claude Code 的智谱配置注入 process.env。
 * 便于本地开发；生产/分发走用户自己的环境变量。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function loadEnv(): void {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    const env = (JSON.parse(raw).env ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string' && !process.env[k]) {
        process.env[k] = v;
      }
    }
  } catch {
    // settings.json 不存在或不可读，忽略（依赖用户已设置的环境变量）
  }
}
