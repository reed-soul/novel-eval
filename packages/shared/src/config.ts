/**
 * 配置加载层 — 共享部分（引擎配置）
 *
 * eval 的 profile/gradeThresholds/weights 留在 eval 包（loadEvalConfig）。
 * 这里只提供通用的 YAML 读取 + 引擎配置加载。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import type { EngineConfig } from './types.ts';

/** 通用 YAML 读取 */
export function loadYaml<T>(filePath: string): T {
  return yaml.load(readFileSync(filePath, 'utf-8')) as T;
}

/**
 * 加载引擎配置（读 engines.yml）。
 * @param configDir 含 engines.yml 的目录
 */
export function loadEngineConfig(configDir: string): { engine: EngineConfig; engineName: string } {
  const raw = loadYaml<Record<string, unknown>>(resolve(configDir, 'engines.yml'));
  const defaultEngineName = raw.default as string;
  const engine = raw[defaultEngineName] as EngineConfig;
  if (!engine) throw new Error(`engines.yml 缺少 ${defaultEngineName} 配置`);
  return { engine, engineName: defaultEngineName };
}
