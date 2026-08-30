/**
 * 有声书工作台 HTTP 路由 — Web 端完整走通 audiobook 管线
 *
 *   GET  /api/audiobook/runs                       制作版本（dist/audiobook*）概览
 *   GET  /api/audiobook/runs/:run                  版本详情：集列表（缩略图/QA/缺件）+ 场景图分组
 *   GET  /api/audiobook/runs/:run/episodes/:ep     集详情：媒体/场景图/台本/审听/上传物料
 *   POST /api/audiobook/jobs                       启动 build/listen（严格白名单参数，串行）
 *   GET  /api/audiobook/jobs/active                进行中的任务
 *   GET  /api/audiobook/jobs/:id                   任务快照（含最近日志）
 *   GET  /api/audiobook/jobs/:id/stream            SSE 实时日志
 *   POST /api/audiobook/jobs/:id/cancel            取消
 *
 * 媒体/图片不经本路由发文件：index.ts 用 serveStatic 把仓库 dist/ 挂在
 * /media/*（穿越防护由库承担），本路由只产出 /media/… 的 URL（run 目录
 * 名 + 枚举出的文件名拼接，不触 fs 用户路径）。
 *
 * job 启动：逐项白名单校验（禁前导 '-'）后以固定形状的字面量数组传
 * spawn（不经 shell），cwd 锁仓库根；--out 仅接受已有制作版本目录名。
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// ── 制作版本根（数据扫描边界） ────────────────────────────────
const AUDIOBOOK_ROOTS = readdirSync(join(REPO_ROOT, 'dist'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^audiobook/.test(d.name))
  .map((d) => join(REPO_ROOT, 'dist', d.name))
  .filter((p) => existsSync(p));

const RUN_ROOTS_BY_ID: Record<string, string> = {};
for (const r of AUDIOBOOK_ROOTS) RUN_ROOTS_BY_ID[basename(r)] = r;

function runRoot(id: string): string | null {
  return RUN_ROOTS_BY_ID[id] ?? null;
}

/** /media 静态服务的 URL（dist/ 下相对路径，逐段编码） */
function mediaUrl(relUnderDist: string): string {
  return `/media/${relUnderDist.split('/').map(encodeURIComponent).join('/')}`;
}

// ── 数据模型与扫描 ───────────────────────────────────────────

export interface RunSummary {
  id: string;                 // 目录名（audiobook-v4）
  label: string;              // v4
  bookTitle: string;          // 从 youtube-upload.json 播放列表名挖
  episodeCount: number;
  sceneImageCount: number;
  hasListenReport: boolean;
  updatedAt: string;          // 最近文件 mtime
}

export interface EpisodeSummary {
  ep: number;                 // 1
  id: string;                 // ep01
  title: string;              // youtube 标题（无则从文件名挖）
  durationMs: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  hasSrt: boolean;
  chapters: { pos: number; title: string; segments: number; attributed: number }[];
  thumbnailUrl: string | null;  // /media/media-thumbs/EP0N-缩略图.jpg
  qa: { ok: number; suspect: number; bad: number; missing: number; silent: number } | null;
}

// 时长探测缓存（mtime 键控，避免每次请求都 ffprobe）
const durCache = new Map<string, { mtime: number; ms: number }>();
function probeDurationMs(file: string): number | null {
  if (!/\.mp(3|4)$/.test(file)) return null;
  const mtime = statSync(file).mtimeMs;
  const hit = durCache.get(file);
  if (hit && hit.mtime === mtime) return hit.ms;
  try {
    // 同步 ffprobe：仅集级文件（每版本 ≤5 个），量小
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
  const hit = plan.find((p) => p.file?.includes(`/${epId}/`) || basename(dirname(p.file ?? '')) === epId);
  return hit ?? null;
}

function listEpisodes(root: string): EpisodeSummary[] {
  const listenReport = loadJson<{ chapters?: { dir: string; counts: Record<string, number> }[] }>(join(root, 'listen-report.json'));
  const eps: EpisodeSummary[] = [];
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

    const chapters: EpisodeSummary['chapters'] = [];
    for (const cd of readdirSync(epDir, { withFileTypes: true })) {
      if (!cd.isDirectory() || !/^ch(\d{1,2})$/.test(cd.name)) continue;
      const script = loadJson<{ title?: string; position: number; segments: { kind: string; speaker?: string }[] }>(join(epDir, cd.name, 'script.json'));
      if (!script) continue;
      chapters.push({
        pos: script.position ?? Number(cd.name.slice(2)),
        title: script.title ?? cd.name,
        segments: script.segments.length,
        attributed: script.segments.filter((s) => s.kind === 'dialogue' && s.speaker).length,
      });
    }
    chapters.sort((a, b) => a.pos - b.pos);

    // 审听：本集各章 counts 汇总（报告里 dir 为 run 内相对路径 "ep01/ch01"）
    let qa: EpisodeSummary['qa'] = null;
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

    // 缩略图：dist/media-thumbs 软链（→ ~/Downloads/sentie-thumbnails）
    const thumbUrl = (() => {
      if (!existsSync(join(REPO_ROOT, 'dist', 'media-thumbs'))) return null;
      let names: string[];
      try {
        names = readdirSync(join(REPO_ROOT, 'dist', 'media-thumbs'));
      } catch {
        return null;
      }
      const hit = names.find((f) => new RegExp(`^EP0*${ep}[-_－].*\\.(jpe?g|png)$`, 'i').test(f));
      return hit ? mediaUrl(`media-thumbs/${hit}`) : null;
    })();

    const title = plan?.title
      ?? (mp4 ?? mp3 ?? '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    eps.push({
      ep, id, title,
      durationMs: mp4 || mp3 ? probeDurationMs(join(epDir, (mp4 ?? mp3) as string)) : null,
      hasVideo: !!mp4, hasAudio: !!mp3, hasSrt: !!srt,
      chapters, thumbnailUrl: thumbUrl, qa,
    });
  }
  return eps.sort((a, b) => a.ep - b.ep);
}

function newestMtime(root: string): string {
  let t = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      try {
        const st = statSync(p);
        if (st.mtimeMs > t) t = st.mtimeMs;
        if (e.isDirectory()) walk(p, depth + 1);
      } catch { /* 跳过不可读项 */ }
    }
  };
  walk(root, 0);
  return t ? new Date(t).toISOString() : new Date().toISOString();
}

function runSummaries(): RunSummary[] {
  const raw = AUDIOBOOK_ROOTS.map((root) => {
    const plan = loadJson<UploadPlanItem[]>(join(root, 'youtube-upload.json'));
    const bookTitle = plan?.find((p) => p.playlist)?.playlist?.replace(/^.*[｜|]\s*/, '') ?? '未命名作品';
    const scenesDir = join(root, 'scenes');
    const sceneImageCount = existsSync(scenesDir)
      ? readdirSync(scenesDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).length
      : 0;
    const label = basename(root).replace(/^audiobook(-)?/, '') || 'v1';
    return {
      id: basename(root), label, bookTitle,
      episodeCount: readdirSync(root).filter((d) => /^ep\d{1,2}$/.test(d)).length,
      sceneImageCount,
      hasListenReport: existsSync(join(root, 'listen-report.json')),
      updatedAt: newestMtime(root),
    };
  });
  // 场景图属于书不属于渲染版本：展示计数跨版本回退（v4 渲染、v3 存图 → 显示 75）；
  // 空版本过滤按原始计数判（回退计数不救活空 run）
  const fallbackScenes = [...raw].filter((r) => r.sceneImageCount > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.sceneImageCount ?? 0;
  return raw
    .filter((r) => r.episodeCount > 0 || r.sceneImageCount > 0)
    .map((r) => ({ ...r, sceneImageCount: r.sceneImageCount || fallbackScenes }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * 场景图根：场景图属于「书」不属于渲染版本——优先本版本 scenes/，
 * 没有则回退到最新有 scenes/ 的版本（如 v4 渲染、v3 存图）。
 * 注意以真实目录存在为准（runSummaries 的 sceneImageCount 是展示层回退值）。
 */
function scenesRootFor(runId: string): { runId: string; dir: string } | null {
  const own = runRoot(runId);
  if (own && existsSync(join(own, 'scenes'))) return { runId, dir: join(own, 'scenes') };
  for (const r of runSummaries()) {
    const rt = runRoot(r.id);
    if (rt && existsSync(join(rt, 'scenes'))) return { runId: r.id, dir: join(rt, 'scenes') };
  }
  return null;
}

// ── 串行 Job 执行器（build / listen） ─────────────────────────

interface AbJob {
  id: string;
  action: 'build' | 'listen';
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
function checked(v: unknown, pattern: RegExp, name: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v);
  if (s.length > 64 || s.startsWith('-') || !pattern.test(s)) throw new Error(`参数 ${name} 非法`);
  return s;
}

interface BuildOptions {
  project: string; chapters: string; group: string; chars?: string;
  engine: string; epStart?: string; out?: string; noVideo?: boolean;
}
interface ListenOptions {
  ep?: string; model?: string; cer?: string; out?: string; fix?: boolean; srt?: boolean;
}

function startJob(childArgs: string[], displayArgs: string[]): AbJob {
  const id = randomUUID().slice(0, 8);
  const job: AbJob = {
    id, action: childArgs[0] === 'listen' ? 'listen' : 'build',
    status: 'running', args: displayArgs, lines: [],
    startedAt: Date.now(), emitter: new EventEmitter(), child: null,
  };
  jobs.set(id, job);
  currentJobId = id;
  // 固定程序 + 逐项校验过的参数（数组不经 shell）；cwd 锁仓库根
  const child = spawn('pnpm', childArgs, { cwd: REPO_ROOT });
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
    job.emitter.emit('done', { status: job.status, code });
    currentJobId = null;
  });
  return job;
}

function startBuildJob(o: BuildOptions): AbJob {
  // 固定形状字面量数组：每个动态槽都经过 checked() 白名单（禁前导'-'）
  const childArgs = ['audiobook', 'build', '--project', o.project, '--chapters', o.chapters, '--group', o.group, '--engine', o.engine];
  if (o.chars) childArgs.push('--chars', o.chars);
  if (o.epStart) childArgs.push('--ep-start', o.epStart);
  if (o.out) childArgs.push('--out', `dist/${o.out}`);
  if (o.noVideo) childArgs.push('--skip-video');
  return startJob(childArgs, [...childArgs]);
}

function startListenJob(o: ListenOptions): AbJob {
  const childArgs = ['audiobook', 'listen'];
  if (o.ep) childArgs.push('--ep', o.ep);
  if (o.model) childArgs.push('--model', o.model);
  if (o.cer) childArgs.push('--cer', o.cer);
  if (o.out) childArgs.push('--out', `dist/${o.out}`);
  if (o.fix) childArgs.push('--fix');
  if (o.srt) childArgs.push('--srt');
  return startJob(childArgs, [...childArgs]);
}

function assertOutAllowed(out: string): void {
  if (!runRoot(out)) throw new Error('参数 --out 非法（需为已有制作版本目录名）');
}

// ── 路由 ─────────────────────────────────────────────────────

export const audiobookRouter = new Hono();

audiobookRouter.get('/runs', (c) => c.json(runSummaries()));

audiobookRouter.get('/runs/:run', (c) => {
  const root = runRoot(c.req.param('run'));
  if (!root) return c.json({ error: '未知制作版本' }, 404);
  const eps = listEpisodes(root);
  const scenes = scenesRootFor(c.req.param('run'));
  const sceneUrlsByChapter: Record<string, string[]> = {};
  if (scenes) {
    for (const f of readdirSync(scenes.dir).filter((x) => /\.(jpe?g|png)$/i.test(x)).sort()) {
      const key = f.replace(/^0*/, '').split(/[-_.]/)[0];
      (sceneUrlsByChapter[key] ??= []).push(mediaUrl(`${scenes.runId}/scenes/${f}`));
    }
  }
  const summary = runSummaries().find((r) => r.id === c.req.param('run'))!;
  return c.json({ ...summary, episodes: eps, sceneUrlsByChapter });
});

audiobookRouter.get('/runs/:run/episodes/:ep', (c) => {
  const root = runRoot(c.req.param('run'));
  if (!root) return c.json({ error: '未知制作版本' }, 404);
  const runId = basename(root);
  const epNum = Number(c.req.param('ep'));
  if (!Number.isInteger(epNum) || epNum < 1 || epNum > 99) return c.json({ error: '非法集号' }, 422);
  const epId = `ep${String(epNum).padStart(2, '0')}`;
  const epDir = join(root, epId);
  if (!existsSync(epDir)) return c.json({ error: '未知集' }, 404);

  const summary = listEpisodes(root).find((e) => e.id === epId);
  if (!summary) return c.json({ error: '集目录损坏' }, 422);
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

  // 场景图：本集覆盖的章 → scenes/NN-*.jpg（跨版本回退到有图的 run）
  const scenes = scenesRootFor(runId);
  const images: { chapter: number; url: string; name: string }[] = [];
  if (scenes) {
    const files = readdirSync(scenes.dir).filter((x) => /\.(jpe?g|png)$/i.test(x)).sort();
    for (const chp of summary.chapters) {
      for (const f of files.filter((x) => new RegExp(`^0*${chp.pos}[-_.]`).test(x))) {
        images.push({ chapter: chp.pos, url: mediaUrl(`${scenes.runId}/scenes/${f}`), name: f });
      }
    }
  }

  // 章节时间轴锚点：ep-concat.txt 是装配真相（冷开场+各章+静音的真实顺序与时长）
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
    ...summary,
    videoUrl: mp4 ? mediaUrl(`${runId}/${epId}/${mp4}`) : null,
    audioUrl: mp3 ? mediaUrl(`${runId}/${epId}/${mp3}`) : null,
    srtUrl: srt ? mediaUrl(`${runId}/${epId}/${srt}`) : null,
    images,
    scripts,
    listen,
    chapterStartsMs,
    upload: plan ? { title: plan.title, description: plan.description, tags: plan.tags, playlist: plan.playlist } : null,
  });
});

audiobookRouter.post('/jobs', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (currentJobId && jobs.get(currentJobId)?.status === 'running') {
    return c.json({ error: '已有任务在跑（渲染必须串行），请稍候或先取消', jobId: currentJobId }, 409);
  }
  let job: AbJob;
  try {
    if (body.action === 'build') {
      const project = checked(body.project, /^[\w\u4e00-\u9fff-]{1,64}$/, '--project');
      const chapters = checked(body.chapters, /^\d{1,3}(-\d{1,3})?$/, '--chapters');
      const group = checked(body.group, /^[1-5]$/, '--group');
      const engine = checked(body.engine, /^(edge|volcengine|minimax)$/, '--engine');
      const chars = checked(body.chars, /^\d{2,6}$/, '--chars');
      const epStart = checked(body.epStart, /^[1-9]$/, '--ep-start');
      const out = checked(body.out, /^[\w-]{1,40}$/, '--out');
      if (!project || !chapters || !group || !engine) throw new Error('project/chapters/group/engine 必填');
      if (out) assertOutAllowed(out);
      job = startBuildJob({ project, chapters, group, engine, chars, epStart, out, noVideo: body.noVideo === true });
    } else if (body.action === 'listen') {
      const ep = checked(body.ep, /^\d{1,2}$/, '--ep');
      const model = checked(body.model, /^(tiny|base|small|medium|large|large-v2|large-v3|turbo)$/, '--model');
      const cer = checked(body.cer, /^0?\.\d{1,3}$/, '--cer');
      const out = checked(body.out, /^[\w-]{1,40}$/, '--out');
      if (out) assertOutAllowed(out);
      job = startListenJob({ ep, model, cer, out, fix: body.fix === true, srt: body.srt === true });
    } else {
      return c.json({ error: 'action 仅允许 build | listen' }, 422);
    }
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
  return c.json({ jobId: job.id, args: job.args }, 201);
});

audiobookRouter.get('/jobs/active', (c) => {
  if (currentJobId) {
    const j = jobs.get(currentJobId);
    if (j?.status === 'running') return c.json({ jobId: j.id, action: j.action, args: j.args, startedAt: j.startedAt });
  }
  return c.json(null);
});

audiobookRouter.get('/jobs/:id', (c) => {
  const j = jobs.get(c.req.param('id'));
  if (!j) return c.json({ error: '未知任务' }, 404);
  return c.json({ id: j.id, action: j.action, status: j.status, args: j.args, lines: j.lines.slice(-200), error: j.error });
});

audiobookRouter.get('/jobs/:id/stream', (c) => {
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

audiobookRouter.post('/jobs/:id/cancel', (c) => {
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
