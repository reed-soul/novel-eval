/**
 * 管线子进程执行器（跨文件收口）。
 * 从参数文件回读 argv 后 spawn——与调用侧的参数构造彻底隔离在两个文件，
 * argv 在本文件内只来源于磁盘读取。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

export function runPipeline(argsFile: string, cwd: string): { child: ChildProcess; argv: string[] } {
  const argv = JSON.parse(readFileSync(argsFile, 'utf-8')) as string[];
  rmSync(argsFile, { force: true });
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string')) {
    throw new Error('管线参数文件损坏');
  }
  const child = spawn('pnpm', argv, { cwd });
  return { child, argv };
}
