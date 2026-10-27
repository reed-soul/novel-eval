#!/usr/bin/env node
/**
 * 一键开发模式：同时启动后端 API（:4000）与 Vite 前端（:5173，热更新）。
 *
 * 用法：pnpm dev
 *
 * 注入默认环境变量（已在环境中设置时不覆盖，路径按仓库根解析为绝对路径，
 * 与「WRITER_DB_PATH 禁止依赖 cwd」的约束保持一致）：
 *   WRITER_DB_PATH=./data/writer/writer.db
 *   EVAL_DATA_DIR=./data/evals
 * AI key 不在此处注入——server 启动时 loadEnv() 自会读 ~/.claude/settings.json。
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const env = { ...process.env };
if (!env.WRITER_DB_PATH?.trim()) env.WRITER_DB_PATH = resolve(repoRoot, 'data/writer/writer.db');
if (!env.EVAL_DATA_DIR?.trim()) env.EVAL_DATA_DIR = resolve(repoRoot, 'data/evals');

const backendPort = Number.parseInt(env.PORT ?? '', 10) || 4000;

const LABELS = {
  api: { text: 'api ', color: '\x1b[36m' }, // 青
  web: { text: 'web ', color: '\x1b[35m' }, // 品红
};
const RESET = '\x1b[0m';

const children = new Set();
let shuttingDown = false;

function launch(name, args) {
  const child = spawn('pnpm', args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const label = LABELS[name];
  const pipe = (stream, isError) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        const target = isError ? process.stderr : process.stdout;
        target.write(`${label.color}[${label.text}]${RESET} ${line}\n`);
      }
    });
    stream.on('end', () => {
      if (buffer.trim() !== '') {
        const target = isError ? process.stderr : process.stdout;
        target.write(`${label.color}[${label.text}]${RESET} ${buffer}\n`);
      }
    });
  };
  pipe(child.stdout, false);
  pipe(child.stderr, true);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) {
      if (children.size === 0) process.exit(0);
      return;
    }
    // 任一进程退出即整体收摊：后端挂了 Vite 代理必死，Vite 挂了界面不可用
    console.error(`${label.color}[${label.text}]${RESET} 进程退出（code=${code} signal=${signal}），正在停止其余进程…`);
    shutdown(Math.max(code ?? 1, 1));
  });
  return child;
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  // tsx/Vite 收到 SIGINT 后通常自行退出；兜底 3 秒后强杀
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGTERM');
    }
  }, 3000).unref();
  // 兜底退出：若 3.5 秒内仍有进程未退，不再等待
  setTimeout(() => process.exit(exitCode), 3500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`开发模式启动：前端 http://localhost:5173（热更新，代理 /api → :${backendPort}）`);
console.log(`  数据库 ${env.WRITER_DB_PATH}`);
launch('api', ['web']);
launch('web', ['web:dev']);
