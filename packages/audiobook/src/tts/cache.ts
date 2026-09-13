/**
 * 段级缓存内容指纹（M1 内容哈希键控，--clean 的长期解）：
 * 旧缓存只按「文件存在」命中，正文/发音修订后重跑会原样复读旧音频；
 * 现按 影响合成结果的全部输入（引擎/类型/音色/语速/音调/正文）算指纹，
 * 任一变化 → 指纹失配 → 自动重合成。
 *
 * 迁移策略：无索引条目的旧缓存文件信任一次（与旧行为等价，零重合成成本），
 * 之后任何输入变化都会失配；真实重合成后写入真实指纹。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Segment } from '../annotate.ts';

const INDEX_FILE = '.cache-index.json';

export type CacheIndex = Record<string, string>;

/** 影响合成输出的输入指纹；gapAfterMs 只作用于装配不进音频，不参与 */
export function segmentFingerprint(engine: string, seg: Segment): string {
  const raw = `${engine}|${seg.kind}|${seg.voice}|${seg.rate}|${seg.pitch}|${seg.text}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function loadCacheIndex(outDir: string): CacheIndex {
  try {
    const parsed = JSON.parse(readFileSync(join(outDir, INDEX_FILE), 'utf-8')) as CacheIndex;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // 首跑/损坏：按无索引处理
  }
}

export async function saveCacheIndex(outDir: string, idx: CacheIndex): Promise<void> {
  await writeFile(join(outDir, INDEX_FILE), JSON.stringify(idx, null, 1), 'utf-8');
}

/**
 * 命中判定（纯函数）：
 * - 文件不在 → miss
 * - 索引无条目（旧缓存首遇）→ 信任命中，不写指纹（保持 legacy 态直到首次真实重合成）
 * - 指纹匹配 → hit；失配 → miss（改字/换音色/换引擎都会走到这里）
 */
export function cacheHit(fileOk: boolean, knownFp: string | undefined, fp: string): boolean {
  if (!fileOk) return false;
  if (knownFp === undefined) return true;
  return knownFp === fp;
}
