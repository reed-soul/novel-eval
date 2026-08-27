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
import type { DimensionScore } from './types.ts';

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

// ─── 平台专属细则与投稿红线 ───────────────────────────────────────

export interface PlatformRedLine {
  dimension: DimensionKey;
  min: number;
}

export interface PlatformConfig {
  name: string;
  displayName: string;
  rubric: string;
  redLines: PlatformRedLine[];
}

export interface PlatformGateCheck {
  dimension: DimensionKey;
  min: number;
  actual: number;
  passed: boolean;
}

export interface PlatformGate {
  platform: string;
  displayName: string;
  /** block=有红线维度未达标，不建议以当前状态投稿；pass=红线全过 */
  verdict: 'pass' | 'block';
  checks: PlatformGateCheck[];
  reasons: string[];
  /** 全八维最低维（与红线无关的常驻提示，UI 用） */
  lowestDimension: { dimension: DimensionKey; score: number } | null;
}

export const PLATFORM_NAMES = ['general', 'yanxuan', 'fanqie', 'douban'] as const;
export type PlatformName = (typeof PLATFORM_NAMES)[number];

export function loadPlatform(name = 'general'): PlatformConfig {
  const key = (name ?? '').trim() || 'general';
  const raw = loadYaml<{
    platforms: Record<string, { displayName?: string; rubric?: string; redLines?: PlatformRedLine[] }>;
  }>(resolve(CONFIG_DIR, 'platforms.yml'));
  const entry = raw.platforms[key];
  if (!entry) {
    throw new Error(`未知平台 "${key}"（可用：${PLATFORM_NAMES.join(' / ')}）`);
  }
  return {
    name: key,
    displayName: entry.displayName ?? key,
    rubric: (entry.rubric ?? '').trim(),
    redLines: Array.isArray(entry.redLines) ? entry.redLines : [],
  };
}

/** 按平台红线计算投稿门（森铁教训：marketPotential 15 章最低维 68-78 被总分淹没） */
export function computePlatformGate(
  platform: PlatformConfig,
  dimensions: Record<DimensionKey, DimensionScore>,
): PlatformGate {
  const checks: PlatformGateCheck[] = platform.redLines.map((line) => {
    const actual = dimensions[line.dimension]?.score ?? 0;
    return { dimension: line.dimension, min: line.min, actual, passed: actual >= line.min };
  });
  const failed = checks.filter((c) => !c.passed);
  const reasons = failed.map(
    (c) => `${c.dimension} ${c.actual} 分低于 ${platform.displayName} 投稿红线 ${c.min}`,
  );

  let lowest: { dimension: DimensionKey; score: number } | null = null;
  for (const [dimension, value] of Object.entries(dimensions)) {
    const score = value?.score;
    if (typeof score === 'number' && (lowest === null || score < lowest.score)) {
      lowest = { dimension: dimension as DimensionKey, score };
    }
  }

  return {
    platform: platform.name,
    displayName: platform.displayName,
    verdict: failed.length > 0 ? 'block' : 'pass',
    checks,
    reasons,
    lowestDimension: lowest,
  };
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
