/**
 * 评估配置加载层（对齐设计文档 v2.2：profiles.yml + default.yml + engines.yml）
 *
 * 引擎配置（engines.yml）通过 @novel-eval/shared 的 loadEngineConfig 加载；
 * profile/gradeThresholds/weights 是评估专属，在此加载。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYaml, loadEngineConfig } from '@novel-eval/shared';
import type { EngineConfig } from '@novel-eval/shared';
import type { DimensionKey, ProfileConfig, GradeThresholds } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, 'config');
// shared 的 engines.yml 路径（packages/shared/config/engines.yml）
const SHARED_CONFIG_DIR = resolve(__dirname, '..', '..', 'shared', 'config');

export interface AppConfig {
  engine: EngineConfig;
  profile: ProfileConfig;
  gradeThresholds: GradeThresholds;
  profileName: string;
}

export function loadConfig(profileName = 'default'): AppConfig {
  // 引擎配置（shared）
  const { engine } = loadEngineConfig(SHARED_CONFIG_DIR);

  // profiles.yml（eval 专属）
  const profilesRaw = loadYaml<{ profiles: Record<string, ProfileConfig> }>(
    resolve(CONFIG_DIR, 'profiles.yml'),
  );
  const profile = profilesRaw.profiles[profileName];
  if (!profile) throw new Error(`profiles.yml 缺少 ${profileName} profile`);

  // default.yml（eval 专属）
  const defaultRaw = loadYaml<{
    gradeThresholds: GradeThresholds;
    weights: Record<DimensionKey, number>;
  }>(resolve(CONFIG_DIR, 'default.yml'));

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
