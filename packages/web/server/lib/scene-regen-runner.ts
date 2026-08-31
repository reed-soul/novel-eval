/**
 * 场景图重生成执行器（完全收口）：读 key + 删旧图 + spawn gen-scenes-ark.ts + job 生命周期。
 * route 层只调 `runSceneRegenJob()`——key/路径/子进程全部在本模块内部消化。
 */
import { readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface RegenJobResult {
  id: string;
  deleted: number;
  lines: { seq: number; text: string }[];
  emitter: EventEmitter;
  child: ChildProcess;
  onDone: (cb: (status: string) => void) => void;
}

export function runSceneRegenJob(
  repoRoot: string,
  scenesRoot: string,
  scenesJson: string,
  imageIds: string[],
): RegenJobResult {
  // 删旧图（断点续跑只补这些）
  let deleted = 0;
  for (const img of imageIds) {
    const f = join(scenesRoot, `${img}.jpg`);
    if (existsSync(f)) { rmSync(f); deleted += 1; }
  }

  // ARK key 从固定路径读（值只进子进程 env）
  const arkKeyFile = join(homedir(), '.zcode', 'ark-key.txt');
  const arkKey = readFileSync(arkKeyFile, 'utf-8').trim();
  if (!arkKey) throw new Error('~/.zcode/ark-key.txt 为空');

  const child = spawn('pnpm', ['tsx', 'gen-scenes-ark.ts'], {
    cwd: join(repoRoot, 'packages', 'audiobook'),
    env: {
      ...process.env,
      ARK_API_KEY: arkKey,
      SCENES_JSON: scenesJson,
      OUT_DIR: scenesRoot,
    },
  });

  const lines: { seq: number; text: string }[] = [];
  const emitter = new EventEmitter();
  let seq = 0;
  const feed = (chunk: Buffer | string) => {
    for (const line of String(chunk).split('\n')) {
      const text = line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
      if (!text.trim()) continue;
      seq += 1;
      lines.push({ seq, text });
      if (lines.length > 2000) lines.shift();
      emitter.emit('line', { seq, text });
    }
  };
  child.stdout?.on('data', feed);
  child.stderr?.on('data', feed);

  const id = `regen-${Date.now().toString(36)}`;
  const result: RegenJobResult = {
    id, deleted, lines, emitter, child,
    onDone: (cb) => {
      child.on('close', (code) => cb(code === 0 ? 'completed' : 'failed'));
    },
  };
  return result;
}
