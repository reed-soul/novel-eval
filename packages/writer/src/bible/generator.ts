/**
 * Bible 生成器 — 雪花法 4 步编排
 *
 * 流程：core_seed → character_dynamics → character_state(2.5) → world_building → plot_architecture
 *
 * 关键设计：
 *   1. 有意的上下文隔离（照搬 AI_NovelGenerator）：
 *      - character_dynamics 只看 core_seed
 *      - world_building 只看 core_seed（不看角色，避免污染）
 *      - plot_architecture 汇集全部（唯一汇集点）
 *   2. JSON Schema 强约束 + callWithValidation（容错解析/校验/重试）
 *   3. Checkpoint：每步完成即写 SQLite，断了能续（重跑时跳过已完成步）
 *   4. 顺序执行（步骤间有依赖，不能并发）
 */
import type { AIAgentAdapter } from '@novel-eval/shared';
import { callWithValidation, type SchemaSpec } from '@novel-eval/shared';
import type { DB } from '../db.ts';
import type {
  Bible, CoreSeed, CharacterDynamic, CharacterDynamicsResult,
  CharacterState, WorldBuilding, PlotArchitecture,
} from './types.ts';
import {
  coreSeedPrompt, characterDynamicsPrompt, characterStatePrompt,
  worldBuildingPrompt, plotArchitecturePrompt,
} from './prompts.ts';

import { getRuntimeConfig } from '../runtime-config.ts';

// ─── 各步的 schema 约束 ───────────────────────────────────────────

const CORE_SEED_SCHEMA: SchemaSpec = {
  premise: { type: 'string', min: 15, max: 200, required: true },
};

const relationshipSpec = {
  type: 'object' as const, fields: {
    target: { type: 'string' as const, required: true },
    type: { type: 'string' as const, required: true },
    note: { type: 'string' as const, required: true },
  },
};
const characterSpec = {
  type: 'object' as const, fields: {
    name: { type: 'string' as const, required: true },
    role: { type: 'string' as const, required: true },
    background: { type: 'string' as const, min: 10, required: true },
    secret: { type: 'string' as const, min: 5, required: true },
    drives: {
      type: 'object' as const, required: true, fields: {
        surface: { type: 'string' as const, required: true },
        deep: { type: 'string' as const, required: true },
        soul: { type: 'string' as const, required: true },
      },
    },
    arc: {
      type: 'object' as const, required: true, fields: {
        start: { type: 'string' as const, required: true },
        trigger: { type: 'string' as const, required: true },
        shift: { type: 'string' as const, required: true },
        end: { type: 'string' as const, required: true },
      },
    },
    relationships: { type: 'array' as const, min: 1, required: true, itemSpec: relationshipSpec },
  },
};
const CHARACTER_DYNAMICS_SCHEMA: SchemaSpec = {
  characters: { type: 'array', min: 3, max: 6, required: true, itemSpec: characterSpec },
};

const stateEntrySpec = {
  type: 'object' as const, fields: {
    name: { type: 'string' as const, required: true },
    items: { type: 'array' as const, itemSpec: { type: 'string' as const } },
    abilities: { type: 'array' as const, itemSpec: { type: 'string' as const } },
    status: { type: 'string' as const, required: true },
    relationships: { type: 'array' as const, itemSpec: { type: 'string' as const } },
    events: { type: 'array' as const, itemSpec: { type: 'string' as const } },
  },
};
const CHARACTER_STATE_SCHEMA: SchemaSpec = {
  characters: { type: 'array', min: 1, required: true, itemSpec: stateEntrySpec },
};

const dimensionSpec = {
  type: 'object' as const, fields: {
    elements: { type: 'array' as const, min: 3, required: true, itemSpec: { type: 'string' as const } },
    tensions: { type: 'array' as const, min: 3, required: true, itemSpec: { type: 'string' as const } },
  },
};
const WORLD_BUILDING_SCHEMA: SchemaSpec = {
  physical: { type: 'object', required: true, fields: dimensionSpec.fields },
  social: { type: 'object', required: true, fields: dimensionSpec.fields },
  metaphorical: { type: 'object', required: true, fields: dimensionSpec.fields },
};

const actSpec = {
  type: 'object' as const, required: true, fields: {
    setup: { type: 'string' as const, min: 10, required: true },
    conflicts: { type: 'array' as const, min: 2, required: true, itemSpec: { type: 'string' as const } },
    climax: { type: 'string' as const, min: 10, required: true },
  },
};
const foreshadowSpec = {
  type: 'object' as const, fields: {
    description: { type: 'string' as const, min: 10, required: true },
    setupAct: { type: 'number' as const, min: 1, max: 3, integer: true, required: true },
    resolveAct: { type: 'number' as const, min: 1, max: 3, integer: true, required: true },
  },
};
const PLOT_SCHEMA: SchemaSpec = {
  act1: actSpec,
  act2: actSpec,
  act3: actSpec,
  foreshadows: { type: 'array', min: 3, required: true, itemSpec: foreshadowSpec },
};

// ─── 持久化（checkpoint）─────────────────────────────────────────

interface BibleRow {
  project_id: string;
  core_seed: string | null;
  character_dynamics: string | null;
  character_state: string | null;
  world_building: string | null;
  plot_architecture: string | null;
  full_text: string | null;
}

/** 读取已完成的步（断点续传）*/
function loadPartial(db: DB, projectId: string): Partial<Bible> & { hasAny: boolean } {
  const row = db.prepare('SELECT * FROM bible WHERE project_id = ?').get(projectId) as BibleRow | undefined;
  if (!row) return { hasAny: false };
  const partial: Partial<Bible> = {};
  if (row.core_seed) partial.coreSeed = JSON.parse(row.core_seed) as CoreSeed;
  if (row.character_dynamics) {
    const r = JSON.parse(row.character_dynamics) as CharacterDynamicsResult;
    partial.characterDynamics = r.characters;
  }
  if (row.character_state) partial.characterState = JSON.parse(row.character_state) as CharacterState;
  if (row.world_building) partial.worldBuilding = JSON.parse(row.world_building) as WorldBuilding;
  if (row.plot_architecture) partial.plotArchitecture = JSON.parse(row.plot_architecture) as PlotArchitecture;
  return { ...partial, hasAny: Object.keys(partial).length > 0 };
}

/** 写入单步结果（upsert）*/
function saveStep(db: DB, projectId: string, fields: Partial<Record<keyof BibleRow, string>>): void {
  const now = new Date().toISOString();
  const cols = Object.keys(fields);
  if (cols.length === 0) return;
  // 确保 bible 行存在
  db.prepare(
    `INSERT OR IGNORE INTO bible (project_id, created_at, updated_at) VALUES (?, ?, ?)`,
  ).run(projectId, now, now);
  const setClause = cols.map((c) => `${c} = ?`).join(', ');
  const values = cols.map((c) => (fields as Record<string, string>)[c]);
  db.prepare(
    `UPDATE bible SET ${setClause}, updated_at = ? WHERE project_id = ?`,
  ).run(...values, now, projectId);
}

// ─── 主入口 ──────────────────────────────────────────────────────

export interface GenerateBibleOptions {
  engine: AIAgentAdapter;
  db: DB;
  projectId: string;
  topic: string;
  genre: string;
  audience: string;
  onProgress?: (step: string, msg: string) => void;
}

export interface GenerateBibleResult {
  bible: Bible;
  /** 各步耗时与 token（供计费展示）*/
  usage: { inputTokens: number; outputTokens: number; costRmb: number };
}

export async function generateBible(opts: GenerateBibleOptions): Promise<GenerateBibleResult> {
  const { engine, db, projectId, topic, genre, audience, onProgress } = opts;
  const totalUsage = { inputTokens: 0, outputTokens: 0, costRmb: 0 };
  const partial = loadPartial(db, projectId);

  // ─── Step 1: core_seed ──────────────────────────────────────────
  let coreSeed = partial.coreSeed;
  if (!coreSeed) {
    onProgress?.('core_seed', '生成核心种子...');
    const res = await callWithValidation<CoreSeed>(engine, coreSeedPrompt(topic, genre, audience), {
      systemPrompt: '你是资深小说策划。只输出 JSON。',
      temperature: getRuntimeConfig().generation.temperatures.bible, maxTokens: 400, timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
      schema: CORE_SEED_SCHEMA, maxAttempts: 3,
    });
    if (!res.ok || !res.data) throw new Error(`核心种子生成失败：${res.errors.join('; ')}`);
    coreSeed = res.data;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    saveStep(db, projectId, { core_seed: JSON.stringify(coreSeed) });
    onProgress?.('core_seed', `✓ ${coreSeed.premise.slice(0, 40)}...`);
  } else {
    onProgress?.('core_seed', '（已完成，跳过）');
  }

  // ─── Step 2: character_dynamics（只看 core_seed）────────────────
  let characterDynamics = partial.characterDynamics;
  if (!characterDynamics) {
    onProgress?.('character_dynamics', '生成角色动力学...');
    const res = await callWithValidation<CharacterDynamicsResult>(
      engine, characterDynamicsPrompt(JSON.stringify(coreSeed), audience),
      {
        systemPrompt: '你是角色设计大师。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.bible, maxTokens: 3000, timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
        schema: CHARACTER_DYNAMICS_SCHEMA, maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) throw new Error(`角色动力学生成失败：${res.errors.join('; ')}`);
    characterDynamics = res.data.characters;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    // 存完整的 {characters:[...]} 结构（character_state 步骤要用）
    saveStep(db, projectId, { character_dynamics: JSON.stringify({ characters: characterDynamics }) });
    onProgress?.('character_dynamics', `✓ ${characterDynamics.length} 个角色`);
  } else {
    onProgress?.('character_dynamics', '（已完成，跳过）');
  }

  // ─── Step 2.5: character_state（看 character_dynamics）──────────
  let characterState = partial.characterState;
  if (!characterState) {
    onProgress?.('character_state', '生成初始角色状态树...');
    const res = await callWithValidation<CharacterState>(
      engine, characterStatePrompt(JSON.stringify({ characters: characterDynamics })),
      {
        systemPrompt: '你是小说连贯性编辑。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.bible, maxTokens: 2500, timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
        schema: CHARACTER_STATE_SCHEMA, maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) throw new Error(`角色状态生成失败：${res.errors.join('; ')}`);
    characterState = res.data;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    saveStep(db, projectId, { character_state: JSON.stringify(characterState) });
    onProgress?.('character_state', `✓ ${characterState.characters.length} 个状态`);
  } else {
    onProgress?.('character_state', '（已完成，跳过）');
  }

  // ─── Step 3: world_building（只看 core_seed，隔离角色信息）──────
  let worldBuilding = partial.worldBuilding;
  if (!worldBuilding) {
    onProgress?.('world_building', '生成世界观...');
    const res = await callWithValidation<WorldBuilding>(
      engine, worldBuildingPrompt(JSON.stringify(coreSeed), genre),
      {
        systemPrompt: '你是世界观架构师。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.bible, maxTokens: 3000, timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
        schema: WORLD_BUILDING_SCHEMA, maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) throw new Error(`世界观生成失败：${res.errors.join('; ')}`);
    worldBuilding = res.data;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    saveStep(db, projectId, { world_building: JSON.stringify(worldBuilding) });
    onProgress?.('world_building', '✓ 三维度完成');
  } else {
    onProgress?.('world_building', '（已完成，跳过）');
  }

  // ─── Step 4: plot_architecture（汇集全部）──────────────────────
  let plotArchitecture = partial.plotArchitecture;
  if (!plotArchitecture) {
    onProgress?.('plot_architecture', '生成三幕式情节架构...');
    const res = await callWithValidation<PlotArchitecture>(
      engine, plotArchitecturePrompt(
        JSON.stringify(coreSeed),
        JSON.stringify({ characters: characterDynamics }),
        JSON.stringify(worldBuilding),
      ),
      {
        systemPrompt: '你是情节架构大师。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.bible, maxTokens: 4000, timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
        schema: PLOT_SCHEMA, maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) throw new Error(`情节架构生成失败：${res.errors.join('; ')}`);
    plotArchitecture = res.data;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    saveStep(db, projectId, { plot_architecture: JSON.stringify(plotArchitecture) });
    onProgress?.('plot_architecture', `✓ 三幕 + ${plotArchitecture.foreshadows.length} 伏笔`);
  } else {
    onProgress?.('plot_architecture', '（已完成，跳过）');
  }

  // ─── 拼接 full_text（M2 单章生成的「设定」输入）────────────────
  const fullText = buildBibleFullText({
    topic, genre, audience,
    coreSeed, characterDynamics, characterState, worldBuilding, plotArchitecture,
  });
  saveStep(db, projectId, { full_text: fullText });

  const bible: Bible = {
    coreSeed, characterDynamics, characterState, worldBuilding, plotArchitecture, fullText,
  };
  onProgress?.('done', `Bible 生成完成`);
  return { bible, usage: totalUsage };
}

// ─── full_text 拼接（M2 单章生成时作为「设定」注入）──────────────

export function buildBibleFullText(parts: {
  topic: string; genre: string; audience: string;
  coreSeed: CoreSeed;
  characterDynamics: CharacterDynamic[];
  characterState: CharacterState;
  worldBuilding: WorldBuilding;
  plotArchitecture: PlotArchitecture;
}): string {
  const { topic, genre, audience, coreSeed, characterDynamics, characterState, worldBuilding, plotArchitecture } = parts;
  const charLines = characterDynamics.map((c) =>
    `  - ${c.name}（${c.role}）：${c.background}\n    秘密：${c.secret}\n    驱动：表层「${c.drives.surface}」/深层「${c.drives.deep}」/灵魂「${c.drives.soul}」\n    弧光：${c.arc.start} →（${c.arc.trigger}）→ ${c.arc.shift} → ${c.arc.end}\n    关系：${c.relationships.map((r) => `${r.target}(${r.type})`).join('，')}`,
  ).join('\n');
  const stateLines = characterState.characters.map((s) =>
    `  ${s.name}：[${s.items.join('、')}] 能力[${s.abilities.join('、')}] 状态：${s.status}`,
  ).join('\n');
  const wb = (label: string, dim: { elements: string[]; tensions: string[] }) =>
    `  ${label}：元素[${dim.elements.join('；')}] 张力[${dim.tensions.join('；')}]`;
  const plot = (label: string, act: { setup: string; conflicts: string[]; climax: string }) =>
    `  ${label}：${act.setup}\n    转折：${act.conflicts.join('；')}\n    高潮：${act.climax}`;
  const foreshadows = plotArchitecture.foreshadows.map((f) =>
    `  - ${f.description}（埋第${f.setupAct}幕 → 收第${f.resolveAct}幕）`,
  ).join('\n');

  return `# 小说设定

## 0. 基本信息
主题：${topic}
类型：${genre}
受众：${audience}

## 1. 核心种子
${coreSeed.premise}

## 2. 角色动力学
${charLines}

## 3. 角色初始状态
${stateLines}

## 4. 世界观
${wb('物理', worldBuilding.physical)}
${wb('社会', worldBuilding.social)}
${wb('隐喻', worldBuilding.metaphorical)}

## 5. 三幕式情节架构
${plot('第一幕（触发）', plotArchitecture.act1)}
${plot('第二幕（对抗）', plotArchitecture.act2)}
${plot('第三幕（解决）', plotArchitecture.act3)}

## 6. 伏笔
${foreshadows}`;
}
