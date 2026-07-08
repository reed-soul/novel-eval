/**
 * 配置加载层（对齐设计文档 v2.2：engines.yml / profiles.yml / default.yml）
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import type { EngineConfig, ProfileConfig, GradeThresholds, DimensionKey } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, '..', 'config');

export interface AppConfig {
  engine: EngineConfig;
  profile: ProfileConfig;
  gradeThresholds: GradeThresholds;
  profileName: string;
}

export function loadConfig(profileName = 'default'): AppConfig {
  // engines.yml：{ default: "bigmodel", bigmodel: {...}, claude-code: {...} }
  const enginesRaw = yaml.load(readFileSync(resolve(CONFIG_DIR, 'engines.yml'), 'utf-8')) as Record<string, unknown>;
  const defaultEngineName = enginesRaw.default as string;
  const engine = enginesRaw[defaultEngineName] as EngineConfig;
  if (!engine) throw new Error(`engines.yml 缺少 ${defaultEngineName} 配置`);

  // profiles.yml
  const profilesRaw = yaml.load(readFileSync(resolve(CONFIG_DIR, 'profiles.yml'), 'utf-8')) as {
    profiles: Record<string, ProfileConfig>;
  };
  const profile = profilesRaw.profiles[profileName];
  if (!profile) throw new Error(`profiles.yml 缺少 ${profileName} profile`);

  // default.yml
  const defaultRaw = yaml.load(readFileSync(resolve(CONFIG_DIR, 'default.yml'), 'utf-8')) as {
    gradeThresholds: GradeThresholds;
    weights: Record<DimensionKey, number>;
  };

  return {
    engine,
    profile,
    gradeThresholds: defaultRaw.gradeThresholds,
    profileName,
  };
}

/** 总分 → 等级（查表，>= 阈值）*/
export function lookupGrade(score: number, thresholds: GradeThresholds): string {
  if (score >= thresholds.S) return 'S';
  if (score >= thresholds.A) return 'A';
  if (score >= thresholds.B) return 'B';
  if (score >= thresholds.C) return 'C';
  return 'D';
}

/** 维度分 × 权重 → 总分 */
export function computeOverall(
  dimensions: Record<DimensionKey, { score: number }>,
  weights: Record<DimensionKey, number>,
): number {
  let total = 0;
  for (const key of Object.keys(weights) as DimensionKey[]) {
    total += (dimensions[key]?.score ?? 0) * weights[key];
  }
  return Math.round(total);
}
