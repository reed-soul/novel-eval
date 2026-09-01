/**
 * edge-tts 适配器：uvx edge-tts 子进程逐段合成。
 * 依赖：uv（已装）、网络。免费、稳定、速度约 10x 实时。
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ffprobeDurationMs } from '../ffmpeg.ts';
import type { Segment, } from '../annotate.ts';
import type { SynthResult, TtsEngine } from './index.ts';

const SEGMENT_TIMEOUT_MS = 120_000; // 单段上限：正常几百 ms～数秒；实测网络停摆可挂 8h+，必须兜底
const MAX_ATTEMPTS = 3;

/** uvx 路径探测：PATH 找不到时回退常见安装位（Web 服务的 PATH 可能不含 ~/.local/bin） */
const UVX_CMD = (() => {
  for (const p of [
    join(homedir(), '.local', 'bin', 'uvx'),
    '/opt/homebrew/bin/uvx',
    '/usr/local/bin/uvx',
  ]) {
    if (existsSync(p)) return p;
  }
  return 'uvx'; // 让 spawn 从 PATH 兜底（终端环境通常能找到）
})();

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      stderr += `\n[timeout] ${timeoutMs}ms 无响应，杀死子进程`;
      p.kill('SIGKILL');
    }, timeoutMs);
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => {
      clearTimeout(timer);
      res({ code: code ?? 1, stderr });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      res({ code: 1, stderr: String(e) });
    });
  });
}

async function synthOne(seg: Segment, file: string): Promise<string | undefined> {
  const srt = file.replace(/\.mp3$/, '.srt');
  const args = [
    'edge-tts',
    '--voice', seg.voice,
    `--rate=${seg.rate}`,   // 负值必须用 = 形式，否则被 argparse 当作选项名
    `--pitch=${seg.pitch}`,
    '--text', seg.text,
    '--write-media', file,
    '--write-subtitles', srt,   // 词级时间戳
  ];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await run(UVX_CMD, args, SEGMENT_TIMEOUT_MS);
    if (r.code === 0) return existsSync(srt) ? srt : undefined;
    if (attempt === MAX_ATTEMPTS) throw new Error(`edge-tts 失败 ${seg.id}（重试 ${MAX_ATTEMPTS} 次）: ${r.stderr.slice(0, 300)}`);
    console.log(`  [tts] ${seg.id} 第 ${attempt} 次失败，重试：${r.stderr.slice(0, 120).replace(/\n/g, ' ')}`);
    await new Promise((r2) => setTimeout(r2, 3_000 * attempt));
  }
  throw new Error('unreachable');
}

export const engine: TtsEngine = {
  name: 'edge',
  async synthesize(segments, outDir) {
    await mkdir(outDir, { recursive: true });
    const out: SynthResult[] = [];
    // 顺序合成即可：每段 ~几百 ms，串行足够快且不触发限流。
    // 断点续跑：音频+词级 srt 都已存在（>512B）则跳过网络合成——换图重渲时省掉全套 TTS。
    for (const seg of segments) {
      const file = join(outDir, `${seg.id}.mp3`);
      const srt = file.replace(/\.mp3$/, '.srt');
      const cached = existsSync(file) && statSync(file).size > 512
        && existsSync(srt) && statSync(srt).size > 0;
      const srtFile = cached ? srt : await synthOne(seg, file);
      out.push({ segmentId: seg.id, file, durationMs: await ffprobeDurationMs(file), srtFile });
    }
    return out;
  },
};
