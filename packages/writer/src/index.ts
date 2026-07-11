/**
 * @novel-eval/writer — AI 驱动的小说写作模块（开发中）
 *
 * 阶段 1（本版）：仅占位，确认 monorepo 骨架与依赖链路通畅。
 * 阶段 2 规划：
 *   - Story Bible（角色卡 / 世界观 / 时间线 / 伏笔，存 SQLite）
 *   - 滚动摘要 + 最近窗口（长篇连贯性）
 *   - 大纲生成 → 章节生成 pipeline（带 checkpoint）
 *   - 质量门槛（复用 @novel-eval/eval 的评估当 quality gate）
 *   - 剧透感知的上下文组装
 *
 * 设计依据：见 docs/plans/ 下的 monorepo 改造方案与写作模块调研。
 */
import { createEngine, loadEngineConfig } from '@novel-eval/shared';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_CONFIG_DIR = resolve(__dirname, '..', '..', 'shared', 'config');

export const name = 'writer';
export const version = '0.0.0';
export const status = 'planned' as const;

/**
 * 健康检查：验证 writer 包能正确解析 shared 的引擎配置链路。
 * 阶段 2 实现真实功能前，这个函数用来确认 monorepo 接线无误。
 */
export function healthCheck(): { ok: boolean; engineName: string; model: string } {
  const { engine, engineName } = loadEngineConfig(SHARED_CONFIG_DIR);
  // 仅验证 createEngine 可调用（不发起真实请求）
  const adapter = createEngine(engine);
  return { ok: adapter.name === engineName, engineName, model: engine.model };
}
