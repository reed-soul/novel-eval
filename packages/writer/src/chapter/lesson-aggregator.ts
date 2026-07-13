/**
 * 经验聚合器 — 从 eval_history 提炼写作经验，供后续章节 prompt 注入
 *
 * 两个职责：
 *   1. aggregateLessons(): 从已写章节的评估数据中提取模式（哪类章节哪一维度常低分、
 *      重复 hotspots 黑名单、重写后提升最大的改进方向），写入 lesson_learned 表。
 *   2. buildLessonPrompt(): 查询当前章节类型的经验，生成 ≤500 字的 prompt 段落。
 *
 * 章节分类规则（根据蓝图 metadata 自动判定）：
 *   开局: act=1 且 number ≤ 5
 *   推进: act≤2 且 suspense ≤ 5
 *   转折: twist ≥ 7
 *   高潮: suspense ≥ 8
 *   结局: act=3 且 totalChapters - number ≤ 3
 */
import type { DB } from '../db.ts';
import type { ChapterOutline } from './types.ts';
import { getAllEvalHistory, getLessonsByPattern, upsertLesson, type EvalHistoryRecord } from './store.ts';

// ─── 章节类型分类 ─────────────────────────────────────────────────

export type ChapterPattern = '开局' | '推进' | '转折' | '高潮' | '结局' | '默认';

export function classifyChapter(
  outline: { act: number; suspenseLevel: number; twistLevel: number; number: number },
  totalChapters: number,
): ChapterPattern {
  const { act, suspenseLevel: suspense, twistLevel: twist, number } = outline;
  if (act === 3 && totalChapters - number <= 3) return '结局';
  if (suspense >= 8) return '高潮';
  if (twist >= 7) return '转折';
  if (act === 1 && number <= 5) return '开局';
  if (act <= 2 && suspense <= 5) return '推进';
  return '默认';
}

// ─── 经验聚合 ─────────────────────────────────────────────────────

/** 从项目的 eval_history 聚合经验，写入 lesson_learned */
export function aggregateLessons(db: DB, projectId: string): number {
  const history = getAllEvalHistory(db, projectId);
  if (history.length === 0) return 0;

  // 按章节分组（每章可能有多轮 attempt），取最终轮的 verdict
  const byChapter = new Map<number, EvalHistoryRecord[]>();
  for (const h of history) {
    if (!byChapter.has(h.chapterNumber)) byChapter.set(h.chapterNumber, []);
    byChapter.get(h.chapterNumber)!.push(h);
  }

  // 按 pattern 分组，提取每个 pattern 下各维度的平均分
  const patternDims = new Map<ChapterPattern, Map<string, number[]>>();
  const patternHotspots = new Map<ChapterPattern, string[]>();
  const patternFixes = new Map<ChapterPattern, string[]>();

  // 需要章节蓝图来分类，加载全部 outline
  const outlines = db.prepare(
    'SELECT number, act, suspense_level, twist_level FROM chapter_outline WHERE project_id = ?',
  ).all(projectId) as Array<{ number: number; act: number; suspense_level: number; twist_level: number }>;
  const totalChapters = outlines.length;
  const outlineMap = new Map(outlines.map(o => [o.number, o]));

  for (const [chapterNum, records] of byChapter) {
    const o = outlineMap.get(chapterNum);
    if (!o) continue;
    const pattern = classifyChapter(
      { act: o.act, suspenseLevel: o.suspense_level ?? 5, twistLevel: o.twist_level ?? 0, number: chapterNum },
      totalChapters,
    );

    // 取 pass 的那轮（或最后一轮）
    const finalRecord = records.find(r => r.verdict === 'pass') ?? records[records.length - 1];
    if (!finalRecord.dimensions) continue;

    // 收集各维度分数
    if (!patternDims.has(pattern)) patternDims.set(pattern, new Map());
    const dimMap = patternDims.get(pattern)!;
    for (const [dim, data] of Object.entries(finalRecord.dimensions)) {
      if (!dimMap.has(dim)) dimMap.set(dim, []);
      dimMap.get(dim)!.push(data.score);
    }

    // 收集重复 hotspots
    if (finalRecord.repetition?.hotspots?.length) {
      if (!patternHotspots.has(pattern)) patternHotspots.set(pattern, []);
      patternHotspots.get(pattern)!.push(...finalRecord.repetition.hotspots);
    }

    // 如果有 revise（重写后 pass），收集改进建议作为 effective_fixes
    if (records.length > 1 && finalRecord.verdict === 'pass') {
      const firstRecord = records[0];
      if (firstRecord.suggestions) {
        if (!patternFixes.has(pattern)) patternFixes.set(pattern, []);
        for (const s of firstRecord.suggestions.slice(0, 3)) {
          patternFixes.get(pattern)!.push(s.content.slice(0, 120));
        }
      }
    }
  }

  // 写入 lesson_learned
  let count = 0;
  for (const [pattern, dimMap] of patternDims) {
    for (const [dim, scores] of dimMap) {
      const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;

      // 低分维度（< 75）记为 common_issues
      const commonIssues: string[] = [];
      if (avgScore < 75) {
        commonIssues.push(`${dim} 平均 ${avgScore.toFixed(0)} 分，需加强`);
      }

      // 该 pattern 下累积的 hotspots（去重，取前 5）
      const allHotspots = patternHotspots.get(pattern) ?? [];
      const uniqueHotspots = [...new Set(allHotspots)].slice(0, 5);
      if (uniqueHotspots.length) {
        commonIssues.push(`高频重复片段：${uniqueHotspots.join('、')}`);
      }

      const effectiveFixes = (patternFixes.get(pattern) ?? []).slice(0, 3);

      upsertLesson(db, {
        projectId,
        pattern,
        dimension: dim,
        avgScore: Math.round(avgScore * 10) / 10,
        commonIssues,
        effectiveFixes,
      });
      count++;
    }
  }

  return count;
}

// ─── Prompt 注入 ─────────────────────────────────────────────────

/** 为当前章节构建经验注入段落（≤ 500 字）*/
export function buildLessonPrompt(db: DB, projectId: string, pattern: ChapterPattern): string {
  const lessons = getLessonsByPattern(db, pattern, projectId);
  if (lessons.length === 0) return '';

  const parts: string[] = [];

  // 找低分维度（avgScore 最低的 2 个）
  const lowScoreDims = lessons
    .filter(l => l.avgScore < 78)
    .sort((a, b) => a.avgScore - b.avgScore)
    .slice(0, 2);

  if (lowScoreDims.length) {
    parts.push('【同类章节的薄弱维度（请针对性加强）】');
    for (const l of lowScoreDims) {
      const dimLabel = l.dimension ?? '综合';
      parts.push(`  ${dimLabel}（历史均分 ${l.avgScore}）：${l.commonIssues.join('；')}`);
    }
  }

  // 找有效改法（effective_fixes 非空的）
  const fixes = lessons
    .filter(l => l.effectiveFixes.length > 0)
    .slice(0, 2);
  if (fixes.length) {
    parts.push('【已验证有效的改进方向】');
    for (const l of fixes) {
      parts.push(`  - ${l.effectiveFixes.join('；')}`);
    }
  }

  if (parts.length === 0) return '';

  let text = parts.join('\n');

  // 限制在 500 字以内
  if (text.length > 500) text = text.slice(0, 497) + '...';

  return `\n\n【同类章节写作经验（从历史评估中学习）】\n${text}`;
}
