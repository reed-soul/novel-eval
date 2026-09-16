/**
 * 管线子进程登记与退出清理（评审遗留项：服务退出时孤儿 ffmpeg/pnpm 进程）。
 *
 * pipeline-spawn / scene-regen-runner 以 detached（新进程组）启动子进程，
 * 全部经 trackChild 登记；server 收 SIGINT/SIGTERM 时 killTrackedChildren
 * 对每个进程组先 SIGTERM、宽限后 SIGKILL——pnpm→tsx→ffmpeg 整棵树一并收掉，
 * 杜绝「服务重启后锁已空、旧 ffmpeg 还在后台跑」的双渲染击穿。
 */
import type { ChildProcess } from 'node:child_process';

const tracked = new Set<ChildProcess>();

export function trackChild(child: ChildProcess): ChildProcess {
  if (child.exitCode !== null || child.signalCode !== null) return child;
  tracked.add(child);
  const drop = () => tracked.delete(child);
  child.once('close', drop);
  child.once('error', drop);
  return child;
}

export function trackedCount(): number {
  return tracked.size;
}

/** 杀单棵进程组：组 SIGTERM → 宽限 → 组 SIGKILL（组杀失败时退回直接 kill） */
function killTree(child: ChildProcess, graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
    const groupSig = (sig: NodeJS.Signals): boolean => {
      try { process.kill(-child.pid!, sig); return true; } catch { return false; }
    };
    if (!groupSig('SIGTERM')) {
      try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
    }
    const timer = setTimeout(() => {
      if (!groupSig('SIGKILL')) {
        try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      }
      done();
    }, graceMs);
    child.once('close', done);
  });
}

/** 退出钩子入口：杀光所有登记中的子进程树（宽限后强杀），最多等 graceMs+余量 */
export async function killTrackedChildren(graceMs = 1500): Promise<void> {
  const children = [...tracked];
  tracked.clear();
  await Promise.all(children.map((c) => killTree(c, graceMs)));
}
