/**
 * 全局渲染互斥锁（解说 M3 · 工程评审 P0）。
 *
 * 有声书与解说两条管线的 ffmpeg 渲染必须全仓串行（16GB Mac 并行渲染压死先例）。
 * 此前 audiobook 路由内部持私有锁——解说路由若各持一把，两路由即可并发渲染。
 * 本模块为进程内单例：两路由共用同一把锁，谁先占谁渲染，其余 409。
 */

export type RenderKind = 'audiobook' | 'narration';

interface LockHolder {
  jobId: string;
  kind: RenderKind;
  startedAt: number;
}

let holder: LockHolder | null = null;

export function renderLockActive(): LockHolder | null {
  return holder;
}

/** 占锁（已被占时抛错）；与调用侧的 409 预检配合，此处是硬兜底 */
export function acquireRenderLock(jobId: string, kind: RenderKind): void {
  if (holder) throw new Error(`RENDER_LOCK_BUSY:${holder.kind}`);
  holder = { jobId, kind, startedAt: Date.now() };
}

/** 释放（仅持锁任务本身可释放；幂等） */
export function releaseRenderLock(jobId: string): void {
  if (holder?.jobId === jobId) holder = null;
}

export const RENDER_KIND_LABEL: Record<RenderKind, string> = {
  audiobook: '有声书',
  narration: '解说视频',
};
