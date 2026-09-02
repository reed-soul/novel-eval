/**
 * edge-tts 适配器：uvx edge-tts 子进程逐段合成。
 * 依赖：uv（已装）、网络。免费、稳定、速度约 10x 实时。
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ffprobeDurationMs } from '../ffmpeg.ts';
import type { Segment, } from '../annotate.ts';
import type { SynthResult, TtsEngine } from './index.ts';

const SEGMENT_TIMEOUT_MS = 120_000; // 单段上限：正常几百 ms～数秒；实测网络停摆可挂 8h+，必须兜底
const MAX_ATTEMPTS = 3;
// 服务端限流窗口为分钟级，秒级退避等于原地三连挂（EP03 首跑 s16-s82 实测 8 段全灭）
const RETRY_BACKOFF_MS = [15_000, 30_000];
const FAILURES_FILE = 'tts-failures.json';

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

/** python traceback 的真实异常在末尾：截头只能看到 File "…" 行，必须取尾 */
function errTail(stderr: string, max = 200): string {
  const t = stderr.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `…${t.slice(-max)}`;
}

interface OneResult { srt: string | null; error?: string }

async function synthOne(seg: Segment, file: string): Promise<OneResult> {
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
  let lastErr = '未知错误';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await run(UVX_CMD, args, SEGMENT_TIMEOUT_MS);
    if (r.code === 0) {
      return existsSync(srt) ? { srt } : { srt: null, error: 'exit 0 但词级 srt 未生成' };
    }
    lastErr = errTail(r.stderr);
    if (attempt === MAX_ATTEMPTS) return { srt: null, error: lastErr }; // 跳过不炸（对齐 volcengine 的失败收集模式）
    console.log(`  [tts] ${seg.id} 第 ${attempt} 次失败，${RETRY_BACKOFF_MS[attempt - 1] / 1000}s 后重试｜${lastErr}`);
    await new Promise((r2) => setTimeout(r2, RETRY_BACKOFF_MS[attempt - 1]));
  }
  return { srt: null, error: lastErr };
}

export const engine: TtsEngine = {
  name: 'edge',
  async synthesize(segments, outDir) {
    await mkdir(outDir, { recursive: true });
    const out: SynthResult[] = [];
    const failures: { segmentId: string; text: string; error: string }[] = [];
    // 顺序合成即可：每段 ~几百 ms，串行足够快且不触发限流。
    // 断点续跑：音频+词级 srt 都已存在（>512B）则跳过网络合成——换图重渲时省掉全套 TTS。
    for (const seg of segments) {
      const file = join(outDir, `${seg.id}.mp3`);
      const srt = file.replace(/\.mp3$/, '.srt');
      const cached = existsSync(file) && statSync(file).size > 512
        && existsSync(srt) && statSync(srt).size > 0;
      const one: OneResult = cached ? { srt } : await synthOne(seg, file);
      if (!one.srt) {
        // 合成失败：跳过并收集（对齐 volcengine；重跑 build 断点只补失败段）
        failures.push({ segmentId: seg.id, text: seg.text.slice(0, 80), error: one.error ?? '未知错误' });
        console.warn(`  ⚠ 段 ${seg.id} 合成失败，跳过并记录：${one.error}`);
        continue;
      }
      out.push({ segmentId: seg.id, file, durationMs: await ffprobeDurationMs(file), srtFile: one.srt });
    }
    const failuresFile = join(outDir, FAILURES_FILE);
    if (failures.length) {
      await writeFile(failuresFile, JSON.stringify(failures, null, 1), 'utf-8');
      console.warn(`  ⚠ edge：${failures.length}/${segments.length} 段失败 → ${FAILURES_FILE}（重跑 build 只补失败段）`);
    } else if (existsSync(failuresFile)) {
      // 补跑全绿后清掉旧清单：文件存在 == 当前有缺段（ep02 曾留 stale 记录误导排查）
      await rm(failuresFile, { force: true });
    }
    return out;
  },
};
