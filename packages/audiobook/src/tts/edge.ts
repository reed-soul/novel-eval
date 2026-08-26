/**
 * edge-tts 适配器：uvx edge-tts 子进程逐段合成。
 * 依赖：uv（已装）、网络。免费、稳定、速度约 10x 实时。
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ffprobeDurationMs } from '../ffmpeg.ts';
import type { Segment, } from '../annotate.ts';
import type { SynthResult, TtsEngine } from './index.ts';

function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => res({ code: code ?? 1, stderr }));
  });
}

async function synthOne(seg: Segment, file: string): Promise<string | undefined> {
  const srt = file.replace(/\.mp3$/, '.srt');
  const r = await run('uvx', [
    'edge-tts',
    '--voice', seg.voice,
    `--rate=${seg.rate}`,   // 负值必须用 = 形式，否则被 argparse 当作选项名
    `--pitch=${seg.pitch}`,
    '--text', seg.text,
    '--write-media', file,
    '--write-subtitles', srt,   // 词级时间戳
  ]);
  if (r.code !== 0) throw new Error(`edge-tts 失败 ${seg.id}: ${r.stderr.slice(0, 300)}`);
  return existsSync(srt) ? srt : undefined;
}

export const engine: TtsEngine = {
  name: 'edge',
  async synthesize(segments, outDir) {
    await mkdir(outDir, { recursive: true });
    const out: SynthResult[] = [];
    // 顺序合成即可：每段 ~几百 ms，串行足够快且不触发限流
    for (const seg of segments) {
      const file = join(outDir, `${seg.id}.mp3`);
      const srtFile = await synthOne(seg, file);
      out.push({ segmentId: seg.id, file, durationMs: await ffprobeDurationMs(file), srtFile });
    }
    return out;
  },
};
