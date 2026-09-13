/**
 * digest 登记（data/digest/registry.json）：与 audiobook registry 同形约定——
 * outRoot/制作预设/条目索引，是 DerivativeWork 双真形态抽象的第二个实例。
 * 分工铁律同款：registry 管管线拓扑与条目索引，内容工程配置永不混入。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nextUnitNumber, type DerivativeLine, type DerivativeUnit } from '@novel-eval/shared';

export interface DigestPiece {
  id: string;                    // p1, p2, …（短篇条目号）
  title: string;
  chapters: [number, number];
  targetWords: number;
  style: string;
  file: string;                  // 相对仓库根的产物路径
  words: number;
  createdAt: string;
}

export interface DigestBook {
  outRoot: string;               // dist/derivatives/<slug>/digest
  presets: { style: string; targetWords: number };
  pieces: Record<string, DigestPiece>;
}

export type DigestRegistry = Record<string, DigestBook>;

export function registryPath(dataDir: string): string {
  return join(dataDir, 'digest', 'registry.json');
}

export function loadDigestRegistry(dataDir: string): DigestRegistry {
  const file = registryPath(dataDir);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as DigestRegistry;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** 原子写（与 audiobook saveRegistry 同款：先写临时文件再替换） */
export function saveDigestRegistry(dataDir: string, reg: DigestRegistry): void {
  const file = registryPath(dataDir);
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(reg, null, 1), 'utf-8');
}

/** 开线（书首次生成短篇时登记；重复调用保留既有条目） */
export function setupDigestLine(
  dataDir: string,
  bookId: string,
  opts: { slug: string; style?: string; targetWords?: number },
): DigestBook {
  const reg = loadDigestRegistry(dataDir);
  const existing = reg[bookId];
  const rec: DigestBook = existing ?? {
    outRoot: `dist/derivatives/${opts.slug}/digest`,
    presets: { style: opts.style ?? 'faithful', targetWords: opts.targetWords ?? 3000 },
    pieces: {},
  };
  if (opts.style) rec.presets.style = opts.style;
  if (opts.targetWords) rec.presets.targetWords = opts.targetWords;
  reg[bookId] = rec;
  saveDigestRegistry(dataDir, reg);
  return rec;
}

/** 登记一个短篇条目（重生成同 id 覆盖） */
export function recordPiece(dataDir: string, bookId: string, piece: DigestPiece): void {
  const reg = loadDigestRegistry(dataDir);
  const rec = reg[bookId];
  if (!rec) throw new Error(`书 ${bookId} 尚未开启短篇线（digest registry 无记录）`);
  rec.pieces[piece.id] = piece;
  saveDigestRegistry(dataDir, reg);
}

/** 下一个条目号：已有最大 p{n} + 1（DerivativeWork 共用编号规则） */
export function nextPieceId(rec: DigestBook): string {
  return `p${nextUnitNumber(rec.pieces)}`;
}

/** 契约适配（DerivativeWork）：本包 registry 记录结构化满足衍生线形状 */
export function toDerivativeLine(rec: DigestBook): DerivativeLine<DigestBook['presets'], DigestPiece & DerivativeUnit> {
  return { outRoot: rec.outRoot, presets: rec.presets, units: rec.pieces };
}
