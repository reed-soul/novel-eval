/**
 * 有声书登记文件（registry.json）——管线拓扑与制作预设的唯一真相源（M0）。
 *
 * 分工铁律（PLAN-2.0 §3，终审定案）：
 *   registry.json       = 管线拓扑 / 分集索引 / 制作预设（engine/group/skipVideo）
 *   projects/<书名>.json = 发音表 + 音色班底（内容工程，永不分合）
 *
 * 集状态一律从文件派生（禁独立状态机）；"下一集/补洞"推断只读本表。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export interface EpisodeRecord {
  /** 本集覆盖的章节号（含端点） */
  chapters: [number, number];
  ep: number;
  /** 试产集：不参与"下一集"推断与就绪判定 */
  isDraft?: boolean;
  createdAt?: string;
}

export interface BookRegistry {
  /** 产物根（仓库相对，如 dist/derivatives/<slug>/audiobook） */
  outRoot: string;
  /** 场景图目录（仓库相对）；null=纯音频模式 */
  scenesRoot: string | null;
  presets: {
    engine: 'edge' | 'volcengine' | 'minimax';
    chaptersPerEpisode: number;
    /** true=纯音频（无场景图或用户选择）；影响就绪判定与徽章 */
    skipVideo: boolean;
  };
  episodes: Record<string, EpisodeRecord>;
}

export interface Registry {
  [bookId: string]: BookRegistry;
}

export function registryPath(dataDir: string): string {
  return resolve(dataDir, 'registry.json');
}

export function loadRegistry(dataDir: string): Registry {
  const file = registryPath(dataDir);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Registry;
  } catch {
    return {};
  }
}

export function saveRegistry(dataDir: string, reg: Registry): void {
  const file = registryPath(dataDir);
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(reg, null, 1), 'utf-8');
}

/** 建线（终审 P0：新书第一屏的唯一写入路径）——原子写登记+建产物目录 */
export function setupBookLine(
  dataDir: string,
  bookId: string,
  opts: { slug: string; engine?: BookRegistry['presets']['engine']; chaptersPerEpisode?: number; skipVideo?: boolean },
): BookRegistry {
  const reg = loadRegistry(dataDir);
  const existing = reg[bookId];
  const rec: BookRegistry = existing ?? {
    outRoot: `dist/derivatives/${opts.slug}/audiobook`,
    scenesRoot: null,
    presets: {
      engine: opts.engine ?? 'volcengine',
      chaptersPerEpisode: opts.chaptersPerEpisode ?? 3,
      skipVideo: opts.skipVideo ?? true,
    },
    episodes: {},
  };
  // 允许建线时覆盖预设（未传参保留原值）
  if (opts.engine) rec.presets.engine = opts.engine;
  if (opts.chaptersPerEpisode) rec.presets.chaptersPerEpisode = opts.chaptersPerEpisode;
  if (opts.skipVideo !== undefined) rec.presets.skipVideo = opts.skipVideo;
  reg[bookId] = rec;
  saveRegistry(dataDir, reg);
  return rec;
}

/** 登记一集（构建启动时写入；重制同集覆盖） */
export function recordEpisode(dataDir: string, bookId: string, ep: number, chapters: [number, number], isDraft = false): void {
  const reg = loadRegistry(dataDir);
  const rec = reg[bookId];
  if (!rec) throw new Error(`书 ${bookId} 尚未建线（registry 无记录）`);
  rec.episodes[`ep${String(ep).padStart(2, '0')}`] = { ep, chapters, isDraft, createdAt: new Date().toISOString() };
  saveRegistry(dataDir, reg);
}

/** 推断下一集（终审 P0-1/P0-9）：非 draft 的最大集 +1；章节=已消费最大章 +1 顺延 */
export function nextEpisodeHint(rec: BookRegistry): { ep: number; chapters: [number, number] } {
  const eps = Object.values(rec.episodes).filter((e) => !e.isDraft);
  const maxEp = eps.reduce((a, e) => Math.max(a, e.ep), 0);
  const maxCh = eps.reduce((a, e) => Math.max(a, e.chapters[1]), 0);
  const g = rec.presets.chaptersPerEpisode;
  return { ep: maxEp + 1, chapters: [maxCh + 1, maxCh + g] };
}

/** 就绪判定（从文件派生，PLAN §3 公式）：skipVideo 时看 mp3，否则看 mp4 */
export function episodeReady(hasMp3: boolean, hasMp4: boolean, skipVideo: boolean): boolean {
  return skipVideo ? hasMp3 : hasMp4;
}
