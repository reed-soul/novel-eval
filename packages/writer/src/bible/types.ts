/**
 * Bible 类型定义 — 雪花法 4 步的结构化产物
 *
 * 设计：用 JSON Schema 强约束 LLM 输出（区别于 AI_NovelGenerator 的自由文本），
 * 靠 shared 的 callWithValidation（容错解析+校验+重试）保证结构化。
 */

// ─── Step 1: 核心种子 ─────────────────────────────────────────────

/** 一句话核心：当[主角]遭遇[核心事件]，必须[关键行动]，否则[灾难后果] */
export interface CoreSeed {
  premise: string;
}

// ─── Step 2: 角色动力学 ───────────────────────────────────────────

/** 驱动力三角（表面追求 / 深层渴望 / 灵魂需求）*/
export interface CharacterDrives {
  surface: string;   // 表面追求（角色自己以为想要的）
  deep: string;      // 深层渴望（真正驱动他的）
  soul: string;      // 灵魂需求（需要学会的）
}

/** 角色弧光：初始 → 触发 → 认知失调 → 蜕变 → 最终 */
export interface CharacterArc {
  start: string;     // 初始状态
  trigger: string;   // 触发事件
  shift: string;     // 认知失调/转变节点
  end: string;       // 最终状态
}

export interface CharacterRelationship {
  target: string;    // 对象角色名
  type: string;      // 关系类型（对手/盟友/师徒/暗恋...）
  note: string;      // 关系说明（含冲突点）
}

export interface CharacterDynamic {
  name: string;
  role: string;      // 主角/反派/导师/...
  background: string;
  secret: string;    // 暗藏秘密/弱点
  drives: CharacterDrives;
  arc: CharacterArc;
  relationships: CharacterRelationship[];
}

export interface CharacterDynamicsResult {
  characters: CharacterDynamic[];
}

// ─── Step 2.5: 初始角色状态树 ────────────────────────────────────
//
// 这是「活文档」：M1 生成初始版，M2 起每章生成后 LLM 重写更新。
// 记录每个角色当前的 物品/能力/状态/关系/已触发事件。

export interface CharacterStateEntry {
  name: string;
  items: string[];        // 持有物品（含描述）
  abilities: string[];    // 能力/技能
  status: string;         // 身体/心理状态描述
  relationships: string[];// 当前主要关系
  events: string[];       // 已触发/加深的事件
}

export interface CharacterState {
  characters: CharacterStateEntry[];
}

// ─── Step 3: 世界观（三维度交织法）────────────────────────────────

export interface WorldDimension {
  elements: string[];   // 该维度的动态元素（≥3 个，可与角色决策互动）
  tensions: string[];   // 该维度的断层线/禁忌/命脉
}

export interface WorldBuilding {
  physical: WorldDimension;      // 物理维度（空间/时间轴/法则体系）
  social: WorldDimension;        // 社会维度（权力断层/文化禁忌/经济命脉）
  metaphorical: WorldDimension;  // 隐喻维度（视觉符号/环境映射/建筑暗示）
}

// ─── Step 4: 三幕式情节架构 ───────────────────────────────────────

export interface PlotAct {
  setup: string;       // 本幕铺垫/开端
  conflicts: string[]; // 关键转折点
  climax: string;      // 本幕高潮
}

export interface Foreshadow {
  description: string;  // 伏笔内容
  setupAct: number;     // 埋设在第几幕（1/2/3）
  resolveAct: number;   // 计划在第几幕回收
}

export interface PlotArchitecture {
  act1: PlotAct;        // 触发幕
  act2: PlotAct;        // 对抗幕
  act3: PlotAct;        // 解决幕
  foreshadows: Foreshadow[];
}

// ─── 完整 Bible（拼接产物）────────────────────────────────────────

export interface Bible {
  coreSeed: CoreSeed;
  characterDynamics: CharacterDynamic[];
  characterState: CharacterState;
  worldBuilding: WorldBuilding;
  plotArchitecture: PlotArchitecture;
  /** 拼接的完整文本（M2 单章生成的「设定」输入）*/
  fullText: string;
}
