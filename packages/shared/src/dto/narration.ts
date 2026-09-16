/**
 * 解说视频（narration_video）数据契约 —— M1，2026-09-16
 * 三层架构（评审定稿）：Script → Act/Sequence → Beat → Sentence。
 * - Sentence 是字幕与 TTS 缓存的最小单元（15–30 字，句号/问号切分）
 * - Beat 是画面单元（一张分镜图）与音效钩的载体；durationMs 由 S4 合成后回填
 * - Sequence 是叙事序列（4–6 分钟解谜闭环），独立生成调用，防注意力塌陷
 * - 时钟唯一来源：sentence.durationMs 累加 → beat.startMs（S6 渲染不许再用槽位量化）
 */

export type BeatKind = 'hook' | 'turn' | 'peak' | 'close' | 'coda';
/** 分镜景别：物证/环境/背影/手部优先，正脸是稀缺帧（≤10%） */
export type ShotKind = 'prop' | 'env' | 'back' | 'hands' | 'face';

export interface NarrationQuote {
  /** 引语音色轨：elderly_warm=温和中老年女声（母亲遗言/录音笔）等 */
  voice: string;
  /** 音色轨混音滤镜：recorder=老式录音机带通、phone=电话窄带 */
  eq?: 'recorder' | 'phone';
}

export interface NarrationSentence {
  id: string;                 // 如 s0001
  text: string;               // 口播句，15–30 字
  quote?: NarrationQuote;     // 有则走证物音色轨（换人声+EQ）
  /** S4 回填 */
  durationMs?: number;
}

export interface BeatVisual {
  prompt: string;             // 英文生图词（物证/氛围特写，禁图解文字）
  characterIds: string[];     // 出场角色（→定妆照参考图）；空=无人物
  shot: ShotKind;
}

export interface NarrationBeat {
  id: string;                 // 如 b001
  kind: BeatKind;
  sentences: NarrationSentence[];
  visual: BeatVisual;
  sfxHint?: 'stinger' | 'heartbeat' | 'tick' | 'none';
  /** S4 回填：本 beat 音频净时长（不含 beat 间隙） */
  durationMs?: number;
  /** S4 回填：全片起点 */
  startMs?: number;
}

export interface NarrationSequence {
  id: string;                 // 如 q1
  actId: string;              // 所属幕 a1|a2|a3
  title: string;              // 营销化标题（YouTube 章节直接复用）
  /** 解谜闭环标签，进度锚点「疑点 n/N」用 */
  puzzleLabel?: string;
  /** 张力预算（口播字数），由 P2 序列规划分配 */
  budgetChars: number;
  beats: NarrationBeat[];
}

export interface NarrationAct {
  id: string;                 // a1|a2|a3
  name: string;               // 悬念建构 / 破局博弈 / 情感清算
}

export interface CharacterRef {
  id: string;                 // 如 c-zhouhuilan
  name: string;
  /** 定妆照文件（相对 narration 产物根）；未生成则 undefined */
  sheetFile?: string;
  /** approved 才允许 S5 批量分镜渲染（工程评审 P0 状态门） */
  status: 'draft' | 'approved';
  /** 英文角色卡（与 audiobook sceneCharacters 同源描述） */
  promptDesc: string;
}

export interface NarrationScript {
  bookId: string;
  bookTitle: string;
  targetMinutes: number;
  generatedAt: string;
  /** 冷开场三选一备选（物证落差法），取 hookBeat.sentences 首句为准 */
  coldOpenAlternates?: string[];
  characters: CharacterRef[];
  acts: NarrationAct[];
  sequences: NarrationSequence[];
}

/** S3 结构门结果 */
export interface StructureGateReport {
  passed: boolean;
  totalChars: number;
  estimatedMinutes: number;   // 按 4.4 字/秒估
  issues: string[];
  stats: {
    beats: number;
    hookInFirst: boolean;     // 首 beat 是否 hook
    peakCount: number;
    longestStretchWithoutTurnS: number;  // 无 turn/peak 的最长预估秒数
    faceShotRatio: number;
  };
}

/** S3 因果稽核门结果（LLP 三元组比对） */
export interface CausalGateReport {
  passed: boolean;
  triplesChecked: number;
  violations: Array<{ beatId: string; claim: string; problem: string }>;
}

export function flattenSentences(script: NarrationScript): NarrationSentence[] {
  return script.sequences.flatMap((q) => q.beats.flatMap((b) => b.sentences));
}

export function flattenBeats(script: NarrationScript): NarrationBeat[] {
  return script.sequences.flatMap((q) => q.beats);
}

export function scriptTotalChars(script: NarrationScript): number {
  return flattenSentences(script).reduce((n, s) => n + s.text.length, 0);
}
