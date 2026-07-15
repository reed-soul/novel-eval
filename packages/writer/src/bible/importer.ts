/**
 * Bible 导入器 — 双模式写作的「规格模式」入口
 *
 * 设计意图：
 *   原有 `generateBible`（雪花法）服务「只有一句话/一个想法」的创作者——
 *   AI 从 topic 自由发散出角色/世界观/情节。
 *
 *   但对于「已有完整设定/大纲」的创作者（资深作者、已有设计文档的人），
 *   雪花法会偏离其意图：coreSeed 的一句话压缩在第二步就丢掉了原始设定，
 *   AI 自由发挥反而把"无人作恶"改成"反派阴谋"、把"无意识AI"改成"觉醒AI"。
 *
 *   本模块提供另一条路：直接把创作者的结构化 bible JSON 写入数据库，
 *   跳过 AI 发散。后续的 outline / chapter 生成照常工作——它们读到的
 *   `fullText` 就是创作者锁定的设定，不会走样。
 *
 *   双模式共存：
 *     - write init      → 雪花法自动生成（小白/只有一句话的人）
 *     - write import-bible → 导入结构化设定（资深/已有大纲的人）
 *
 * 数据流：用户提供 bible JSON 文件 → 校验 schema → 写 bible 表 → 拼接 fullText。
 */
import type { DB } from '../db.ts';
import type {
  Bible, CoreSeed, CharacterDynamic, CharacterState,
  WorldBuilding, PlotArchitecture,
} from './types.ts';
import { buildBibleFullText } from './generator.ts';

// ─── 输入 schema（与雪花法产出结构一致，但允许创作者精确控制）────────

export interface ImportBibleInput {
  /** 故事一句话核心种子（可由创作者自行撰写，不强制套公式）*/
  coreSeed: { premise: string };
  /** 3-6 个角色，结构与 characterDynamics 一致 */
  characterDynamics: CharacterDynamic[];
  /** 角色初始状态（可选；不传则按 characterDynamics 生成空骨架）*/
  characterState?: { characters: { name: string; items?: string[]; abilities?: string[]; status: string; relationships?: string[]; events?: string[] }[] };
  /** 世界观三维度 */
  worldBuilding: WorldBuilding;
  /** 三幕式情节架构 + 伏笔 */
  plotArchitecture: PlotArchitecture;
}

// ─── 校验 ────────────────────────────────────────────────────────

class BibleImportError extends Error {
  constructor(message: string) { super(message); this.name = 'BibleImportError'; }
}

function validate(input: ImportBibleInput): void {
  const errs: string[] = [];
  if (!input.coreSeed?.premise || input.coreSeed.premise.length < 5) errs.push('coreSeed.premise 至少 5 字');
  if (!Array.isArray(input.characterDynamics) || input.characterDynamics.length < 3 || input.characterDynamics.length > 6) errs.push('characterDynamics 需 3-6 个角色');
  if (!input.worldBuilding?.physical || !input.worldBuilding?.social || !input.worldBuilding?.metaphorical) errs.push('worldBuilding 需含 physical/social/metaphorical');
  if (!input.plotArchitecture?.act1 || !input.plotArchitecture?.act2 || !input.plotArchitecture?.act3) errs.push('plotArchitecture 需含 act1/act2/act3');
  if (!Array.isArray(input.plotArchitecture?.foreshadows) || input.plotArchitecture.foreshadows.length < 1) errs.push('plotArchitecture.foreshadows 至少 1 个');
  if (errs.length) throw new BibleImportError('Bible 校验失败：\n  - ' + errs.join('\n  - '));
}

// ─── 主入口 ──────────────────────────────────────────────────────

export interface ImportBibleOptions {
  db: DB;
  projectId: string;
  /** 创作者的结构化 bible JSON */
  input: ImportBibleInput;
  /** 基本信息（拼入 fullText 顶部）*/
  topic: string;
  genre: string;
  audience: string;
}

export interface ImportBibleResult {
  bible: Bible;
}

/**
 * 导入结构化 bible，跳过 AI 雪花法。
 * 幂等：若该项目已有 bible 数据，会被覆盖（配合断点重导）。
 */
export function importBible(opts: ImportBibleOptions): ImportBibleResult {
  const { db, projectId, input, topic, genre, audience } = opts;
  validate(input);

  // 补全 characterState（若创作者未提供，按 characterDynamics 生成空骨架）
  const characterState: CharacterState = input.characterState
    ? { characters: input.characterState.characters.map((c) => ({
        name: c.name,
        items: c.items ?? [],
        abilities: c.abilities ?? [],
        status: c.status,
        relationships: c.relationships ?? [],
        events: c.events ?? [],
      })) }
    : { characters: input.characterDynamics.map((c) => ({
        name: c.name, items: [], abilities: [], status: '（待设定）', relationships: [], events: [],
      })) };

  const fullText = buildBibleFullText({
    topic, genre, audience,
    coreSeed: input.coreSeed as CoreSeed,
    characterDynamics: input.characterDynamics,
    characterState,
    worldBuilding: input.worldBuilding,
    plotArchitecture: input.plotArchitecture,
  });

  const bible: Bible = {
    coreSeed: input.coreSeed as CoreSeed,
    characterDynamics: input.characterDynamics,
    characterState,
    worldBuilding: input.worldBuilding,
    plotArchitecture: input.plotArchitecture,
    fullText,
  };

  // 写入（upsert，覆盖已有）
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO bible (project_id, created_at, updated_at) VALUES (?, ?, ?)`,
  ).run(projectId, now, now);
  db.prepare(
    `UPDATE bible SET
       core_seed = ?, character_dynamics = ?, character_state = ?,
       world_building = ?, plot_architecture = ?, full_text = ?, updated_at = ?
     WHERE project_id = ?`,
  ).run(
    JSON.stringify(bible.coreSeed),
    JSON.stringify({ characters: bible.characterDynamics }),
    JSON.stringify(bible.characterState),
    JSON.stringify(bible.worldBuilding),
    JSON.stringify(bible.plotArchitecture),
    bible.fullText,
    now,
    projectId,
  );

  return { bible };
}
