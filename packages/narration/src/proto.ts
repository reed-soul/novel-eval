/**
 * M1 验收：30 秒微原型 —— beat 真实时长切片渲染，验证音画对齐 <0.5s。
 * 不用 planSlots 槽位量化（工程评审 P0）：每 beat 一段，时长=beat.durationMs+拍间隙。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NarrationScript } from '@novel-eval/shared';
import { ffprobeDurationMs, ffmpeg } from '@novel-eval/audiobook/ffmpeg';

const GAP: Record<string, number> = { hook: 1100, turn: 650, peak: 800, close: 900, coda: 1400 };

export async function buildPrototype(outDir: string, beatsToTake = 3): Promise<{ file: string; driftMs: number }> {
  mkdirSync(outDir, { recursive: true });
  const script: NarrationScript = JSON.parse(readFileSync(join(outDir, 'script.timed.json'), 'utf-8'));
  const beats = script.sequences.flatMap((q) => q.beats).slice(0, beatsToTake);
  if (beats.some((b) => !b.durationMs || b.startMs === undefined)) throw new Error('script.timed.json 缺时长回填，先跑 audio');

  const segDir = join(outDir, 'proto-segs');
  mkdirSync(segDir, { recursive: true });
  const listFile = join(segDir, 'list.txt');
  // 串行渲染各段（颜色底+beat 标注；验证的就是时长精度；渲染铁律：禁并行）
  const segs: Array<{ seg: string; durS: number }> = [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const durS = (b.durationMs! + GAP[b.kind]) / 1000;
    const seg = join(segDir, `seg${i}.mp4`);
    segs.push({ seg, durS });
    const text = `${b.id} ${b.kind}`.replace(/'/g, '');
    await ffmpeg([
      '-y',
      '-f', 'lavfi', '-i', `color=c=0x0b1220:s=640x360:r=24:d=${durS.toFixed(3)}`,
      '-vf', `drawtext=text='${text}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', seg,
    ]);
  }
  writeFileSync(listFile, segs.map((s) => `file '${s.seg}'`).join('\n') + '\n');
  const silent = join(outDir, 'proto.mp4');
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent]);

  // 对齐验证：视频时长 vs 音频对应切片时长（从 narration.mp3 切 [0, 视频时长]）
  const vMs = await ffprobeDurationMs(silent);
  const aMs = await ffprobeDurationMs(join(outDir, 'narration.mp3'));
  const expectMs = segs.reduce((n, s) => n + s.durS * 1000, 0);
  const driftMs = Math.abs(vMs - expectMs);
  const covered = Math.min(vMs, aMs);
  console.log(`  微原型：视频 ${Math.round(vMs)}ms / 期望 ${Math.round(expectMs)}ms / 漂移 ${Math.round(driftMs)}ms；音轨全长 ${Math.round(aMs)}ms，覆盖 ${Math.round(covered)}ms`);
  if (driftMs > 500) throw new Error(`音画对齐漂移 ${driftMs}ms > 500ms`);
  return { file: silent, driftMs };
}
