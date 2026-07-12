/**
 * 防重复检测 — 纯算法，零 LLM 成本
 *
 * 两层检测：
 *   1. 章内重复：k-shingle（8 字 gram）的重复占比——抓"同一章里反复用相同短语/句式"
 *   2. 跨章重复：本章 vs 最近 N 章的 Jaccard 相似度——抓"和前几章大段雷同"
 *
 * 阈值（可配）：
 *   章内 >15% 或 Jaccard >0.25 → mild（进 revise，把 hotspots 反馈给 LLM）
 *   章内 >30% 或 Jaccard >0.5 → severe（直接 block，不浪费 revise 配额）
 */

export interface RepetitionReport {
  /** 章内重复率（0-1）：重复 shingle 占比 */
  withinChapter: number;
  /** 跨章 Jaccard 相似度（0-1）：本章 vs 最近章节合并文本 */
  crossChapter: number;
  /** 重复片段示例（revise 反馈用，最多 5 条）*/
  hotspots: string[];
  /** 判定：ok 通过 / mild 需 revise / severe 直接 block */
  verdict: 'ok' | 'mild' | 'severe';
}

const SHINGLE_SIZE = 8;
const WITHIN_MILD = 0.15;
const WITHIN_SEVERE = 0.30;
const CROSS_MILD = 0.25;
const CROSS_SEVERE = 0.50;

/** 把文本切成 k-shingle 集合（连续 k 个字符为一组，去空白）*/
function shingles(text: string, k: number = SHINGLE_SIZE): Set<string> {
  const clean = text.replace(/\s+/g, '');
  const set = new Set<string>();
  for (let i = 0; i + k <= clean.length; i++) {
    set.add(clean.slice(i, i + k));
  }
  return set;
}

/** Jaccard 相似度：|A∩B| / |A∪B| */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  // 遍历较小的集合求交集
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const s of small) {
    if (large.has(s)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 找章内重复的 hotspots：出现 ≥3 次的 shingle 还原成可读片段 */
function findHotspots(text: string, k: number = SHINGLE_SIZE): string[] {
  const clean = text.replace(/\s+/g, '');
  const counts = new Map<string, number>();
  for (let i = 0; i + k <= clean.length; i++) {
    const s = clean.slice(i, i + k);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  // 取出现 ≥3 次的，按频率降序，最多 5 个
  const repeated = [...counts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s, c]) => `"${s}"（出现 ${c} 次）`);
  return repeated;
}

/**
 * 检测重复。
 * @param content 本章正文
 * @param recent 最近章节正文数组（用于跨章相似度）
 */
export function detectRepetition(content: string, recent: string[]): RepetitionReport {
  const contentShingles = shingles(content);

  // 章内重复率：出现 ≥2 次的 shingle 占比
  const counts = new Map<string, number>();
  for (const s of contentShingles) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  // 注意：Set 本身去重了，要算原始 shingle 里的重复，需要从原文重数
  const cleanContent = content.replace(/\s+/g, '');
  const totalShingles = Math.max(1, cleanContent.length - SHINGLE_SIZE + 1);
  let repeatedShingles = 0;
  const seen = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= cleanContent.length; i++) {
    const s = cleanContent.slice(i, i + SHINGLE_SIZE);
    if (seen.has(s)) {
      repeatedShingles++;
    } else {
      seen.add(s);
    }
  }
  const withinChapter = repeatedShingles / totalShingles;

  // 跨章 Jaccard：本章 vs 最近所有章合并文本
  const recentText = recent.filter((t) => t.trim().length > 0).join('');
  const crossChapter = recentText ? jaccard(contentShingles, shingles(recentText)) : 0;

  // hotspots
  const hotspots = findHotspots(content);

  // 判定
  const severe = withinChapter > WITHIN_SEVERE || crossChapter > CROSS_SEVERE;
  const mild = withinChapter > WITHIN_MILD || crossChapter > CROSS_MILD;
  const verdict: RepetitionReport['verdict'] = severe ? 'severe' : mild ? 'mild' : 'ok';

  return { withinChapter, crossChapter, hotspots, verdict };
}
