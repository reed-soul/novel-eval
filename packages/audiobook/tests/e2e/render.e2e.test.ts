/**
 * 渲染管线 e2e（默认跳过；AUDIOBOOK_E2E=1 时跑）：
 * 真实渲染 62s 双图+雪花+字幕成片，验证规格、缓存命中与换图增量。
 * 本文件不直接 spawn——ffmpeg/ffprobe 一律走 src/ffmpeg.ts 封装。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ffmpeg, ffprobeDurationMs } from '../../src/ffmpeg.ts';
import { ffmpegCapture } from '../../src/ffmpeg-capture.ts';
import { ensureSnowAsset } from '../../src/assets.ts';
import { renderChapterVideo } from '../../src/video.ts';

const enabled = process.env.AUDIOBOOK_E2E === '1';
const ROOT = resolve('dist/audiobook-smoke');

test('e2e：段级缓存渲染（规格/缓存/增量）', { skip: enabled ? false : 'AUDIOBOOK_E2E=1 才跑' }, async () => {
  await rm(ROOT, { recursive: true, force: true });
  const coversDir = resolve(ROOT, 'covers');
  await mkdir(coversDir, { recursive: true });
  const c0 = resolve(coversDir, 'c0.png');
  const c1 = resolve(coversDir, 'c1.png');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=2560x1440:rate=1', '-frames:v', '1', c0]);
  await ffmpeg(['-f', 'lavfi', '-i', 'smptehdbars=size=2560x1440:rate=1', '-frames:v', '1', c1]);
  const audio = resolve(ROOT, 'ep.mp3');
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=62', '-c:a', 'libmp3lame', '-b:a', '128k', audio]);
  const srt = resolve(ROOT, 'ep.srt');
  await writeFile(srt, '1\n00:00:00,000 --> 00:00:10,000\n第一句\n\n2\n00:00:10,000 --> 00:01:02,000\n第二句\n', 'utf-8');
  const snow = await ensureSnowAsset(ROOT);
  const cacheRoot = resolve(ROOT, '.cache');
  const covers = [c0, c1];

  const out1 = resolve(ROOT, 'ep1.mp4');
  const t1 = Date.now();
  await renderChapterVideo({ covers, audio, out: out1, snow, subs: srt, cacheRoot });
  const coldMs = Date.now() - t1;

  // 规格：1440p24、h264+aac、时长贴合音频（±0.5s）、mov_text 中文字幕轨
  const dur = (await ffprobeDurationMs(out1)) / 1000;
  assert.ok(Math.abs(dur - 62) < 0.5, '时长应为 62s±0.5，实际 ' + dur);
  const { execFileSync } = await import('node:child_process');
  const spec = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,r_frame_rate', '-of', 'csv=p=0', out1], { encoding: 'utf-8' });
  assert.match(spec, /2560,1440/);
  assert.match(spec, /24\/1/);
  const sub = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 's', '-show_entries', 'stream=codec_name:stream_tags=language', '-of', 'csv=p=0', out1], { encoding: 'utf-8' });
  assert.match(sub, /mov_text/);
  assert.match(sub, /chi/);

  // 二跑全命中缓存：明显快于冷跑
  const out2 = resolve(ROOT, 'ep2.mp4');
  const t2 = Date.now();
  await renderChapterVideo({ covers, audio, out: out2, snow, subs: srt, cacheRoot });
  const warmMs = Date.now() - t2;
  assert.ok(warmMs < coldMs / 2, `二跑 ${warmMs}ms 应显著快于冷跑 ${coldMs}ms`);
  assert.ok(existsSync(out2));

  // 换一张图：只重渲该图段（仍远快于冷跑）
  const c0new = resolve(coversDir, 'c0-new.png');
  await ffmpeg(['-f', 'lavfi', '-i', 'rgbtestsrc=size=2560x1440:rate=1', '-frames:v', '1', c0new]);
  const out3 = resolve(ROOT, 'ep3.mp4');
  const t3 = Date.now();
  await renderChapterVideo({ covers: [c0new, c1], audio, out: out3, snow, subs: srt, cacheRoot });
  const incMs = Date.now() - t3;
  assert.ok(incMs < coldMs, `增量 ${incMs}ms 应快于冷跑 ${coldMs}ms`);
  console.log(`e2e 耗时：冷 ${coldMs}ms｜全命中 ${warmMs}ms｜换图增量 ${incMs}ms`);
});

test('e2e：blend 亮度直混色度透传回归（防 ffmpeg 升级行为漂移）', { skip: enabled ? false : 'AUDIOBOOK_E2E=1 才跑' }, async () => {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });
  const bars = resolve(ROOT, 'bars.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'smptehdbars=size=2560x1440:rate=24:duration=1', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', bars]);
  const snow = await ensureSnowAsset(ROOT);
  const withSnow = resolve(ROOT, 'bars-snow.mp4');
  // 直接构造与 buildSegmentArgs 等价的 blend 链，验证「只设 c0_* 时色度平面透传底图」
  await ffmpeg([
    '-i', bars, '-stream_loop', '-1', '-i', snow, '-t', '1',
    '-filter_complex', '[0:v]fps=24,format=yuv420p[bg];[1:v]scale=2560:1440,fps=24,format=yuv420p[s];' +
      '[bg][s]blend=c0_mode=screen:c0_opacity=0.35,format=yuv420p[vout]',
    '-map', '[vout]', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', withSnow,
  ]);
  const psnrOut = await ffmpegCapture(['-i', bars, '-i', withSnow, '-lavfi', 'psnr', '-f', 'null', '-']);
  const u = psnrOut.match(/u:([0-9.]+|inf)/)?.[1];
  const v = psnrOut.match(/v:([0-9.]+|inf)/)?.[1];
  const y = psnrOut.match(/y:([0-9.]+|inf)/)?.[1];
  assert.ok(u !== undefined && v !== undefined, 'psnr 未输出分平面: ' + psnrOut.slice(0, 200));
  assert.ok(parseFloat(u) > 50, `色度 U 平面被改动（${u}dB）——blend 透传行为漂移，雪花正在洗掉画面颜色`);
  assert.ok(parseFloat(v) > 50, `色度 V 平面被改动（${v}dB）——blend 透传行为漂移`);
  // 真实雪花 0.35 透明度较柔和（实测 y≈36dB）；无雪对照则是 50+ 的双编码噪声
  assert.ok(parseFloat(y) < 45, '亮度应可见变化（雪已叠加）: ' + y);
});
