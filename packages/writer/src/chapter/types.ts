/**
 * Chapter 类型定义 — M2 章节蓝图 + 正文 + 叙事状态
 */

// ─── 蓝图中间产物：段落（beat）──────────────────────────────────
// 第一层拆分（幕→段落）的产物，强制节奏骨架。

export type BeatPosition = '铺垫' | '推进' | '转折' | '高潮';

export interface Beat {
  position: BeatPosition;
  goal: string;            // 该段落要达成什么
  foreshadows: string[];   // 该段涉及的伏笔操作（"埋设X"/"回收Y"）
  tension: number;         // 张力 0-10
}

// ─── 章节蓝图（chapter_outline 表的 TS 映射）──────────────────────

export interface ChapterOutline {
  id: string;
  projectId: string;
  number: number;
  title: string;
  act: 1 | 2 | 3;           // 所属幕
  beat: string;             // 所属段落定位（铺垫/推进/转折/高潮）
  role: string;             // 本章在结构中的定位
  purpose: string;          // 本章核心作用
  suspenseLevel: number;    // 悬念密度 0-10
  foreshadowing: string;    // 本章伏笔操作（"埋设：X / 回收：Y"）
  twistLevel: number;       // 认知颠覆 0-10
  summary: string;          // 本章梗概（写章节时用）
  status: 'pending' | 'written';
}

// ─── 章节正文（chapter 表的 TS 映射）──────────────────────────────

export interface ChapterContent {
  id: string;
  projectId: string;
  number: number;
  outlineId: string;
  title: string;
  content: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── 叙事状态（narrative_state 表的 TS 映射）─────────────────────
//
// 分层 summary 设计（不妥协方案，三个机制各管一类质量）：
//   macroSummary  —— 宏观主线，每章重写，始终在场（管全局伏笔/逻辑一致）
//   openForeshadows —— 未回收伏笔清单，显式追踪（防长篇后期遗忘）
//   arcSummaries  —— 每 10 章固化一份卷摘要（防早期信息被反复压缩丢失）

export interface ArcSummary {
  upToChapter: number;   // 该卷摘要覆盖到第几章
  content: string;       // 摘要正文（≤800 字）
}

export interface OpenForeshadow {
  description: string;   // 伏笔内容
  setupChapter: number;  // 埋设章号
  resolveChapter: number | null;  // 回收章号（null=未回收）
}

export interface NarrativeState {
  projectId: string;
  macroSummary: string;           // 宏观主线（≤1500 字）
  openForeshadows: OpenForeshadow[];
  arcSummaries: ArcSummary[];
  upToChapter: number;            // 已更新到第几章
  updatedAt: string;
}
