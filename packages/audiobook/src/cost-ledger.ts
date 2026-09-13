/**
 * 成本台账（M2）：每次构建按集落账（data/audiobook/cost-ledger.json），书/集层聚合展示。
 * 估费口径与 Web 确认条一致：edge 免费；volcengine ≈¥2/万字；其余按 volcengine 同价保守估。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface CostEntry {
  ts: string;              // ISO 时间
  projectId: string;
  bookTitle: string;
  ep: number;
  engine: string;
  chars: number;           // 本章范围正文字数
  durationMs: number;      // 成片时长
  estCostYuan: number;     // 估算成本（元）
  isDraft: boolean;        // --chars 试产
}

const MAX_ENTRIES = 1000;

export function costLedgerPath(dataDir: string): string {
  return join(dataDir, 'audiobook', 'cost-ledger.json');
}

export function estimateCostYuan(engine: string, chars: number): number {
  if (engine === 'edge') return 0;
  return Math.round((chars / 10000) * 2 * 10) / 10;
}

export function loadCostLedger(dataDir: string): CostEntry[] {
  const file = costLedgerPath(dataDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as CostEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 追加一条（新条目在前，封顶 MAX_ENTRIES 防无限增长） */
export function appendCostEntry(dataDir: string, entry: CostEntry): void {
  const file = costLedgerPath(dataDir);
  mkdirSync(resolve(file, '..'), { recursive: true });
  const all = loadCostLedger(dataDir);
  writeFileSync(file, JSON.stringify([entry, ...all].slice(0, MAX_ENTRIES), null, 1), 'utf-8');
}

export interface BookCostSummary {
  entries: number;
  episodes: number;
  totalChars: number;
  totalDurationMs: number;
  totalEstCostYuan: number;
  byEngine: { engine: string; chars: number; estCostYuan: number }[];
}

export function bookCostSummary(entries: CostEntry[]): BookCostSummary {
  const byEngineMap = new Map<string, { engine: string; chars: number; estCostYuan: number }>();
  for (const e of entries) {
    const cur = byEngineMap.get(e.engine) ?? { engine: e.engine, chars: 0, estCostYuan: 0 };
    cur.chars += e.chars;
    cur.estCostYuan += e.estCostYuan;
    byEngineMap.set(e.engine, cur);
  }
  return {
    entries: entries.length,
    episodes: new Set(entries.map((e) => e.ep)).size,
    totalChars: entries.reduce((a, e) => a + e.chars, 0),
    totalDurationMs: entries.reduce((a, e) => a + e.durationMs, 0),
    totalEstCostYuan: Math.round(entries.reduce((a, e) => a + e.estCostYuan, 0) * 10) / 10,
    byEngine: [...byEngineMap.values()].map((x) => ({ ...x, estCostYuan: Math.round(x.estCostYuan * 10) / 10 })),
  };
}
