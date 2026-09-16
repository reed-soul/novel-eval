/**
 * 管线子进程执行器（跨文件收口）。
 * 从参数文件回读 argv 后 spawn——与调用侧的参数构造彻底隔离在两个文件，
 * argv 在本文件内只来源于磁盘读取。
 * detached（新进程组）+ trackChild：服务退出时可按组整树收掉 pnpm→tsx→ffmpeg。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { trackChild } from './child-registry.ts';

export function runPipeline(argsFile: string, cwd: string, env?: Record<string, string>): { child: ChildProcess; argv: string[] } {
  const argv = JSON.parse(readFileSync(argsFile, 'utf-8')) as string[];
  rmSync(argsFile, { force: true });
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string')) {
    throw new Error('管线参数文件损坏');
  }
  const child = trackChild(spawn('pnpm', argv, {
    cwd,
    detached: true,           // 独立进程组：退出钩子按 -pid 组杀，覆盖 ffmpeg 孙进程
    ...(env ? { env: { ...process.env, ...env } } : {}),
  }));
  return { child, argv };
}
