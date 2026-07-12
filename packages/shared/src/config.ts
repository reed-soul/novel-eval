/**
 * 配置加载层 — 共享部分（引擎配置）
 *
 * eval 的 profile/gradeThresholds/weights 留在 eval 包（loadEvalConfig）。
 * 这里只提供通用的 YAML 读取 + 引擎配置加载。
 *
 * engines.yml 结构：
 *   default: <引擎名>
 *   <引擎名>:
 *     provider: bigmodel | deepseek   （决定用哪个 adapter）
 *     baseUrl: ...
 *     model: ...
 *     maxBudgetRmb: ...
 *     perChapterMaxBudgetRmb: ...
 *
 * loadEngineConfig 返回默认引擎 + 全部引擎表（供 Web 端切换）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import type { EngineConfig } from './types.ts';

/** 通用 YAML 读取 */
export function loadYaml<T>(filePath: string): T {
  return yaml.load(readFileSync(filePath, 'utf-8')) as T;
}

interface EnginesYaml {
  default: string;
  [engineName: string]: unknown;
}

/**
 * 加载引擎配置（读 engines.yml）。
 * @param configDir 含 engines.yml 的目录
 * @returns 当前（默认）引擎配置 + 引擎名 + 全部引擎表
 */
export function loadEngineConfig(configDir: string): {
  engine: EngineConfig;
  engineName: string;
  engines: Record<string, EngineConfig>;
} {
  const raw = loadYaml<EnginesYaml>(resolve(configDir, 'engines.yml'));
  const defaultEngineName = raw.default as string;

  // 解析全部引擎（排除 'default' 这个元字段）
  const engines: Record<string, EngineConfig> = {};
  for (const [name, val] of Object.entries(raw)) {
    if (name === 'default') continue;
    const cfg = val as EngineConfig;
    if (cfg && cfg.baseUrl && cfg.model) {
      engines[name] = cfg;
    }
  }

  const engine = engines[defaultEngineName];
  if (!engine) throw new Error(`engines.yml 缺少 ${defaultEngineName} 配置`);
  return { engine, engineName: defaultEngineName, engines };
}
