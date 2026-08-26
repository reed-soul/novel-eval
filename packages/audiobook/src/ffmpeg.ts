/**
 * ffmpeg/ffprobe 薄封装。
 * 安全约束：二进制名硬编码、参数走数组、显式 shell:false，不拼接命令字符串。
 */
import { spawn } from 'node:child_process';

function run(bin: 'ffmpeg' | 'ffprobe', args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const p = spawn(bin, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => res({ code: code ?? 1, stdout, stderr }));
  });
}

export async function ffprobeDurationMs(file: string): Promise<number> {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  if (r.code !== 0) throw new Error(`ffprobe 失败 ${file}: ${r.stderr.slice(0, 200)}`);
  const sec = Number.parseFloat(r.stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) throw new Error(`ffprobe 时长异常 ${file}: ${r.stdout.trim()}`);
  return Math.round(sec * 1000);
}

export async function ffmpeg(args: string[]): Promise<void> {
  const r = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.code !== 0) throw new Error(`ffmpeg 失败: ${r.stderr.slice(0, 400)}`);
}
