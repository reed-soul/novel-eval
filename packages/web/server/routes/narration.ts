/**
 * 解说视频 HTTP 路由 — M3 Web 自助（PLAN §5）
 *
 *   GET  /api/narration/books/:bookId                状态总览（脚本/门禁/音轨/分镜/成片/发布物料/检查单）
 *   POST /api/narration/books/:bookId/setup          建线（登记 data/narration/registry.json + 产物根）
 *   POST /api/narration/books/:bookId/characters/approve   定妆照批准（打开 scenes 的 approved 门）
 *   POST /api/narration/jobs                         script|audio|sheets|scenes|render（渲染走全局锁）
 *   GET  /api/narration/jobs/active|:id|:id/stream   POST :id/cancel
 *   GET/PUT /api/narration/books/:bookId/checklist   发布检查单
 *   GET  /api/narration/books/:bookId/cost           多维成本台账
 *
 * 安全对齐 audiobook 路由：用户输入永不构成 fs 路径（bookId 只查 DB/registry，
 * 产物根由服务端写死且必须落在 dist/ 内）；spawn 逐项白名单（禁前导 '-'）；
 * 参数经 jobId 唯一文件落盘后由 pipeline-spawn 回读。
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runPipeline } from '../lib/pipeline-spawn.ts';
import { acquireRenderLock, releaseRenderLock, renderLockActive, RENDER_KIND_LABEL, type RenderKind } from '../lib/render-lock.ts';
import { getProject, type DB } from '@novel-eval/writer';
import {
  loadNarrationRegistry, setupNarrationLine, loadNarrationCost, appendNarrationCost,
  narrationCostSummary, estimateNarrationCost, type NarrationLine, type NarrationCostEntry,
} from '@novel-eval/narration';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DATA_DIR = join(REPO_ROOT, 'data');

const KIND: RenderKind = 'narration';

// ── 小工具（对齐 audiobook 路由先例） ──────────────────────────

function mediaUrl(relUnderDist: string): string {
  return `/media/${relUnderDist.split('/').map(encodeURIComponent).join('/')}`;
}

function bookTitleOf(db: DB, bookId: string): string | null {
  const p = getProject(db, bookId);
  return p ? p.title : null;
}

function slugify(title: string): string {
  const s = title.replace(/[^\p{Script=Han}A-Za-z0-9_-]/gu, '').slice(0, 40);
  return s || 'book';
}

function registryRoot(rec: NarrationLine): string {
  const abs = resolve(REPO_ROOT, rec.outRoot);
  const distAbs = join(REPO_ROOT, 'dist');
  if (abs !== distAbs && !abs.startsWith(distAbs + sep)) throw new Error('registry outRoot 越界');
  return abs;
}

function loadJson<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(file, 'utf-8')) as T; } catch { return null; }
}

const durCache = new Map<string, { mtime: number; ms: number }>();
function probeDurationMs(file: string): number | null {
  const mtime = statSync(file).mtimeMs;
  const hit = durCache.get(file);
  if (hit && hit.mtime === mtime) return hit.ms;
  try {
    // timeout 必备：半成品 mp4（moov 未落盘）可让 ffprobe 挂起，无超时会卡死整个单线程服务
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf-8', timeout: 2000 });
    const ms = Math.round(Number(out.trim()) * 1000);
    durCache.set(file, { mtime, ms });
    if (durCache.size > 200) durCache.delete(durCache.keys().next().value as string);   // 简单容量上限
    return ms;
  } catch { return null; }
}

/** 逐项校验：白名单 + 禁前导'-'（杜绝把动态值当选项注入） */
function checked(v: unknown, pattern: RegExp, name: string, maxLen = 64): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v);
  if (s.length > maxLen || s.startsWith('-') || !pattern.test(s)) throw new Error(`参数 ${name} 非法`);
  return s;
}

// ── 串行 Job 执行器（与 audiobook 共用全局渲染锁） ─────────────

type NarrAction = 'script' | 'audio' | 'sheets' | 'scenes' | 'render';

interface NarrJob {
  id: string;
  action: NarrAction;
  bookId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** cancel 已请求：close 到来时保持 cancelled 终态，不落账（P0：cancel 只杀不放锁） */
  cancelRequested?: boolean;
  args: string[];
  lines: { seq: number; text: string }[];
  startedAt: number;
  error?: string;
  emitter: EventEmitter;
  child: import('node:child_process').ChildProcess | null;
  /** 落账素材（完成后从产物 usage.json 取用量） */
  billing?: { outRoot: string; title: string };
}

const jobs = new Map<string, NarrJob>();
/** 已结束任务保留上限（Map 按插入序淘汰最旧的非运行任务；活跃任务永不淘汰） */
const MAX_FINISHED_JOBS = 60;
function pruneJobs(): void {
  if (jobs.size <= MAX_FINISHED_JOBS) return;
  for (const [id, j] of jobs) {
    if (jobs.size <= MAX_FINISHED_JOBS) break;
    if (j.status === 'running' || id === localActiveId) continue;
    jobs.delete(id);
  }
}

/**
 * 解说线内部串行（同线一次一个任务，防同线并发写同一产物根）；
 * 全局渲染锁只在 render 动作持有——工程评审的原始约束是「ffmpeg 渲染全仓串行」，
 * 纯 LLM/生图 API 任务不占（评审共识：此前一刀切劣化跨形态并发体验）。
 */
let localActiveId: string | null = null;

function activeNarrationJob(): NarrJob | null {
  return localActiveId ? (jobs.get(localActiveId) ?? null) : null;
}

function startNarrJob(action: NarrAction, bookId: string, argsFile: string, billing?: NarrJob['billing']): NarrJob {
  if (localActiveId) throw new Error('NARRATION_LINE_BUSY');
  const id = randomUUID().slice(0, 8);
  localActiveId = id;
  const heavy = action === 'render';   // 唯一重活：ffmpeg 正片+切片渲染
  try {
    if (heavy) acquireRenderLock(id, KIND);   // 先占锁再 spawn：不留无锁窗口
  } catch (e) {
    localActiveId = null;
    throw e;
  }
  let child: import('node:child_process').ChildProcess;
  let argv: string[];
  try {
    ({ child, argv } = runPipeline(argsFile, REPO_ROOT));
  } catch (e) {
    localActiveId = null;
    if (heavy) releaseRenderLock(id);
    throw e;
  }
  const job: NarrJob = {
    id, action, bookId, billing,
    status: 'running', args: argv, lines: [],
    startedAt: Date.now(), emitter: new EventEmitter(), child: null,
  };
  jobs.set(id, job);
  pruneJobs();
  job.child = child;
  /** 终态清理：线锁总是释放；重活另放全局锁（cancel 抢跑时不覆盖终态、不落账） */
  const finalize = () => {
    if (localActiveId === job.id) localActiveId = null;
    if (heavy) releaseRenderLock(job.id);
  };
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
    finalize();
  });
  child.on('close', (code) => {
    // 终态已定（取消已请求/失败）：只清理——不覆盖终态、不落账（评审 P0/P1-7：
    // cancel 后子进程可存活至多 4s，此间锁必须保持占用）
    if (job.status === 'cancelled' || job.status === 'failed') {
      job.emitter.emit('done', { status: job.status, code });
      finalize();
      return;
    }
    // 退出码 2 = 脚本门禁未全绿（LLM 花费已发生）：标 failed 但照常落账
    const gatesFailed = code === 2 && job.action === 'script';
    job.status = code === 0 ? 'completed' : gatesFailed ? 'failed' : 'cancelled';
    job.error = code === 0 ? undefined : gatesFailed ? '质量门未全绿' : `退出码 ${code}`;
    if ((code === 0 || gatesFailed) && job.billing) billJob(job);
    job.emitter.emit('done', { status: job.status, code });
    finalize();
  });
  return job;
}

/** 成功完成后落多维成本账（用量来自 CLI 各阶段写的 usage.json；render 用 ffprobe 探成片时长） */
function billJob(job: NarrJob): void {
  try {
    const root = resolve(REPO_ROOT, job.billing!.outRoot);
    const usage = loadJson<Record<string, Record<string, number>>>(join(root, 'usage.json')) ?? {};
    const s = usage.script ?? {}, a = usage.audio ?? {}, sh = usage.sheets ?? {}, sc = usage.scenes ?? {};
    let llmCalls = 0, ttsChars = 0, images = 0, durationMs = 0;
    if (job.action === 'script') llmCalls = s.llmCalls ?? 0;
    if (job.action === 'audio') { ttsChars = a.ttsChars ?? 0; durationMs = a.durationMs ?? 0; }
    if (job.action === 'sheets') images = sh.images ?? 0;
    if (job.action === 'scenes') images = sc.images ?? 0;
    if (job.action === 'render') {
      const v = join(root, 'narration-video.mp4');
      durationMs = existsSync(v) ? (probeDurationMs(v) ?? 0) : 0;
    }
    const entry: NarrationCostEntry = {
      ts: new Date().toISOString(),
      projectId: job.bookId,
      bookTitle: job.billing!.title,
      stage: job.action,
      llmCalls, ttsChars, images, durationMs,
      cost: estimateNarrationCost({ llmCalls, ttsChars, images }),
    };
    appendNarrationCost(DATA_DIR, entry);
  } catch { /* 落账失败不影响任务终态 */ }
}

// ── 发布物料（PLAN §6 发布策略：Day3 主片 + Day4–7 Shorts + 有声书承接） ──

const CHECKLIST_KEYS = [
  'title-copied', 'description-copied', 'tags-copied', 'thumbnail-ready',
  'srt-uploaded', 'ai-disclosure', 'not-for-kids', 'endscreen-playlist', 'pinned-comment', 'scheduled', 'shorts-linked',
] as const;

interface ScriptShape {
  sequences: { id: string; title: string; beats: { id: string; kind: string; startMs?: number; sentences: { text: string; quote?: unknown }[] }[] }[];
  characters: { id: string; name: string; status: string; sheetFile?: string; promptDesc?: string }[];
}

function buildPublishMaterial(title: string, premise: string | null, script: ScriptShape | null) {
  const sequences = script?.sequences ?? [];
  const beats = sequences.flatMap((q) => q?.beats ?? []);
  // 悬疑时间轴：各序列首拍 startMs（timed 脚本才有）
  const timeline = sequences
    .map((q) => ({ label: String(q.title ?? '').split('（')[0], startMs: q?.beats?.[0]?.startMs }))
    .filter((x) => typeof x.startMs === 'number');
  const timelineLines = timeline.length >= 2
    ? ['⏱ 悬疑时间轴：', ...timeline.map((t) => {
        const sec = Math.floor(t.startMs! / 1000);
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} ${t.label}`;
      })]
    : [];
  const description = [
    `《${title}》全文解说：每一处细节都是伏笔。`,
    '',
    premise ? `【故事梗概】\n${premise}` : '',
    timelineLines.length ? timelineLines.join('\n') : '',
    '',
    '🎧 想听完整演播？本频道有声书全集已上线，点击主页播放列表收听。',
    '🎙️ 本视频为虚构文学作品的 AI 辅助解说与制作，人物情节均属虚构。',
    '',
    '#悬疑 #小说解说 #一口气看完 #悬疑解说',
  ].filter(Boolean).join('\n');
  const tags = ['悬疑', '小说解说', '一口气看完', '悬疑解说', '解说视频', title];
  // Shorts 计划：钩子拍 + 两个高潮拍（对齐渲染锚点 b001 + peaks）
  const anchors = [beats.find((b) => b.kind === 'hook'), ...beats.filter((b) => b.kind === 'peak').slice(0, 2)].filter(Boolean);
  const shortsPlan = anchors.map((b, i) => {
    const text = b!.sentences[0]?.text ?? b!.id;
    return { slot: i + 1, day: `Day${4 + i}`, title: `${text.slice(0, 20)}${text.length > 20 ? '…' : ''}` };
  });
  return {
    title: `《${title}》一口气看完 · 悬疑解说`,
    description,
    tags,
    tagsString: tags.join(', '),
    playlist: `${title} · 悬疑借阅室`,
    schedule: 'Day3 主片（有声书 playlist 悄悄上线后第三天发布，85% 处口播导流）',
    shortsPlan,
  };
}

// ── 状态扫描（全部从产物文件派生，禁独立状态机） ───────────────

function scanOutRoot(root: string, title: string, premise: string | null) {
  const relOut = root.replace(REPO_ROOT + sep, '').replaceAll('\\', '/');
  const relDist = relOut.replace(/^dist\//, '');
  // characters/状态以 script.json 为正本（approve 写它）；句/拍时间轴取配音后回填的 timed 版
  const scriptBase = loadJson<ScriptShape>(join(root, 'script.json'));
  const scriptTimed = loadJson<ScriptShape>(join(root, 'script.timed.json'));
  const script = scriptBase
    ? (scriptTimed ? { ...scriptTimed, characters: scriptBase.characters } : scriptBase)
    : scriptTimed;
  const gates = loadJson<{ structure?: { passed: boolean; issues: string[]; totalChars?: number; estimatedMinutes?: number; stats?: Record<string, number> }; causal?: { passed: boolean; violations: { beatId: string; problem: string }[]; triplesChecked?: number } }>(join(root, 'gates-report.json'));
  // 半成品/损坏 JSON 防空：任务运行中 GET 可能读到 {} 或缺字段的合法 JSON（评审 P1-6）
  const beats = script?.sequences?.flatMap((q) => q?.beats ?? []) ?? [];
  const chars = beats.reduce((n, b) => n + (b?.sentences ?? []).reduce((m, s) => m + String(s?.text ?? '').length, 0), 0);

  const characters = (script?.characters ?? []).map((c) => ({
    id: String(c?.id ?? ''), name: String(c?.name ?? ''), status: String(c?.status ?? 'draft'), promptDesc: c?.promptDesc ?? '',
    sheetUrl: c?.sheetFile && existsSync(join(root, c.sheetFile)) ? mediaUrl(`${relDist}/${c.sheetFile}`) : null,
  }));
  // 空角色表视为已批准（vacuous truth）：无具名角色的书不应被永久卡死在分镜门前
  const approvedAll = characters.every((c) => c.status === 'approved' && c.sheetUrl);

  const mp3 = join(root, 'narration.mp3');
  const audio = existsSync(mp3)
    ? { url: mediaUrl(`${relDist}/narration.mp3`), durationMs: probeDurationMs(mp3),
        srtUrl: existsSync(join(root, 'narration.srt')) ? mediaUrl(`${relDist}/narration.srt`) : null,
        timed: existsSync(join(root, 'script.timed.json')) }
    : null;

  let sceneCount = 0;
  const scenesDir = join(root, 'scenes');
  if (existsSync(scenesDir)) sceneCount = readdirSync(scenesDir).filter((f) => f.endsWith('.jpg')).length;

  const videoFile = join(root, 'narration-video.mp4');
  let shorts: { slot: number; url: string; durationMs: number | null }[] = [];
  if (existsSync(root)) {
    shorts = readdirSync(root)
      .filter((f) => /^short-\d+\.mp4$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))   // 数字序：第 10 条不会插到第 2 条前
      .map((f) => ({ slot: Number(f.match(/^short-(\d+)/)![1]), url: mediaUrl(`${relDist}/${f}`), durationMs: probeDurationMs(join(root, f)) }));
  }
  const video = existsSync(videoFile)
    ? {
        url: mediaUrl(`${relDist}/narration-video.mp4`),
        durationMs: probeDurationMs(videoFile),
        shorts,
        thumbnailUrl: existsSync(join(root, 'thumbnail.jpg')) ? mediaUrl(`${relDist}/thumbnail.jpg`) : null,
      }
    : null;

  let checklist: Record<string, boolean> = {};
  try { checklist = JSON.parse(readFileSync(join(root, 'publish-checklist.json'), 'utf-8')) as Record<string, boolean>; } catch { /* 未开始 */ }

  return {
    script: script
      ? {
          sequences: script.sequences.length, beats: beats.length, chars,
          gates: gates
            ? {
                passed: !!gates.structure?.passed && !!gates.causal?.passed,
                structure: gates.structure ?? null,
                causal: gates.causal ?? null,
              }
            : null,
          characters, approvedAll,
        }
      : null,
    audio,
    scenes: { count: sceneCount, beats: beats.length },
    video,
    checklist: Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, !!checklist[k]])),
    publish: buildPublishMaterial(title, premise, script),
  };
}

// ── 路由 ───────────────────────────────────────────────────────

export function narrationRouter(db: DB) {
  const app = new Hono();

  app.get('/books/:bookId', (c) => {
    const bookId = c.req.param('bookId');
    const title = bookTitleOf(db, bookId);
    if (!title) return c.json({ error: '未知书' }, 404);
    const reg = loadNarrationRegistry(DATA_DIR);
    const rec = reg[bookId];
    const project = getProject(db, bookId);
    if (!rec) {
      const hasArk = !!process.env.ARK_API_KEY || existsSync(join(homedir(), '.zcode/ark-key.txt'));
      return c.json({ registered: false, bookId, title, suggestion: { minutes: 15, engine: hasArk ? 'volcengine' : 'edge' } });
    }
    const root = registryRoot(rec);
    const scan = existsSync(root) ? scanOutRoot(root, title, project?.premise ?? null) : null;
    const job = activeNarrationJob();
    return c.json({
      registered: true, bookId, title,
      presets: rec.presets, outRoot: rec.outRoot,
      ...(scan ?? {
        script: null, audio: null, scenes: { count: 0, beats: 0 }, video: null,
        checklist: Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, false])),
        publish: buildPublishMaterial(title, project?.premise ?? null, null),
      }),
      activeJob: job && job.status === 'running'
        ? { jobId: job.id, action: job.action, startedAt: job.startedAt }
        : null,
    });
  });

  app.post('/books/:bookId/setup', async (c) => {
    const bookId = c.req.param('bookId');
    const title = bookTitleOf(db, bookId);
    if (!title) return c.json({ error: '未知书' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const minutes = checked(body.minutes, /^(8|10|12|15|20|25|30)$/, 'minutes');
    const engine = checked(body.engine, /^(volcengine|edge)$/, 'engine');
    const hasArk = !!process.env.ARK_API_KEY || existsSync(join(homedir(), '.zcode/ark-key.txt'));
    const rec = setupNarrationLine(DATA_DIR, bookId, {
      outRoot: `dist/derivatives/${slugify(title)}/narration`,
      minutes: minutes ? Number(minutes) : undefined,
      engine: engine ? (engine as 'volcengine' | 'edge') : (hasArk ? 'volcengine' : 'edge'),
    });
    mkdirSync(registryRoot(rec), { recursive: true });
    return c.json({ ok: true, bookId, presets: rec.presets, outRoot: rec.outRoot }, 201);
  });

  // 定妆照批准（approved 门：scenes 生成的前置）
  app.post('/books/:bookId/characters/approve', async (c) => {
    const bookId = c.req.param('bookId');
    const title = bookTitleOf(db, bookId);
    if (!title) return c.json({ error: '未知书' }, 404);
    const rec = loadNarrationRegistry(DATA_DIR)[bookId];
    if (!rec) return c.json({ error: '该书尚未建线' }, 404);
    const root = registryRoot(rec);
    const file = join(root, 'script.json');
    const script = loadJson<ScriptShape>(file);
    if (!script) return c.json({ error: '尚未生成解说脚本' }, 422);
    const body = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
    if (body.ids !== undefined && !Array.isArray(body.ids)) return c.json({ error: 'ids 必须为数组（缺省=全部批准）' }, 422);
    let ids: string[] | null = null;
    if (Array.isArray(body.ids)) {
      if (body.ids.length > 20 || body.ids.some((x) => typeof x !== 'string' || !/^c-[\w-]{1,32}$/.test(x))) return c.json({ error: 'ids 非法' }, 422);
      ids = body.ids as string[];
    }
    let approved = 0;
    for (const ch of script.characters) {
      if (ch.sheetFile && (!ids || ids.includes(ch.id))) { ch.status = 'approved'; approved += 1; }
    }
    writeFileSync(file, JSON.stringify(script, null, 2), 'utf-8');
    return c.json({ ok: true, approved, of: script.characters.length });
  });

  app.post('/jobs', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    // 同线互斥：解说线一次只跑一个任务（防同线并发写同一产物根）
    if (localActiveId) return c.json({ error: '解说任务已在跑（同线一次一个），请稍候或先取消', jobId: localActiveId }, 409);
    // 跨形态互斥只约束重活：render（ffmpeg）与有声书渲染互斥；纯 LLM/TTS/生图 API 任务不占全局锁
    if (String(body.action ?? '') === 'render') {
      const h = renderLockActive();
      if (h) return c.json({ error: `${RENDER_KIND_LABEL[h.kind]}渲染任务在跑（视频渲染全仓串行），请稍候或先取消`, jobId: h.jobId }, 409);
    }
    const bookIdRaw = checked(body.bookId, /^[\w-]{1,64}$/, 'bookId');
    if (!bookIdRaw) return c.json({ error: 'bookId 必填' }, 422);
    const bookId = bookIdRaw;
    const title = bookTitleOf(db, bookId);
    if (!title) return c.json({ error: '未知书' }, 404);
    const rec = loadNarrationRegistry(DATA_DIR)[bookId];
    if (!rec) return c.json({ error: '该书尚未建线，请先 setup' }, 422);
    const root = registryRoot(rec);
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    // maxLen 显式给足：路径最长 18(dist/derivatives/)+40(slug)+10(/narration)=68，默认 64 会卡死长书名（评审 P1-5）
    const outRoot = checked(rec.outRoot, /^dist\/[\w\u4e00-\u9fff/-]{3,120}$/, 'outRoot', 128);
    const engine = checked(rec.presets.engine, /^(volcengine|edge)$/, 'engine');
    const minutes = checked(String(rec.presets.minutes), /^(8|10|12|15|20|25|30)$/, 'minutes', 2);
    if (!outRoot || !engine || !minutes) throw new Error('作品预设非法（请检查 data/narration/registry.json）');

    const action = String(body.action ?? '');
    let job: NarrJob;
    try {
      // 固定形状参数：时长/引擎/产物根全部来自登记预设（用户不可注入）
      const base = (): string[] => ['narration'];
      let childArgs: string[];
      let narrAction: NarrAction;
      switch (action) {
        case 'script':
          narrAction = 'script';
          childArgs = [...base(), 'script', '--book', bookId, '--minutes', minutes, '--out', outRoot];
          break;        case 'audio':
          narrAction = 'audio';
          childArgs = [...base(), 'audio', '--book', bookId, '--out', outRoot, '--engine', engine];
          break;
        case 'sheets':
          narrAction = 'sheets';
          childArgs = [...base(), 'sheets', '--book', bookId, '--out', outRoot];
          break;
        case 'scenes':
          narrAction = 'scenes';
          childArgs = [...base(), 'scenes', '--book', bookId, '--out', outRoot];
          break;
        case 'render':
          narrAction = 'render';
          childArgs = [...base(), 'render', '--book', bookId, '--out', outRoot];
          if (body.shorts === true) childArgs.push('--shorts');
          if (body.thumb === true) childArgs.push('--thumb');
          break;
        default:
          return c.json({ error: 'action 仅允许 script | audio | sheets | scenes | render' }, 422);
      }
      // jobId 唯一参数文件（与 audiobook 的固定名不同：两路由相邻落盘互不覆盖）
      const id = randomUUID().slice(0, 8);
      const argsFile = join(DATA_DIR, 'narration', `.job-${id}-args.json`);
      mkdirSync(join(DATA_DIR, 'narration'), { recursive: true });
      writeFileSync(argsFile, JSON.stringify(childArgs), { mode: 0o600 });
      job = startNarrJob(narrAction, bookId, argsFile, { outRoot, title });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('RENDER_LOCK_BUSY:') || msg === 'NARRATION_LINE_BUSY') return c.json({ error: '锁刚被占用，请重试' }, 409);
      return c.json({ error: msg }, 422);
    }
    return c.json({ jobId: job.id, args: job.args }, 201);
  });

  app.get('/jobs/active', (c) => {
    const j = activeNarrationJob();
    if (j?.status === 'running') return c.json({ jobId: j.id, action: j.action, bookId: j.bookId, args: j.args, startedAt: j.startedAt });
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
      const send = async (data: unknown, event?: string) => { await stream.writeSSE({ data: JSON.stringify(data), event }); };
      for (const line of j.lines) {
        if (line.seq <= last) continue;
        last = line.seq;
        await send(line);
      }
      if (j.status !== 'running') { await send({ status: j.status, error: j.error }, 'done'); return; }
      const onLine = async (line: { seq: number; text: string }) => {
        if (line.seq <= last) return;
        last = line.seq;
        await send(line);
      };
      let closed = false;
      const onDone = async (d: unknown) => { if (closed) return; closed = true; cleanup(); await send(d, 'done'); };
      const cleanup = () => { j.emitter.off('line', onLine); j.emitter.off('done', onDone); };
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
    // 只杀不放锁：SIGTERM→4s SIGKILL 期间子进程仍在渲染，锁须保持占用，
    // 否则「取消后立刻再开任务」会双 ffmpeg（评审 P0-1）。放锁只发生在 close。
    j.cancelRequested = true;
    j.child?.kill('SIGTERM');
    setTimeout(() => j.child?.kill('SIGKILL'), 4000);
    j.status = 'cancelled';
    j.emitter.emit('done', { status: 'cancelled' });
    return c.json({ status: 'cancelled' });
  });

  app.get('/books/:bookId/checklist', (c) => {
    const bookId = c.req.param('bookId');
    if (!bookTitleOf(db, bookId)) return c.json({ error: '未知书' }, 404);
    const rec = loadNarrationRegistry(DATA_DIR)[bookId];
    if (!rec) return c.json({ error: '该书尚未建线' }, 404);
    let state: Record<string, boolean> = {};
    try { state = JSON.parse(readFileSync(join(registryRoot(rec), 'publish-checklist.json'), 'utf-8')) as Record<string, boolean>; } catch { /* 未开始 */ }
    return c.json({ state: Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, !!state[k]])) });
  });

  app.put('/books/:bookId/checklist', async (c) => {
    const bookId = c.req.param('bookId');
    if (!bookTitleOf(db, bookId)) return c.json({ error: '未知书' }, 404);
    const rec = loadNarrationRegistry(DATA_DIR)[bookId];
    if (!rec) return c.json({ error: '该书尚未建线' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    // 合并写：先读已勾选项，只 patch 本次出现的 key（单键提交不得抹掉其余勾选——评审 P1-1）
    const file = join(registryRoot(rec), 'publish-checklist.json');
    let prev: Record<string, boolean> = {};
    try { prev = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, boolean>; } catch { /* 未开始 */ }
    const state: Record<string, boolean> = { ...prev };
    for (const k of CHECKLIST_KEYS) {
      if (body[k] !== undefined) {
        if (typeof body[k] !== 'boolean') return c.json({ error: `${k} 需为布尔` }, 422);
        state[k] = body[k] as boolean;
      }
    }
    writeFileSync(file, JSON.stringify(state, null, 1), 'utf-8');
    return c.json({ ok: true, state });
  });

  app.get('/books/:bookId/cost', (c) => {
    const bookId = c.req.param('bookId');
    const title = bookTitleOf(db, bookId);
    if (!title) return c.json({ error: '未知书' }, 404);
    const mine = loadNarrationCost(DATA_DIR).filter((e) => e.projectId === bookId);
    return c.json({ summary: narrationCostSummary(mine), recent: mine.slice(0, 30) });
  });

  return app;
}
