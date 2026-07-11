/**
 * @novel-eval/shared — 共享类型
 *
 * eval 和 writer 包都会用到的类型：引擎配置、计费、章节基础结构、
 * 角色画像（评估→写作数据流的交接类型）、小说元信息。
 */

// ─── token / 费用 ─────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costRmb: number;
  model: string;
  durationMs: number;
}

// ─── 引擎配置 ─────────────────────────────────────────────────────

export interface EngineConfig {
  baseUrl: string;
  model: string;
  maxBudgetRmb: number;
  perChapterMaxBudgetRmb: number;
}

// ─── 小说元信息（CLI intake）──────────────────────────────────────

export interface NovelMetadata {
  genre: string;
  targetAudience: string;
  platform?: string;
}

// ─── 章节基础结构 ────────────────────────────────────────────────

export type ChapterKind = 'main' | 'extra' | 'prologue' | 'epilogue';

/**
 * 章节的最小共享结构。eval 的 Chapter 继承它并加 summary/excerpts 等；
 * writer 的 DraftChapter 也会基于它扩展。两个包通过 BaseChapter 互操作。
 */
export interface BaseChapter {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  kind: ChapterKind;
}

/** 分章器产出的章节输入（id/title/content，不含 LLM 产出的字段）*/
export interface ChapterInput {
  id: string;
  title: string;
  content: string;
}

// ─── 角色画像（评估→写作数据流的关键交接类型）─────────────────
//
// 评估的 R1 人物归一化产出与写作的"角色卡"本质同构。
// 放在 shared 让评估产物可直接喂给写作当 bible 冷启动数据。

export interface CharacterRelationship {
  target: string;
  type: string;
  strength: number;
}

export interface CharacterProfile {
  name: string;
  aliases?: string[];
  role: string;
  arc?: string;
  firstAppearance?: string;
  keyChapters?: string[];
  relationships?: CharacterRelationship[];
}
