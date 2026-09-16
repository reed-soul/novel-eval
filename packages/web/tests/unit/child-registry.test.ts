/**
 * child-registry — 退出时按进程组收掉登记子进程（孤儿 ffmpeg 收口）。
 * 验证三件事：登记/退出自动注销；killTrackedChildren 让进程组真正死亡
 * （含组内孙进程）；对已退出进程幂等。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { trackChild, trackedCount, killTrackedChildren } from '../../server/lib/child-registry.ts';

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe('child-registry', () => {
  it('killTrackedChildren 杀掉整棵进程组（含孙进程）', async () => {
    // sh -c 'sleep 500 & sleep 500' → 组内有两个孙进程，组杀必须全收
    const child = trackChild(spawn('/bin/sh', ['-c', 'sleep 500 & sleep 500 & wait'], { detached: true, stdio: 'ignore' }));
    assert.ok(child.pid, '子进程应有 pid');
    assert.equal(trackedCount(), 1);
    await new Promise((r) => setTimeout(r, 150));   // 让 sleep 真正起起来

    await killTrackedChildren(800);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(child.pid!), false, '组主进程应已死');
    let leftover = '';
    try { leftover = execFileSync('pgrep', ['-g', String(child.pid)]).toString().trim(); } catch { /* pgrep 无匹配时 exit 1 = 组已清空 */ }
    assert.equal(leftover, '', `进程组 ${child.pid} 内不应有残留（实际：${leftover}）`);
  });

  it('子进程自然退出后自动注销；killTrackedChildren 对空集幂等', async () => {
    trackChild(spawn('/bin/sh', ['-c', 'exit 0'], { detached: true, stdio: 'ignore' }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(trackedCount(), 0, '退出进程应自动注销');
    await killTrackedChildren(100);   // 不抛错即通过
  });
});
