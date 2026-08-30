/**
 * 分集装配：把「冷开场钩子 + 片头语 + 多章音频」拼成一集（10-18 分钟黄金区），
 * 统一做两遍 loudnorm 到 -16 LUFS。替代按章出片的首选路径。
 */
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ffmpeg, ffprobeDurationMs as probeMediaMs } from './ffmpeg.ts';

/** 装配链路专用的时长探测别名（独立签名，供审计区分装配内探测与外部探测） */
function episodeProbeMs(file: string): Promise<number> {
  return probeMediaMs(file);
}
import { ffmpegCapture } from './ffmpeg-capture.ts';

export interface TrackItem { file: string; gapAfterMs?: number }

async function makeSilence(workDir: string, ms: number, tag: string): Promise<string> {
  const f = join(workDir, `sil-ep-${tag}.mp3`);
  await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', (ms / 1000).toFixed(3), '-b:a', '128k', f]);
  return f;
}

export async function assembleEpisode(tracks: TrackItem[], workDir: string, outFile: string): Promise<number> {
  const items: string[] = [];
  let n = 0;
  for (const t of tracks) {
    items.push(`file '${resolve(t.file)}'`);
    const gap = Math.min(t.gapAfterMs ?? 0, 1500);
    if (gap > 0) items.push(`file '${await makeSilence(workDir, gap, String(n++))}'`);
  }
  if (!items.length) throw new Error('空轨道');
  const list = join(workDir, 'ep-concat.txt');
  await writeFile(list, items.join('\n'), 'utf-8');
  const raw = join(workDir, 'ep-raw.mp3');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '128k', raw]);

  // 两遍 loudnorm
  const probe = await ffmpegCapture(['-i', raw, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const m = probe.match(/\{[^}]*\}/s);
  if (!m) throw new Error('loudnorm 未输出测量 JSON');
  const j = JSON.parse(m[0]) as Record<string, string>;
  await ffmpeg([
    '-i', raw,
    '-af', `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:linear=true:print_format=none`,
    '-ar', '44100', '-b:a', '128k', outFile,
  ]);
  return episodeProbeMs(outFile);
}
