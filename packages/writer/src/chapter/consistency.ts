/**
 * 章节一致性检查与修复（遗留）
 *
 * 旧路径依赖可变 narrative_state 快照。Phase A 改为 versioned story state ledger；
 * Task 6 的 rebuild 将正式替换本模块。此处保留导出形状，避免 CLI 在过渡期断编译。
 */
import type { AIAgentAdapter } from '@novel-eval/shared';
import type { DB } from '../db.ts';

export interface ConsistencyResult {
  /** 续写起点（max(已写章号) + 1）*/
  from: number;
  /** 续写终点（outline 总数）*/
  to: number;
  /** 补跑了几章 finalize（0 = 本来就一致）*/
  finalizedGap: number;
}

/**
 * 版本化状态账本下不再做可变快照追平。返回空范围，由上层决定下一步。
 */
export async function ensureChapterConsistency(
  _engine: AIAgentAdapter,
  _db: DB,
  _projectId: string,
  _onProgress?: (step: string, msg: string) => void,
): Promise<ConsistencyResult> {
  return {
    from: 1,
    to: 0,
    finalizedGap: 0,
  };
}
