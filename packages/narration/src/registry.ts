/**
 * 解说视频登记与成本台账（M3）。
 * 登记文件 = data/narration/registry.json（产物根唯一真相，对齐 audiobook 先例）；
 * 成本台账 = data/narration/cost-ledger.json，多维 schema（PLAN §4：llm/tts/image 分列）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── 登记 ─────────────────────────────────────────────────────────

export interface NarrationLine {
  /** 产物根（仓库相对，如 dist/derivatives/<slug>/narration） */
  outRoot: string;
  presets: {
    /** 解说目标时长（分钟）——决定序列预算与口播字数 */
    minutes: number;
    /** TTS 引擎（解说音色以 volcengine 悬疑解说为佳） */
    engine: 'volcengine' | 'edge';
  };
  createdAt: string;
}

export type NarrationRegistry = Record<string, NarrationLine>;

export function narrationRegistryPath(dataDir: string): string {
  return join(dataDir, 'narration', 'registry.json');
}

export function loadNarrationRegistry(dataDir: string): NarrationRegistry {
  const file = narrationRegistryPath(dataDir);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as NarrationRegistry;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 建线/更新预设（原子写；缺省字段保留旧值） */
export function setupNarrationLine(
  dataDir: string,
  bookId: string,
  init: { outRoot: string; minutes?: number; engine?: 'volcengine' | 'edge' },
): NarrationLine {
  const reg = loadNarrationRegistry(dataDir);
  const prev = reg[bookId];
  const rec: NarrationLine = {
    outRoot: prev?.outRoot ?? init.outRoot,
    presets: {
      minutes: init.minutes ?? prev?.presets.minutes ?? 15,
      engine: init.engine ?? prev?.presets.engine ?? 'volcengine',
    },
    createdAt: prev?.createdAt ?? new Date().toISOString(),
  };
  reg[bookId] = rec;
  const file = narrationRegistryPath(dataDir);
  mkdirSync(resolve(file, '..'), { recursive: true });
  // 临时文件+rename 原子落盘：读侧不会撞到半个 JSON（writeFileSync 直写做不到）
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(reg, null, 1), 'utf-8');
  renameSync(tmp, file);
  return rec;
}

// ── 成本台账（多维）─────────────────────────────────────────────

export interface NarrationCostEntry {
  ts: string;                 // ISO 时间
  projectId: string;
  bookTitle: string;
  stage: 'script' | 'audio' | 'sheets' | 'scenes' | 'render';
  llmCalls: number;           // LLM 调用次数（文案四阶段）
  ttsChars: number;           // 口播+引语合成字数
  images: number;             // 生图张数（定妆照+分镜）
  durationMs: number;         // 产物时长（音轨/成片；其余阶段 0）
  /** 估算成本（元，保守口径）：llm≈¥0.1/次；tts≈¥2/万字（对齐 audiobook）；image≈¥0.15/张 */
  cost: { llm: number; tts: number; image: number };
}

const MAX_ENTRIES = 1000;

/** 单价常量（展示口径，改动只在此处） */
export const NARRATION_UNIT_COST = { llmPerCall: 0.1, ttsPer10kChars: 2, imagePerPiece: 0.15 };

export function estimateNarrationCost(p: { llmCalls: number; ttsChars: number; images: number }): { llm: number; tts: number; image: number } {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    llm: round1(p.llmCalls * NARRATION_UNIT_COST.llmPerCall),
    tts: round1((p.ttsChars / 10000) * NARRATION_UNIT_COST.ttsPer10kChars),
    image: round1(p.images * NARRATION_UNIT_COST.imagePerPiece),
  };
}

export function narrationCostLedgerPath(dataDir: string): string {
  return join(dataDir, 'narration', 'cost-ledger.json');
}

export function loadNarrationCost(dataDir: string): NarrationCostEntry[] {
  const file = narrationCostLedgerPath(dataDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as NarrationCostEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendNarrationCost(dataDir: string, entry: NarrationCostEntry): void {
  const file = narrationCostLedgerPath(dataDir);
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify([entry, ...loadNarrationCost(dataDir)].slice(0, MAX_ENTRIES), null, 1), 'utf-8');
}

export interface NarrationCostSummary {
  entries: number;
  llmCalls: number;
  ttsChars: number;
  images: number;
  totalCostYuan: number;
  byStage: { stage: NarrationCostEntry['stage']; entries: number; costYuan: number }[];
}

export function narrationCostSummary(entries: NarrationCostEntry[]): NarrationCostSummary {
  const byStage = new Map<NarrationCostEntry['stage'], { stage: NarrationCostEntry['stage']; entries: number; costYuan: number }>();
  let llmCalls = 0, ttsChars = 0, images = 0, total = 0;
  for (const e of entries) {
    const c = e.cost.llm + e.cost.tts + e.cost.image;
    llmCalls += e.llmCalls; ttsChars += e.ttsChars; images += e.images; total += c;
    const s = byStage.get(e.stage) ?? { stage: e.stage, entries: 0, costYuan: 0 };
    s.entries += 1; s.costYuan = Math.round((s.costYuan + c) * 10) / 10;
    byStage.set(e.stage, s);
  }
  return {
    entries: entries.length, llmCalls, ttsChars, images,
    totalCostYuan: Math.round(total * 10) / 10,
    byStage: [...byStage.values()],
  };
}
