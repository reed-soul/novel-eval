/**
 * 渲染素材预处理：L1 预放大场景图 + 雪花母本转输出分辨率 + 临时产物原子转正。
 * 全部 spawn 走数组参数（shell:false）；文件名均为内容哈希/字面量拼接；
 * 每个函数入口对路径参数内联校验（resolve 后必须落在仓库根内）。
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { ffmpeg, ffprobeDurationMs } from './ffmpeg.ts';

const REPO_ROOT = process.cwd();

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/** 临时产物校验后原子转正：时长异常/损坏的半成品直接删除报错，不进缓存 */
export async function promote(tmp: string, fin: string, expectDurS?: number): Promise<void> {
  const gotMs = await ffprobeDurationMs(tmp);
  if (expectDurS !== undefined && Math.abs(gotMs / 1000 - expectDurS) > 0.2) {
    await rm(tmp, { force: true });
    throw new Error('产物时长异常（疑似半成品）：' + fin);
  }
  await rename(tmp, fin);
}

/** L1 预放大：场景图 → 5120×2880 PNG（内容哈希寻址，一次性缓存） */
export async function ensureBigImage(imgRaw: string, coversDirRaw: string): Promise<{ big: string; imgHash: string }> {
  const root = REPO_ROOT + sep;
  const img = resolve(REPO_ROOT, imgRaw);
  if (!img.startsWith(root) || img.includes('..')) throw new Error('路径越界（仅允许仓库内）：' + imgRaw);
  const coversDir = resolve(REPO_ROOT, coversDirRaw);
  if (!coversDir.startsWith(root) || coversDir.includes('..')) throw new Error('路径越界（仅允许仓库内）：' + coversDirRaw);

  const imgHash = (await sha256File(img)).slice(0, 16);
  const bigStem = join(coversDir, imgHash);
  const big = bigStem + '.png';
  if (!existsSync(big)) {
    await mkdir(coversDir, { recursive: true });
    await ffmpeg([
      '-i', img,
      '-vf', 'scale=5120:2880:flags=lanczos:force_original_aspect_ratio=increase,crop=5120:2880',
      '-frames:v', '1', bigStem + '.tmp.png',
    ]);
    await rename(bigStem + '.tmp.png', big);
  }
  return { big, imgHash };
}

/** 雪花母本预转输出分辨率（一次性；渲染期只做 fps 对齐）。返回宽幅版、周期秒数与内容哈希 */
export async function prepareSnow(snowRaw: string): Promise<{ res: string; periodS: number; hash: string }> {
  const root = REPO_ROOT + sep;
  const snowSrc = resolve(REPO_ROOT, snowRaw);
  if (!snowSrc.startsWith(root) || snowSrc.includes('..')) throw new Error('路径越界（仅允许仓库内）：' + snowRaw);

  // 派生文件按源内容哈希寻址：雪花母本重新生成时旧派生物自动失效（与 ensureBigImage 同款策略）
  const srcHash = (await sha256File(snowSrc)).slice(0, 12);
  const snowStem = join(dirname(snowSrc), basename(snowSrc, '.mp4') + '-' + srcHash + '-w2560');
  const wideName = snowStem + '.mp4';
  if (!wideName.startsWith(root)) throw new Error('雪花派生路径越界：' + wideName);
  if (!existsSync(wideName)) {
    await ffmpeg([
      '-i', snowSrc,
      '-vf', 'scale=2560:1440:flags=lanczos',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an',
      snowStem + '.tmp.mp4',
    ]);
    await rename(snowStem + '.tmp.mp4', wideName);
  }
  return { res: wideName, periodS: (await ffprobeDurationMs(wideName)) / 1000, hash: (await sha256File(wideName)).slice(0, 12) };
}
