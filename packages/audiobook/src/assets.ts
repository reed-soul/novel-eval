/**
 * 程序化氛围素材：落雪循环视频（一次性生成、缓存复用）。
 * 纯 Node 画粒子帧（PPM），ffmpeg 编码为 10s 无缝循环，渲染时 stream_loop + screen 混合。
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const W = 480, H = 270, FPS = 25, SECS = 10, FRAMES = FPS * SECS;

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { shell: false });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`snow 编码失败: ${err.slice(-300)}`))));
    p.on('error', rej);
  });
}

/** 生成（或复用缓存）落雪循环 mp4，返回路径 */
export async function ensureSnowAsset(outRoot: string): Promise<string> {
  const snow = resolve(outRoot, 'assets/snow.mp4');
  if (existsSync(snow)) return snow;

  const tmp = resolve(outRoot, 'assets/snow-frames');
  await mkdir(tmp, { recursive: true });

  const rnd = mulberry32(20260826);
  const flakes = Array.from({ length: 150 }, () => ({
    x: rnd() * W, y: rnd() * H,
    v: 1.0 + rnd() * 2.4,              // 下落速度 px/frame
    drift: (rnd() - 0.5) * 0.7,        // 水平漂移
    s: rnd() < 0.55 ? 1 : rnd() < 0.8 ? 2 : 3,  // 近大远小
    lum: 180 + Math.floor(rnd() * 75), // 亮度分层
  }));

  // 第 0 帧与第 FRAMES 帧必须一致才是无缝循环：位置按帧号线性推进、取模回绕
  for (let f = 0; f < FRAMES; f++) {
    const frame = Buffer.alloc(W * H);
    for (const fl of flakes) {
      const y = Math.round((fl.y + fl.v * f) % H);
      const x = Math.round(((fl.x + fl.drift * f) % W + W) % W);
      for (let dy = 0; dy < fl.s; dy++) {
        for (let dx = 0; dx < fl.s; dx++) {
          frame[((y + dy) % H) * W + ((x + dx) % W)] = fl.lum;
        }
      }
    }
    const ppm = Buffer.concat([Buffer.from(`P5\n${W} ${H}\n255\n`), frame]);
    await writeFile(join(tmp, `${String(f).padStart(4, '0')}.ppm`), ppm);
  }

  await runFfmpeg([
    '-framerate', String(FPS), '-i', join(tmp, '%04d.ppm'),
    '-vf', 'scale=1920:1080,format=yuv420p',
    '-c:v', 'libx264', '-crf', '20', '-r', String(FPS), snow,
  ]);
  await rm(tmp, { recursive: true, force: true });
  return snow;
}
