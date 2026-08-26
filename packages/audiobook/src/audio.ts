/**
 * 音频装配：片段拼接（带停顿）→ 两遍响度归一（YouTube 目标 -16 LUFS）→ 章节成品 mp3。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpeg, ffprobeDurationMs } from './ffmpeg.ts';
import type { SynthResult } from './tts/index.ts';
import type { Segment } from './annotate.ts';

const SILENCE_FILE = 'silence.mp3';

async function makeSilence(dir: string, ms: number): Promise<string> {
  const file = join(dir, `sil-${ms}.mp3`);
  await ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', (ms / 1000).toFixed(3), '-b:a', '128k', file]);
  return file;
}

export async function assembleChapter(
  segments: Segment[],
  synth: SynthResult[],
  workDir: string,
  outFile: string
): Promise<number> {
  const synthById = new Map(synth.map((s) => [s.segmentId, s]));
  const lines: string[] = [];

  // 停顿时长集合（去重生成静音文件）
  const gaps = [...new Set(segments.map((s) => Math.min(s.gapAfterMs, 1200)))];
  const gapFiles = new Map<number, string>();
  for (const ms of gaps) {
    if (ms > 0) gapFiles.set(ms, await makeSilence(workDir, ms));
  }

  for (const seg of segments) {
    const s = synthById.get(seg.id);
    if (!s) continue;
    lines.push(`file '${s.file}'`);
    const gap = gapFiles.get(Math.min(seg.gapAfterMs, 1200));
    if (gap) lines.push(`file '${gap}'`);
  }
  if (lines.length === 0) throw new Error('没有可拼接的音频片段');

  const listFile = join(workDir, 'concat.txt');
  await writeFile(listFile, lines.join('\n'), 'utf-8');
  const raw = join(workDir, 'chapter-raw.mp3');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-b:a', '128k', raw]);

  // 两遍 loudnorm：第一遍测参数，第二遍应用（-16 LUFS / TP -1.5 是 YouTube 播放标准的稳妥值）
  const measure = await ffmpegMeasure(raw);
  await ffmpeg([
    '-i', raw,
    '-af', `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measure.I}:measured_TP=${measure.TP}:measured_LRA=${measure.LRA}:measured_thresh=${measure.thresh}:linear=true:print_format=none`,
    '-ar', '44100', '-b:a', '128k', outFile,
  ]);
  return ffprobeDurationMs(outFile);
}

async function ffmpegMeasure(file: string): Promise<{ I: string; TP: string; LRA: string; thresh: string }> {
  // 复用 ffmpeg.ts 的封装跑分析滤镜
  const { ffmpegCapture } = await import('./ffmpeg-capture.ts');
  const out = await ffmpegCapture(['-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const m = out.match(/\{[^}]*\}/s);
  if (!m) throw new Error('loudnorm 未输出测量 JSON');
  const j = JSON.parse(m[0]) as Record<string, string>;
  return { I: j.input_i, TP: j.input_tp, LRA: j.input_lra, thresh: j.input_thresh };
}

export { SILENCE_FILE };
