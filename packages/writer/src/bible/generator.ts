/**
 * Bible 生成器 — 雪花法 4 步编排
 *
 * 流程：core_seed → character_dynamics → character_state(2.5) → world_building → plot_architecture
 *
 * 持久化：写入 story_bible_revision draft（逐步 checkpoint）。
 * 批准由 WriterApplication 的显式 approval path 完成。
 */
import { randomUUID } from 'node:crypto';

import type { AIAgentAdapter } from '@novel-eval/shared';
import { callWithValidation, type SchemaSpec } from '@novel-eval/shared';

import type { DB } from '../db.ts';
import { projectId } from '../domain/ids.ts';
import { PlanningRepository, type BibleDocument } from '../repositories/planning-repository.ts';
import { getRuntimeConfig } from '../runtime-config.ts';
import type {
  Bible, CoreSeed, CharacterDynamic, CharacterDynamicsResult,
  CharacterState, WorldBuilding, PlotArchitecture,
} from './types.ts';
import {
  coreSeedPrompt, characterDynamicsPrompt, characterStatePrompt,
  worldBuildingPrompt, plotArchitecturePrompt,
} from './prompts.ts';

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

interface BibleCheckpoint {
  coreSeed?: CoreSeed;
  characterDynamics?: CharacterDynamic[];
  characterState?: CharacterState;
  worldBuilding?: WorldBuilding;
  plotArchitecture?: PlotArchitecture;
  fullText?: string;
}

function asDocument(value: BibleCheckpoint): BibleDocument {
  return value as unknown as BibleDocument;
}

function readCheckpoint(doc: BibleDocument): BibleCheckpoint {
  return doc as unknown as BibleCheckpoint;
}

function loadPartial(
  planning: PlanningRepository,
  id: ReturnType<typeof projectId>,
): { revisionId: string; partial: BibleCheckpoint } {
  const active = planning.getActiveBibleForProject(id);
  if (active) {
    return { revisionId: active.id, partial: readCheckpoint(active.bible) };
  }
  const draft = planning.getDraftBibleForProject(id);
  if (draft) {
    return { revisionId: draft.id, partial: readCheckpoint(draft.bible) };
  }
  return { revisionId: randomUUID(), partial: {} };
}

function saveCheckpoint(
  planning: PlanningRepository,
  id: ReturnType<typeof projectId>,
  revisionId: string,
  partial: BibleCheckpoint,
  compiledText: string,
): void {
  planning.saveDraftBibleRevision({
    id: revisionId,
    projectId: id,
    revisionNumber: 1,
    status: 'draft',
    bible: asDocument(partial),
    compiledText,
    createdAt: new Date().toISOString(),
  });
}

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
  bibleRevisionId: string;
  usage: { inputTokens: number; outputTokens: number; costRmb: number };
}

export async function generateBible(opts: GenerateBibleOptions): Promise<GenerateBibleResult> {
  const { engine, db, topic, genre, audience, onProgress } = opts;
  const id = projectId(opts.projectId);
  const planning = new PlanningRepository(db);
  const totalUsage = { inputTokens: 0, outputTokens: 0, costRmb: 0 };

  const existingActive = planning.getActiveBibleForProject(id);
  if (existingActive && existingActive.status === 'approved') {
    const checkpoint = readCheckpoint(existingActive.bible);
    if (
      checkpoint.coreSeed
      && checkpoint.characterDynamics
      && checkpoint.characterState
      && checkpoint.worldBuilding
      && checkpoint.plotArchitecture
      && checkpoint.fullText
    ) {
      onProgress?.('done', 'Bible 已存在，跳过');
      return {
        bible: {
          coreSeed: checkpoint.coreSeed,
          characterDynamics: checkpoint.characterDynamics,
          characterState: checkpoint.characterState,
          worldBuilding: checkpoint.worldBuilding,
          plotArchitecture: checkpoint.plotArchitecture,
          fullText: checkpoint.fullText,
        },
        bibleRevisionId: existingActive.id,
        usage: totalUsage,
      };
    }
  }

  const loaded = loadPartial(planning, id);
  let revisionId = loaded.revisionId;
  const partial = loaded.partial;

  let coreSeed = partial.coreSeed;
  if (!coreSeed) {
    onProgress?.('core_seed', '生成核心种子...');
    const res = await callWithValidation<CoreSeed>(engine, coreSeedPrompt(topic, genre, audience), {
      systemPrompt: '你是资深小说策划。只输出 JSON。',
      temperature: getRuntimeConfig().generation.temperatures.bible,
      maxTokens: 400,
      timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
      schema: CORE_SEED_SCHEMA,
      maxAttempts: 3,
    });
    if (!res.ok || !res.data) throw new Error(`核心种子生成失败：${res.errors.join('; ')}`);
    coreSeed = res.data;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    partial.coreSeed = coreSeed;
    saveCheckpoint(planning, id, revisionId, partial, coreSeed.premise);
    onProgress?.('core_seed', `✓ ${coreSeed.premise.slice(0, 40)}...`);
  } else {
    onProgress?.('core_seed', '（已完成，跳过）');
  }

  let characterDynamics = partial.characterDynamics;
  if (!characterDynamics) {
    onProgress?.('character_dynamics', '生成角色动力学...');
    const res = await callWithValidation<CharacterDynamicsResult>(
      engine,
      characterDynamicsPrompt(JSON.stringify(coreSeed), audience),
      {
        systemPrompt: '你是角色设计大师。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.bible,
        maxTokens: 3000,
        timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
        schema: CHARACTER_DYNAMICS_SCHEMA,
        maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) throw new Error(`角色动力学生成失败：${res.errors.join('; ')}`);
    characterDynamics = res.data.characters;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    partial.characterDynamics = characterDynamics;
    saveCheckpoint(planning, id, revisionId, partial, coreSeed.premise);
    onProgress?.('character_dynamics', `✓ ${characterDynamics.length} 个角色`);
  } else {
    onProgress?.('character_dynamics', '（已完成，跳过）');
  }

  let characterState = partial.characterState;
  if (!characterState) {
    onProgress?.('character_state', '生成初始角色状态树...');
    const res = await callWithValidation<CharacterState>(
      engine,
      characterStatePrompt(JSON.stringify({ characters: characterDynamics })),
      {
        systemPrompt: '你是小说连贯性编辑。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.bible,
        maxTokens: 2500,
        timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
        schema: CHARACTER_STATE_SCHEMA,
        maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) throw new Error(`角色状态生成失败：${res.errors.join('; ')}`);
    characterState = res.data;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    partial.characterState = characterState;
    saveCheckpoint(planning, id, revisionId, partial, coreSeed.premise);
    onProgress?.('character_state', `✓ ${characterState.characters.length} 个状态`);
  } else {
    onProgress?.('character_state', '（已完成，跳过）');
  }

  let worldBuilding = partial.worldBuilding;
  if (!worldBuilding) {
    onProgress?.('world_building', '生成世界观...');
    const res = await callWithValidation<WorldBuilding>(
      engine,
      worldBuildingPrompt(JSON.stringify(coreSeed), genre),
      {
        systemPrompt: '你是世界观架构师。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.bible,
        maxTokens: 3000,
        timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
        schema: WORLD_BUILDING_SCHEMA,
        maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) throw new Error(`世界观生成失败：${res.errors.join('; ')}`);
    worldBuilding = res.data;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    partial.worldBuilding = worldBuilding;
    saveCheckpoint(planning, id, revisionId, partial, coreSeed.premise);
    onProgress?.('world_building', '✓ 三维度完成');
  } else {
    onProgress?.('world_building', '（已完成，跳过）');
  }

  let plotArchitecture = partial.plotArchitecture;
  if (!plotArchitecture) {
    onProgress?.('plot_architecture', '生成三幕式情节架构...');
    const res = await callWithValidation<PlotArchitecture>(
      engine,
      plotArchitecturePrompt(
        JSON.stringify(coreSeed),
        JSON.stringify({ characters: characterDynamics }),
        JSON.stringify(worldBuilding),
      ),
      {
        systemPrompt: '你是情节架构大师。只输出 JSON。',
        temperature: getRuntimeConfig().generation.temperatures.bible,
        maxTokens: 4000,
        timeoutMs: getRuntimeConfig().generation.timeouts.bibleMs,
        schema: PLOT_SCHEMA,
        maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) throw new Error(`情节架构生成失败：${res.errors.join('; ')}`);
    plotArchitecture = res.data;
    totalUsage.inputTokens += res.totalUsage.inputTokens;
    totalUsage.outputTokens += res.totalUsage.outputTokens;
    totalUsage.costRmb += res.totalUsage.costRmb;
    partial.plotArchitecture = plotArchitecture;
    saveCheckpoint(planning, id, revisionId, partial, coreSeed.premise);
    onProgress?.('plot_architecture', `✓ 三幕 + ${plotArchitecture.foreshadows.length} 伏笔`);
  } else {
    onProgress?.('plot_architecture', '（已完成，跳过）');
  }

  const fullText = buildBibleFullText({
    topic,
    genre,
    audience,
    coreSeed,
    characterDynamics,
    characterState,
    worldBuilding,
    plotArchitecture,
  });
  partial.fullText = fullText;
  saveCheckpoint(planning, id, revisionId, partial, fullText);

  const draft = planning.getBibleRevision(revisionId);
  if (!draft) throw new Error(`Bible draft ${revisionId} missing`);

  const bible: Bible = {
    coreSeed,
    characterDynamics,
    characterState,
    worldBuilding,
    plotArchitecture,
    fullText,
  };
  onProgress?.('done', 'Bible draft 生成完成，等待批准');
  return { bible, bibleRevisionId: revisionId, usage: totalUsage };
}

export function buildBibleFullText(parts: {
  topic: string;
  genre: string;
  audience: string;
  coreSeed: CoreSeed;
  characterDynamics: CharacterDynamic[];
  characterState: CharacterState;
  worldBuilding: WorldBuilding;
  plotArchitecture: PlotArchitecture;
}): string {
  const {
    topic, genre, audience, coreSeed, characterDynamics, characterState, worldBuilding, plotArchitecture,
  } = parts;
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
