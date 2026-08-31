/**
 * 有声书 HTTP 路由 — M0 book 作用域版（PLAN-2.0 v3）
 *
 *   GET  /api/audiobook/books/:bookId          书的有声书状态（registry+集墙+下一集推断+建线判定）
 *   POST /api/audiobook/books/:bookId/setup    建线（登记文件原子写入+产物根创建；新书第一屏）
 *   GET  /api/audiobook/books/:bookId/ep/:n    集详情（媒体/场景图/台本/审听/物料/章节锚点）
 *   POST /api/audiobook/jobs                   构建/审听（bookId 驱动：参数从登记文件预设推断，
 *                                               仅暴露 chapters/epStart/clean 等少量覆盖项）
 *   GET  /api/audiobook/jobs/active|:id|:id/stream|cancel    （同前）
 *
 * v3/v4 版本概念已整体移除：产物根唯一真相 = data/audiobook/registry.json（按书登记），
 * 缩略图收进各产物根 thumbs/（消灭全局命名空间串台）。
 *
 * 安全：用户输入永不构成 fs 路径（bookId 只查 DB/registry，产物根由服务端写死）；
 * spawn 逐项白名单（禁前导 '-'）固定形状数组；媒体经 /media 静态服务。
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { EventEmitter } from 'node:events';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runPipeline } from '../lib/pipeline-spawn.ts';
import { getProject, type DB } from '@novel-eval/writer';
import {
  loadRegistry, setupBookLine, recordEpisode, nextEpisodeHint, episodeReady, loadChapters,
  type BookRegistry,
} from '@novel-eval/audiobook';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DATA_DIR = join(REPO_ROOT, 'data', 'audiobook');

// ── 媒体 URL（dist/ 下相对路径，逐段编码；经 /media 静态服务） ──
function mediaUrl(relUnderDist: string): string {
  return `/media/${relUnderDist.split('/').map(encodeURIComponent).join('/')}`;
}

// ── 书与产物根解析（唯一入口：registry；用户输入不构成路径） ──

function bookTitle(db: DB, bookId: string): string | null {
  const p = getProject(db, bookId);
  return p ? p.title : null;
}

function slugify(title: string): string {
  const s = title.replace(/[^\p{Script=Han}A-Za-z0-9_-]/gu, '').slice(0, 40);
  return s || 'book';
}

function registryRoot(rec: BookRegistry): string {
  const abs = resolve(REPO_ROOT, rec.outRoot);
  // 防御：登记的产物根必须落在仓库 dist/ 内（登记文件由服务端写入，此处双保险）
  const distAbs = join(REPO_ROOT, 'dist');
  if (abs !== distAbs && !abs.startsWith(distAbs + sep)) throw new Error('registry outRoot 越界');
  return abs;
}

// ── 集扫描与派生状态 ─────────────────────────────────────────

export interface EpisodeCard {
  ep: number;
  id: string;
  chapters: [number, number] | null;
  isDraft: boolean;
  title: string;
  durationMs: number | null;
  hasMp3: boolean;
  hasMp4: boolean;
  hasSrt: boolean;
  /** 从文件派生（禁独立状态机）：draft / building(有mp3无终稿且任务在跑，由前端叠加) /
   *  audio-ready / video-ready / audited（有审听报告且无 P0） */
  state: 'draft' | 'audio-ready' | 'video-ready' | 'audited';
  audited: boolean;
  qa: { ok: number; suspect: number; bad: number; missing: number; silent: number } | null;
  thumbnailUrl: string | null;
  /** 集内媒体相对路径（书产物根内，如 ep01/xxx.mp4） */
  videoUrl: string | null;
  audioUrl: string | null;
  srtUrl: string | null;
}

// 时长探测缓存（mtime 键控）
const durCache = new Map<string, { mtime: number; ms: number }>();
function probeDurationMs(file: string): number | null {
  const mtime = statSync(file).mtimeMs;
  const hit = durCache.get(file);
  if (hit && hit.mtime === mtime) return hit.ms;
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf-8' });
    const ms = Math.round(Number(out.trim()) * 1000);
    durCache.set(file, { mtime, ms });
    return ms;
  } catch {
    return null;
  }
}

function loadJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

interface UploadPlanItem {
  file: string; srt?: string; playlist?: string; title?: string; description?: string; tags?: string[];
}

function findEpisodePlan(root: string, epId: string): UploadPlanItem | null {
  const plan = loadJson<UploadPlanItem[]>(join(root, 'youtube-upload.json'));
  if (!Array.isArray(plan)) return null;
  return plan.find((p) => p.file?.includes(`/${epId}/`) || basename(dirname(p.file ?? '')) === epId) ?? null;
}

function episodeCards(root: string, rec: BookRegistry): EpisodeCard[] {
  const listenReport = loadJson<{ chapters?: { dir: string; counts: Record<string, number> }[] }>(join(root, 'listen-report.json'));
  const relOut = rec.outRoot.replace(/^dist\//, '');
  const cards: EpisodeCard[] = [];
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^ep(\d{1,2})$/.test(d.name)) continue;
    const epDir = join(root, d.name);
    const ep = Number(d.name.slice(2));
    const id = d.name;
    const media = readdirSync(epDir).filter((f) => /\.(mp4|mp3|srt)$/.test(f) && !/\.bak$/.test(f));
    const mp4 = media.find((f) => f.endsWith('.mp4'));
    const mp3 = media.find((f) => f.endsWith('.mp3'));
    const srt = media.find((f) => f.endsWith('.srt'));
    const plan = findEpisodePlan(root, id);
    const reg = rec.episodes[id];

    // 审听：本集各章 counts 汇总（报告 dir 为产物根内相对 "ep01/ch01"）
    let qa: EpisodeCard['qa'] = null;
    if (listenReport?.chapters) {
      const mine = listenReport.chapters.filter((ch) => ch.dir.startsWith(`${id}/`));
      if (mine.length) {
        qa = { ok: 0, suspect: 0, bad: 0, missing: 0, silent: 0 };
        for (const ch of mine) {
          qa.ok += ch.counts.ok ?? 0;
          qa.suspect += ch.counts.suspect ?? 0;
          qa.bad += ch.counts.bad ?? 0;
          qa.missing += ch.counts.missing ?? 0;
          qa.silent += ch.counts.silent ?? 0;
        }
      }
    }
    const hasMp3 = !!mp3;
    const hasMp4 = !!mp4;
    const ready = reg?.isDraft ? false : episodeReady(hasMp3, hasMp4, rec.presets.skipVideo);
    const audited = !!qa && qa.bad + qa.missing + qa.silent === 0;
    const state: EpisodeCard['state'] = audited ? 'audited' : ready ? (rec.presets.skipVideo ? 'audio-ready' : 'video-ready') : 'draft';

    // 缩略图：本产物根 thumbs/（M0 阻断6：收编命名空间，杜绝跨书串台）
    const thumbsDir = join(root, 'thumbs');
    const thumbUrl = (() => {
      if (!existsSync(thumbsDir)) return null;
      const hit = readdirSync(thumbsDir).find((f) => new RegExp(`^EP0*${ep}[-_－].*\\.(jpe?g|png)$`, 'i').test(f));
      return hit ? mediaUrl(`${relOut}/thumbs/${hit}`) : null;
    })();

    cards.push({
      ep, id,
      chapters: reg?.chapters ?? null,
      isDraft: reg?.isDraft ?? false,
      title: plan?.title ?? (mp4 ?? mp3 ?? '').replace(/\.[^.]+$/, '').replace(/_/g, ' '),
      durationMs: (mp4 || mp3) ? probeDurationMs(join(epDir, (mp4 ?? mp3) as string)) : null,
      hasMp3, hasMp4, hasSrt: !!srt,
      state, audited: !!qa, qa,
      thumbnailUrl: thumbUrl,
      videoUrl: mp4 ? mediaUrl(`${relOut}/${id}/${mp4}`) : null,
      audioUrl: mp3 ? mediaUrl(`${relOut}/${id}/${mp3}`) : null,
      srtUrl: srt ? mediaUrl(`${relOut}/${id}/${srt}`) : null,
    });
  }
  return cards.sort((a, b) => a.ep - b.ep);
}

// ── 串行 Job 执行器 ───────────────────────────────────────────

interface AbJob {
  id: string;
  action: 'build' | 'listen';
  bookId?: string;
  /** 构建成功后才写登记（取消/失败不留幽灵集——红队盲区9 同类） */
  pendingRecord?: { ep: number; chapters: [number, number]; isDraft: boolean };
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  args: string[];
  lines: { seq: number; text: string }[];
  startedAt: number;
  error?: string;
  emitter: EventEmitter;
  child: import('node:child_process').ChildProcess | null;
}

const jobs = new Map<string, AbJob>();
let currentJobId: string | null = null;

/** 逐项校验：白名单 + 禁前导'-'（杜绝把动态值当选项注入） */
function checked(v: unknown, pattern: RegExp, name: string, maxLen = 64): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v);
  if (s.length > maxLen || s.startsWith('-') || !pattern.test(s)) throw new Error(`参数 ${name} 非法`);
  return s;
}

function startJob(bookId?: string, pendingRecord?: AbJob['pendingRecord']): AbJob {
  const id = randomUUID().slice(0, 8);
  const pendingArgsFile = join(DATA_DIR, '.job-pending-args.json');
  const { child, argv } = runPipeline(pendingArgsFile, REPO_ROOT);
  const job: AbJob = {
    id, action: argv[1] === 'listen' ? 'listen' : 'build',
    bookId, pendingRecord,
    status: 'running', args: argv, lines: [],
    startedAt: Date.now(), emitter: new EventEmitter(), child: null,
  };
  jobs.set(id, job);
  currentJobId = id;
  job.child = child;
  let seq = 0;
  const feed = (chunk: Buffer | string) => {
    for (const line of String(chunk).split('\n')) {
      const text = line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
      if (!text.trim()) continue;
      seq += 1;
      job.lines.push({ seq, text });
      if (job.lines.length > 2000) job.lines.shift();
      job.emitter.emit('line', { seq, text });
    }
  };
  child.stdout?.on('data', feed);
  child.stderr?.on('data', feed);
  child.on('error', (err) => {
    job.status = 'failed';
    job.error = String(err);
    job.emitter.emit('done', { status: 'failed', error: job.error });
    currentJobId = null;
  });
  child.on('close', (code) => {
    job.status = code === 0 ? 'completed' : 'cancelled';
    job.error = code === 0 ? undefined : `退出码 ${code}`;
    // 构建成功才登记（取消/失败不留幽灵集）
    if (code === 0 && job.bookId && job.pendingRecord) {
      try {
        recordEpisode(DATA_DIR, job.bookId, job.pendingRecord.ep, job.pendingRecord.chapters, job.pendingRecord.isDraft);
      } catch { /* 登记失败不影响任务终态 */ }
    }
    job.emitter.emit('done', { status: job.status, code });
    currentJobId = null;
  });
  return job;
}

/** 待执行参数落盘（startJob 从盘回读 spawn）——白名单校验后的收口点 */
function stageJobArgs(childArgs: string[]): void {
  writeFileSync(join(DATA_DIR, '.job-pending-args.json'), JSON.stringify(childArgs), { mode: 0o600 });
}

// ── 路由 ─────────────────────────────────────────────────────

export function audiobookRouter(db: DB) {
  const app = new Hono();

  app.get('/books/:bookId', (c) => {
    const bookId = c.req.param('bookId');
    const title = bookTitle(db, bookId);
    if (!title) return c.json({ error: '未知书' }, 404);
    const reg = loadRegistry(DATA_DIR);
    const rec = reg[bookId];
    if (!rec) {
      // 未建线：建线卡的输入（前端据此渲染冷启动第一屏）。
      // 引擎建议按凭据在场降级：无 ARK key 时默认 edge，保证一键开启后真能出声
      const suggestedEngine = process.env.ARK_API_KEY ? 'volcengine' : 'edge';
      return c.json({ registered: false, bookId, title, suggestion: { engine: suggestedEngine, chaptersPerEpisode: 3, skipVideo: true } });
    }
    const root = registryRoot(rec);
    const episodes = existsSync(root) ? episodeCards(root, rec) : [];
    const scenesPresent = !!rec.scenesRoot && existsSync(resolve(REPO_ROOT, rec.scenesRoot));
    // 成本预估素材：下一集章节的实际字数（中文朗读 ≈400 字/分钟）
    const hint = nextEpisodeHint(rec);
    let chars = 0;
    try {
      const chs = loadChapters(db, bookId, `${hint.chapters[0]}-${hint.chapters[1]}`);
      chars = chs.reduce((a, c) => a + c.content.length, 0);
    } catch { /* 章节不足或范围越界时置 0（如已全书制作完） */ }
    return c.json({
      registered: true,
      bookId,
      title,
      presets: rec.presets,
      outRoot: rec.outRoot,
      scenesPresent,
      episodes,
      next: { ...hint, chars },
    });
  });

  app.post('/books/:bookId/setup', async (c) => {
    const bookId = c.req.param('bookId');
    const title = bookTitle(db, bookId);
    if (!title) return c.json({ error: '未知书' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    let engine: BookRegistry['presets']['engine'] | undefined;
    let chaptersPerEpisode: number | undefined;
    let skipVideo: boolean | undefined;
    if (body.engine !== undefined) {
      const e = checked(body.engine, /^(edge|volcengine|minimax)$/, 'engine');
      if (e) engine = e as BookRegistry['presets']['engine'];
    }
    if (body.chaptersPerEpisode !== undefined) {
      const g = checked(body.chaptersPerEpisode, /^[1-5]$/, 'chaptersPerEpisode');
      if (g) chaptersPerEpisode = Number(g);
    }
    if (typeof body.skipVideo === 'boolean') skipVideo = body.skipVideo;

    const rec = setupBookLine(DATA_DIR, bookId, {
      slug: slugify(title),
      engine: engine ?? (process.env.ARK_API_KEY ? 'volcengine' : 'edge'),
      chaptersPerEpisode,
      skipVideo,
    });
    // 产物根创建（M0 阻断3：第二条有声书线从产品内诞生的物理前提）
    const root = registryRoot(rec);
    mkdirSync(root, { recursive: true });
    if (rec.scenesRoot) {
      const scenesAbs = resolve(REPO_ROOT, rec.scenesRoot);
      const distAbs = join(REPO_ROOT, 'dist');
      if (scenesAbs !== distAbs && scenesAbs.startsWith(distAbs + sep)) mkdirSync(scenesAbs, { recursive: true });
    }
    return c.json({ ok: true, bookId, presets: rec.presets, outRoot: rec.outRoot }, 201);
  });

  app.get('/books/:bookId/ep/:ep', (c) => {
    const bookId = c.req.param('bookId');
    if (!bookTitle(db, bookId)) return c.json({ error: '未知书' }, 404);
    const rec = loadRegistry(DATA_DIR)[bookId];
    if (!rec) return c.json({ error: '该书尚未建线' }, 404);
    const root = registryRoot(rec);
    const relOut = rec.outRoot.replace(/^dist\//, '');
    const epNum = Number(c.req.param('ep'));
    if (!Number.isInteger(epNum) || epNum < 1 || epNum > 99) return c.json({ error: '非法集号' }, 422);
    const epId = `ep${String(epNum).padStart(2, '0')}`;
    const epDir = join(root, epId);
    if (!existsSync(epDir)) return c.json({ error: '未知集' }, 404);

    const cards = episodeCards(root, rec);
    const card = cards.find((e) => e.id === epId);
    if (!card) return c.json({ error: '集目录损坏' }, 422);
    const plan = findEpisodePlan(root, epId);
    const media = readdirSync(epDir).filter((f) => /\.(mp4|mp3|srt)$/.test(f) && !/\.bak$/.test(f));
    const mp4 = media.find((f) => f.endsWith('.mp4'));
    const mp3 = media.find((f) => f.endsWith('.mp3'));
    const srt = media.find((f) => f.endsWith('.srt'));

    const listenReport = loadJson<{ chapters: { dir: string; counts: Record<string, number>; worst: { id: string; verdict: string; cer: number; ref: string; hyp: string; startMs: number }[] }[] }>(join(root, 'listen-report.json'));
    const scripts: { pos: number; title: string; segments: { id: string; kind: string; speaker?: string; text: string; voice: string }[] }[] = [];
    const listen = { counts: { ok: 0, suspect: 0, bad: 0, missing: 0, silent: 0 }, worst: [] as { id: string; verdict: string; cer: number; ref: string; hyp: string; startMs: number }[] };
    for (const d of readdirSync(epDir, { withFileTypes: true })) {
      if (!d.isDirectory() || !/^ch(\d{1,2})$/.test(d.name)) continue;
      const script = loadJson<{ position: number; title: string; segments: { id: string; kind: string; speaker?: string; text: string; voice: string }[] }>(join(epDir, d.name, 'script.json'));
      if (script) scripts.push({ pos: script.position, title: script.title, segments: script.segments });
      const mine = listenReport?.chapters?.find((ch) => ch.dir === `${epId}/${d.name}`);
      if (mine) {
        listen.counts.ok += mine.counts.ok ?? 0;
        listen.counts.suspect += mine.counts.suspect ?? 0;
        listen.counts.bad += mine.counts.bad ?? 0;
        listen.counts.missing += mine.counts.missing ?? 0;
        listen.counts.silent += mine.counts.silent ?? 0;
        listen.worst.push(...(mine.worst ?? []).map((w) => ({ ...w, id: `${d.name}/${w.id}` })));
      }
    }
    scripts.sort((a, b) => a.pos - b.pos);
    listen.worst.sort((a, b) => b.cer - a.cer);

    // 场景图：登记 scenesRoot（书级；无则空）
    const images: { chapter: number; url: string; name: string }[] = [];
    const scenesAbs = rec.scenesRoot ? resolve(REPO_ROOT, rec.scenesRoot) : null;
    if (scenesAbs && existsSync(scenesAbs)) {
      const relScenes = rec.scenesRoot!.replace(/^dist\//, '');
      const chs = [...new Set(scripts.map((s) => s.pos))];
      const files = readdirSync(scenesAbs).filter((x) => /\.(jpe?g|png)$/i.test(x)).sort();
      for (const chp of chs) {
        for (const f of files.filter((x) => new RegExp(`^0*${chp}[-_.]`).test(x))) {
          images.push({ chapter: chp, url: mediaUrl(`${relScenes}/${f}`), name: f });
        }
      }
    }

    // 章节时间轴锚点（ep-concat.txt 为装配真相）
    const chapterStartsMs: { pos: number; startMs: number }[] = [];
    const concatFile = join(epDir, 'ep-concat.txt');
    if (existsSync(concatFile)) {
      let t = 0;
      for (const line of readFileSync(concatFile, 'utf-8').split('\n')) {
        const m = line.trim().match(/^file '(.+)'$/);
        if (!m) continue;
        const f = resolve(epDir, m[1]);
        if (!existsSync(f)) continue;
        const chMatch = f.match(/\/(ch\d{1,2})\/[^/]+\.mp3$/);
        if (chMatch) chapterStartsMs.push({ pos: Number(chMatch[1].slice(2)), startMs: t });
        t += probeDurationMs(f) ?? 0;
      }
    }

    return c.json({
      ...card,
      title: plan?.title ?? card.title,
      uploadJsonUrl: existsSync(join(root, 'youtube-upload.json'))
        ? mediaUrl(`${relOut}/youtube-upload.json`)
        : null,
      images,
      scripts,
      listen,
      chapterStartsMs,
      upload: plan ? { title: plan.title, description: plan.description, tags: plan.tags, playlist: plan.playlist } : null,
    });
  });

  app.post('/jobs', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (currentJobId && jobs.get(currentJobId)?.status === 'running') {
      return c.json({ error: '已有任务在跑（渲染必须串行），请稍候或先取消', jobId: currentJobId }, 409);
    }
    const bookIdRaw = checked(body.bookId, /^[\w-]{1,64}$/, 'bookId');
    if (!bookIdRaw) return c.json({ error: 'bookId 必填（按书制作）' }, 422);
    const bookId = bookIdRaw;
    const title = bookTitle(db, bookId);
    if (!title) return c.json({ error: '未知书' }, 404);
    const rec = loadRegistry(DATA_DIR)[bookId];
    if (!rec) return c.json({ error: '该书尚未建线，请先 setup' }, 422);
    const root = registryRoot(rec);
    if (!existsSync(root)) mkdirSync(root, { recursive: true });

    let job: AbJob;
    try {
      // 登记派生值同过白名单（双保险：registry 由服务端写入，此处防配置文件被手改）
      const outDir = checked(rec.outRoot, /^dist\/[\w/-]{3,80}$/, 'outRoot');
      const engine = checked(rec.presets.engine, /^(edge|volcengine|minimax)$/, 'engine');
      const groupN = checked(String(rec.presets.chaptersPerEpisode), /^[1-5]$/, 'group');
      if (!outDir || !engine || !groupN) throw new Error('作品预设非法（请检查 registry.json）');
      if (body.action === 'build') {
        // 覆盖项白名单（正则同步解禁：epStart 1-99，M0 阻断1 的 Web 侧）
        const epOverride = checked(body.epStart, /^[1-9]\d?$/, 'epStart');
        const chaptersOverride = checked(body.chapters, /^\d{1,3}(-\d{1,3})?$/, 'chapters');
        const chars = checked(body.chars, /^\d{2,6}$/, 'chars');
        const hint = nextEpisodeHint(rec);
        const ep = epOverride ? Number(epOverride) : hint.ep;
        const chapters = chaptersOverride ?? `${hint.chapters[0]}-${hint.chapters[1]}`;
        // 固定形状字面量数组：引擎/并章/输出根/场景图全部来自登记预设（用户不可注入）
        // --project 传 bookId（CLI 按 id 精确解析；书名可能含括号等 CLI 白名单外字符）
        const childArgs = [
          'audiobook', 'build',
          '--project', bookId,
          '--chapters', chapters,
          '--group', groupN,
          '--engine', engine,
          '--ep-start', String(ep),
          '--out', outDir,
        ];
        if (rec.scenesRoot && existsSync(resolve(REPO_ROOT, rec.scenesRoot))) {
          const scenesDir = checked(rec.scenesRoot, /^dist\/[\w/-]{3,80}$/, 'scenesRoot');
          if (scenesDir) childArgs.push('--cover-dir', scenesDir);
        } else {
          childArgs.push('--skip-video');
        }
        if (chars) childArgs.push('--chars', chars);
        if (body.clean === true) childArgs.push('--clean');
        stageJobArgs(childArgs);
        job = startJob(bookId, { ep, chapters: parseRange(chapters), isDraft: chars !== undefined });
      } else if (body.action === 'listen') {
        const ep = checked(body.ep, /^[1-9]\d?$/, 'ep');
        const model = checked(body.model, /^(tiny|base|small|medium|large|large-v2|large-v3|turbo)$/, 'model');
        const cer = checked(body.cer, /^0?\.\d{1,3}$/, 'cer');
        const childArgs = ['audiobook', 'listen', '--out', outDir];
        if (ep) childArgs.push('--ep', ep);
        if (model) childArgs.push('--model', model);
        if (cer) childArgs.push('--cer', cer);
        if (body.fix === true) childArgs.push('--fix');
        if (body.srt === true) childArgs.push('--srt');
        stageJobArgs(childArgs);
        job = startJob(bookId);
      } else {
        return c.json({ error: 'action 仅允许 build | listen' }, 422);
      }
    } catch (e) {
      return c.json({ error: (e as Error).message }, 422);
    }
    return c.json({ jobId: job.id, args: job.args }, 201);
  });

  app.get('/jobs/active', (c) => {
    if (currentJobId) {
      const j = jobs.get(currentJobId);
      if (j?.status === 'running') return c.json({ jobId: j.id, action: j.action, bookId: j.bookId, args: j.args, startedAt: j.startedAt });
    }
    return c.json(null);
  });

  app.get('/jobs/:id', (c) => {
    const j = jobs.get(c.req.param('id'));
    if (!j) return c.json({ error: '未知任务' }, 404);
    return c.json({ id: j.id, action: j.action, status: j.status, args: j.args, lines: j.lines.slice(-200), error: j.error });
  });

  app.get('/jobs/:id/stream', (c) => {
    const j = jobs.get(c.req.param('id'));
    if (!j) return c.json({ error: '未知任务' }, 404);
    return streamSSE(c, async (stream) => {
      let last = 0;
      const send = async (data: unknown, event?: string) => {
        await stream.writeSSE({ data: JSON.stringify(data), event });
      };
      for (const line of j.lines) {
        if (line.seq <= last) continue;
        last = line.seq;
        await send(line);
      }
      if (j.status !== 'running') {
        await send({ status: j.status, error: j.error }, 'done');
        return;
      }
      const onLine = async (line: { seq: number; text: string }) => {
        if (line.seq <= last) return;
        last = line.seq;
        await send(line);
      };
      let closed = false;
      const onDone = async (d: unknown) => {
        if (closed) return;
        closed = true;
        cleanup();
        await send(d, 'done');
      };
      const cleanup = () => {
        j.emitter.off('line', onLine);
        j.emitter.off('done', onDone);
      };
      j.emitter.on('line', onLine);
      j.emitter.on('done', onDone);
      stream.onAbort(cleanup);
      await new Promise<void>((r) => stream.onAbort(() => r()));
    });
  });

  app.post('/jobs/:id/cancel', (c) => {
    const j = jobs.get(c.req.param('id'));
    if (!j) return c.json({ error: '未知任务' }, 404);
    if (j.status !== 'running') return c.json({ status: j.status });
    j.child?.kill('SIGTERM');
    setTimeout(() => j.child?.kill('SIGKILL'), 4000);
    j.status = 'cancelled';
    j.emitter.emit('done', { status: 'cancelled' });
    currentJobId = null;
    return c.json({ status: 'cancelled' });
  });

  return app;
}

function parseRange(range: string): [number, number] {
  const [a, b] = range.split('-').map(Number);
  const hi = b ?? a;
  return [a, hi];
}

// SRT→VTT 与静态文件服务已由 /media + index.ts serveStatic 承担（不再有 /file 路由）
export { createReadStream as __stream };
