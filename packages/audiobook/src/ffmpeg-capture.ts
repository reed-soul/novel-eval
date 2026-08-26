/**
 * 需要捕获 stdout/stderr 的 ffmpeg 调用（loudnorm 测量等）。
 */
import { spawn } from 'node:child_process';

export function ffmpegCapture(args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-hide_banner', ...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    p.stderr.on('data', (d) => (buf += d));
    p.stdout.on('data', (d) => (buf += d));
    p.on('close', (code) => (code === 0 ? res(buf) : rej(new Error(`ffmpeg 分析失败: ${buf.slice(-400)}`))));
    p.on('error', rej);
  });
}
