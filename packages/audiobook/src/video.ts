/**
 * 视频渲染 v2：段级缓存增量管线（方案与实测依据见 research/render-deep-dive/PLAN.md）
 *
 * 架构：L1 预放大素材（render-assets.ts）→ L2 段级缓存渲染（本文件）→
 * L3 concat -c copy 秒级组装（assemble.ts）。
 * 段 = closed GOP（任意段边界可无损拼接）+ 1440p24 + 亮度平面直混雪花；
 * 标准桶时长取雪花周期整数倍（锁相：段缓存键与全局时间解耦，切点粒子连续）。
 *
 * 安全约束：spawn 走数组参数（shell:false，见 ffmpeg.ts 封装）；-stream_loop -1
 * 必须与输出 -t 成对出现（实测不配会无限写盘）；路径参数入口内联校验。
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ffmpeg, ffprobeDurationMs } from './ffmpeg.ts';
import { ensureBigImage, prepareSnow, promote } from './render-assets.ts';
import { assembleEpisodeVideo } from './assemble.ts';

const REPO_ROOT = process.cwd();

export const VIDEO_WIDTH = 2560;
export const VIDEO_HEIGHT = 1440;
export const VIDEO_FPS = 24;

/** 缓推参数：24fps 下每帧 zoom 增量与上限（进入段缓存键） */
const ZOOM_RATE = 0.000025;
const ZOOM_MAX = 1.06;
/** 运动预设指纹（改 ZOOM_* 时必须同步改，作废旧段缓存） */
const MOTION_PRESET = 'kb1';

const X264_SEG_PARAMS = [
  '-preset', 'medium', '-crf', '18',
  '-g', String(VIDEO_FPS), '-keyint_min', String(VIDEO_FPS),
  '-sc_threshold', '0', '-flags', '+cgop',
] as const;
/** 编码参数指纹（由实际参数派生，进段缓存键——改 X264_SEG_PARAMS 自动作废旧缓存） */
const ENCODER_FINGERPRINT = X264_SEG_PARAMS.join('_');

interface Slot { durS: number }

/**
 * 槽位规划：标准桶 = 不超过 maxSlotS 的雪花周期最大整数倍（锁相：所有切点都落在
 * 周期整数倍上，段缓存可全局复用），尾部余数单独成段；总帧数向上取整对齐帧栅格，
 * 保证视频 ≥ 音频时长（-shortest 以音频收尾，杜绝切掉最后一个字）。
 */
export function planSlots(
  durS: number,
  snowPeriodS: number | null,
  maxSlotS = 25,
  minTailS = 4,
): Slot[] {
  if (durS <= 0) throw new Error('planSlots: 时长必须为正');
  const frames = Math.ceil(durS * VIDEO_FPS);
  const total = frames / VIDEO_FPS;
  let std = snowPeriodS && snowPeriodS > 0
    ? Math.floor((maxSlotS + 1e-6) / snowPeriodS) * snowPeriodS
    : maxSlotS;
  if (std < 1) std = maxSlotS;
  let nStd = Math.floor((total - minTailS) / std);
  if (nStd < 0) nStd = 0;
  let tail = Number((total - nStd * std).toFixed(3));
  while (tail > 0 && tail < minTailS && nStd > 0) {
    nStd -= 1;
    tail = Number((tail + std).toFixed(3));
  }
  const slots: Slot[] = Array.from({ length: nStd }, () => ({ durS: Number(std.toFixed(3)) }));
  if (tail > 0.01) slots.push({ durS: tail });
  if (slots.length === 0) slots.push({ durS: total });
  return slots;
}

/** 段分配：场景图轮换；相邻同图合并为一段连续缓推（避免切点处 zoom 归零跳变） */
export interface PlannedSegment { img: string; durS: number }
export function assignSegments(slots: Slot[], covers: string[]): PlannedSegment[] {
  if (covers.length === 0) throw new Error('assignSegments: 需要至少一张场景图');
  const out: PlannedSegment[] = [];
  slots.forEach((s, i) => {
    const img = covers[i % covers.length];
    const last = out[out.length - 1];
    if (last && last.img === img) last.durS = Number((last.durS + s.durS).toFixed(3));
    else out.push({ img, durS: s.durS });
  });
  return out;
}

export interface RenderOpts {
  covers: string[];
  audio: string;
  out: string;
  /** 段/L1 缓存根目录（建议 <outRoot>/.cache，跨集复用）；由 cli 入口 safePath 净化 */
  cacheRoot: string;
  snow?: string;
  snowOpacity?: number;
  subs?: string;
}

/** 段渲染 ffmpeg 参数（纯函数，便于测试；含 -stream_loop 与 -t 强制成对约束；末位为输出路径占位） */
export function buildSegmentArgs(o: {
  big: string; durS: number; snow?: string; snowOffsetS?: number; opacity: number;
}): string[] {
  const args: string[] = [
    '-framerate', String(VIDEO_FPS), '-loop', '1', '-t', o.durS.toFixed(3), '-i', o.big,
  ];
  let graph =
    '[0:v]zoompan=z=\'min(1+' + ZOOM_RATE + '*on,' + ZOOM_MAX + ')\':d=1:' +
    "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=" + VIDEO_WIDTH + 'x' + VIDEO_HEIGHT + ':fps=' + VIDEO_FPS + '[bg]';
  if (o.snow) {
    args.push('-stream_loop', '-1', '-i', o.snow);
    // 雪花相位：trim 按时间轴裁（-ss 在 stream_loop 下的二次循环会回到文件头，相位断裂）
    const off = Number((o.snowOffsetS ?? 0).toFixed(3));
    const pre = off > 0 ? 'trim=start=' + off.toFixed(3) + ',setpts=PTS-STARTPTS,' : '';
    graph +=
      ';[1:v]fps=' + VIDEO_FPS + ',' + pre + 'format=yuv420p[snow]' +
      // 亮度平面直混：白雪花只需加亮度，色度平面透传底图（免 gbrp 往返，杜绝紫雪）。
      // 注意：ffmpeg 7.1 实证（分平面 PSNR u/v≈62dB）——只设 c0_* 时其余平面透传底图；
      // 切勿按文档直觉补 c1_opacity=0/c2_opacity=0，实测那会把色度替换成雪的灰色（128/128）。
      // 行为由 tests/e2e/render.e2e.test.ts 的色度回归用例锁定
      ';[bg][snow]blend=c0_mode=screen:c0_opacity=' + o.opacity.toFixed(2) + ',format=yuv420p[vout]';
  } else {
    graph += ';[bg]format=yuv420p[vout]';
  }
  return [
    ...args,
    '-filter_complex', graph,
    '-map', '[vout]',
    '-t', o.durS.toFixed(3), '-r', String(VIDEO_FPS), // 与 -stream_loop 成对的输出时限
    '-c:v', 'libx264', ...X264_SEG_PARAMS, '-pix_fmt', 'yuv420p', '-an',
  ];
}

/** L2 段渲染（带缓存命中）：返回段文件绝对路径与是否命中缓存 */
export async function renderSegmentCached(o: {
  img: string; coversDir: string; segDir: string; durS: number; offsetS: number;
  snowRes?: string; snowHash: string; opacity: number;
}, ffmpegRun: (args: string[]) => Promise<void>): Promise<{ file: string; cached: boolean }> {
  const root = REPO_ROOT + sep;
  const segDir = resolve(REPO_ROOT, o.segDir);
  if (!segDir.startsWith(root) || segDir.includes('..')) throw new Error('路径越界（仅允许仓库内）：' + o.segDir);
  const { big, imgHash } = await ensureBigImage(o.img, o.coversDir);
  const key = createHash('sha256')
    .update([imgHash, MOTION_PRESET, o.durS.toFixed(3), VIDEO_FPS, VIDEO_WIDTH + 'x' + VIDEO_HEIGHT,
      o.snowHash, o.opacity.toFixed(2), o.offsetS.toFixed(3), ENCODER_FINGERPRINT].join('|'))
    .digest('hex').slice(0, 20);
  const segStem = join(segDir, key);
  const segFile = segStem + '.mp4';
  if (existsSync(segFile)) return { file: segFile, cached: true };
  const segTmp = segStem + '.tmp.mp4';
  await ffmpegRun([...buildSegmentArgs({ big, durS: o.durS, snow: o.snowRes, snowOffsetS: o.offsetS, opacity: o.opacity }), segTmp]);
  await promote(segTmp, segFile, o.durS);
  return { file: segFile, cached: false };
}

/**
 * 整集视频渲染：段级缓存 + concat 无损组装。
 * 换图只重渲受影响段；换 TTS/字幕零重渲（重新组装秒级）。
 */
export async function renderChapterVideo(opts: RenderOpts): Promise<void> {
  if (opts.covers.length === 0) throw new Error('renderChapterVideo 需要至少一张场景图');
  const opacity = clampOpacity(opts.snowOpacity ?? Number(process.env.AUDIOBOOK_SNOW_OPACITY ?? 0.35));
  const segDir = join(opts.cacheRoot, 'segments');
  const coversDir = join(opts.cacheRoot, 'covers2x');
  await mkdir(segDir, { recursive: true });
  await mkdir(coversDir, { recursive: true });

  // 断点续渲：清理上次中断留下的段临时文件
  for (const f of await readdir(segDir)) {
    if (f.endsWith('.tmp.mp4')) await rm(join(segDir, f), { force: true });
  }

  const snow = opts.snow ? await prepareSnow(opts.snow) : undefined;
  const durS = (await ffprobeDurationMs(resolve(REPO_ROOT, opts.audio))) / 1000;
  const segs = assignSegments(planSlots(durS, snow?.periodS ?? null), opts.covers);

  const t0 = Date.now();
  let hits = 0;
  const files: string[] = [];
  let startS = 0;
  for (const seg of segs) {
    const r = await renderSegmentCached({
      img: seg.img, coversDir, segDir, durS: seg.durS,
      offsetS: snow ? Number((startS % snow.periodS).toFixed(3)) : 0,
      snowRes: snow?.res, snowHash: snow?.hash ?? 'none', opacity,
    }, ffmpeg);
    if (r.cached) hits += 1;
    files.push(r.file);
    startS = Number((startS + seg.durS).toFixed(3));
  }

  await assembleEpisodeVideo({ files, segDir, cacheRoot: opts.cacheRoot, audio: opts.audio, subs: opts.subs, out: opts.out });
  console.log(
    '    段缓存 ' + hits + '/' + segs.length + ' 命中｜渲染 ' + (((Date.now() - t0) / 1000).toFixed(0)) + 's' +
    '｜组装 ' + VIDEO_WIDTH + 'x' + VIDEO_HEIGHT + '@' + VIDEO_FPS
  );
}

function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return 0.35;
  return Math.min(0.6, Math.max(0.1, v));
}
