/**
 * 章节一致性检查与修复
 *
 * 解决"窄窗口"问题：单章收尾顺序是 saveChapter → markOutlineWritten → finalizeChapter
 * （generator.ts 的 finalizeAndSave）。如果在 saveChapter 之后、finalizeChapter 之前崩溃，
 * chapter 表有第 M 章正文，但 narrative_state.up_to_chapter 还停在 M-1，
 * 导致叙事状态永久落后正文一章（伏笔/角色变化没进入后续章节上下文）。
 *
 * ensureChapterConsistency 检测这种不一致，补跑 finalizeChapter 把状态追平正文，
 * 然后返回 resume 起点（M+1）。
 */
import type { AIAgentAdapter } from '@novel-eval/shared';
import type { DB } from '../db.ts';
import { getChapter, getNarrativeState, countOutlines } from './store.ts';
import { finalizeChapter } from './finalizer.ts';

export interface ConsistencyResult {
  /** 续写起点（max(已写章号) + 1）*/
  from: number;
  /** 续写终点（outline 总数）*/
  to: number;
  /** 补跑了几章 finalize（0 = 本来就一致）*/
  finalizedGap: number;
}

/**
 * 检测并修复"正文已存但叙事状态落后"的不一致，返回 resume 起点。
 *
 * @param engine 补跑 finalize 需要调 LLM；若 finalizedGap===0 不会用到
 * @param onProgress 可选进度回调
 */
export async function ensureChapterConsistency(
  engine: AIAgentAdapter,
  db: DB,
  projectId: string,
  onProgress?: (step: string, msg: string) => void,
): Promise<ConsistencyResult> {
  const outlineMax = countOutlines(db, projectId);

  // 查 chapter 表最大章号（正文进度）
  const maxRow = db.prepare('SELECT MAX(number) AS m FROM chapter WHERE project_id = ?')
    .get(projectId) as { m: number | null } | undefined;
  const maxWritten = maxRow?.m ?? 0;

  // 查 narrative_state 推进到第几章
  const narrative = getNarrativeState(db, projectId);
  const upTo = narrative?.upToChapter ?? 0;

  // 不一致：正文比状态多。补跑缺失章节的 finalize（按顺序，逐章）
  let finalizedGap = 0;
  if (maxWritten > upTo) {
    for (let n = upTo + 1; n <= maxWritten; n++) {
      const ch = getChapter(db, projectId, n);
      if (!ch) continue;  // 防御性：理论上 upTo+1..maxWritten 都该有
      onProgress?.(`consistency:${n}`, `补全叙事状态（第 ${n} 章，正文已存但状态落后）...`);
      await finalizeChapter({
        engine, db, projectId,
        chapterNumber: n,
        chapterTitle: ch.title,
        chapterContent: ch.content,
        onProgress,
      });
      finalizedGap++;
    }
    onProgress?.('consistency', `✓ 已补全 ${finalizedGap} 章叙事状态`);
  }

  return {
    from: maxWritten + 1,
    to: outlineMax,
    finalizedGap,
  };
}
