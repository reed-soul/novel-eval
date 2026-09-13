/**
 * 写作目标平台。独立模块，避免 project.ts ↔ project-repository 循环依赖。
 */
export const TARGET_PLATFORMS = ['general', 'fanqie', 'yanxuan', 'douban'] as const;
export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

export function parseTargetPlatform(raw: string): TargetPlatform {
  const value = raw.trim();
  if ((TARGET_PLATFORMS as readonly string[]).includes(value)) {
    return value as TargetPlatform;
  }
  throw new Error(`未知平台 "${raw}"（可用：${TARGET_PLATFORMS.join(' / ')}）`);
}
