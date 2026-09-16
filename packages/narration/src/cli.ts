/**
 * 解说视频 CLI（M1）
 *   narration script --book <书名> [--minutes 30] [--out dir] [--gates-only]
 *   narration audio  --book <书名> [--engine volcengine]
 *   narration proto  --book <书名>          # 30 秒微原型：beat 时长切片音画对齐验证
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { openWriterDb, loadChapters, listProjects, resolveProjectId } from '@novel-eval/audiobook';
import { generateScript, type ChapterInput } from './script.ts';
import { structureGate, causalGate } from './gates.ts';
import { buildAudio } from './audio.ts';
import { buildPrototype } from './proto.ts';
import { generateCharacterSheets, generateSceneImages } from './images.ts';
import { renderVideo, renderShorts, renderThumbnail } from './render.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const WRITER_DB = join(REPO_ROOT, 'data/writer/writer.db');

// env 注入（对齐 audiobook scene-sinks 先例：读 ~/.claude/settings.json env 段）
try {
  const env = (JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf-8')) as { env?: Record<string, string> }).env ?? {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && !process.env[k]) process.env[k] = v;
} catch { /* 无配置则依赖现有 env */ }
// ARK key 兜底（scene-regen 先例：~/.zcode/ark-key.txt）
if (!process.env.ARK_API_KEY) {
  try { process.env.ARK_API_KEY = readFileSync(join(homedir(), '.zcode/ark-key.txt'), 'utf-8').trim(); } catch { /* 保持无 key，TTS 阶段自会报 */ }
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const next = process.argv[i + 1];
  return next !== undefined && !next.startsWith('--') ? next : def;
}
/** 布尔旗标（--approve 等）：存在即真，不取值 */
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function loadBookChapters(book: string, range?: string): Promise<{ bookId: string; bookTitle: string; chapters: ChapterInput[] }> {
  if (!existsSync(WRITER_DB)) throw new Error(`writer.db 不存在：${WRITER_DB}`);
  const db = openWriterDb(WRITER_DB);
  const projects = listProjects(db);
  const projectId = resolveProjectId(db, book);
  const proj = projects.find((p) => p.id === projectId) ?? projects.find((p) => p.title === book);
  if (!proj) throw new Error(`未找到书：《${book}》（现有：${projects.map((p) => p.title).join('、')}）`);
  const chapters = loadChapters(db, projectId, range).map((c, i) => ({ no: i + 1, title: c.title, text: c.content }));
  if (chapters.length === 0) throw new Error(`《${book}》无定稿章节${range ? `（范围 ${range}）` : ''}`);
  return { bookId: projectId, bookTitle: proj.title, chapters };
}

function outDirOf(bookTitle: string, override?: string): string {
  // 与 Web 建线同源的 slugify（去标点空格）：不传 --out 时 CLI 与 Web 落进同一产物根（评审 P2-3 分裂修复）
  const slug = bookTitle.replace(/[^\p{Script=Han}A-Za-z0-9_-]/gu, '').slice(0, 40) || 'book';
  return override ? join(REPO_ROOT, override) : join(REPO_ROOT, 'dist/derivatives', slug, 'narration');
}

/** 阶段用量落盘（usage.json 按阶段合并；Web 路由据此落成本台账） */
function recordUsage(outDir: string, stage: string, part: Record<string, number>): void {
  const file = join(outDir, 'usage.json');
  let prev: Record<string, Record<string, number>> = {};
  try { prev = JSON.parse(readFileSync(file, 'utf-8')); } catch { /* 首次 */ }
  prev[stage] = part;
  writeFileSync(file, JSON.stringify(prev, null, 2));
}

async function cmdScript(): Promise<void> {
  const book = arg('book');
  if (!book) throw new Error('--book 必填（writer.db 中的书名）');
  const minutes = Number(arg('minutes', '30'));
  const range = arg('chapters');   // 如 "1-6"（loadChapters 语义）
  const { bookId, bookTitle, chapters } = await loadBookChapters(book, range);
  const outDir = outDirOf(bookTitle, arg('out'));
  mkdirSync(outDir, { recursive: true });

  let script;
  let genLlm = 0, genChars = 0;   // 本跑生成用量（gates-only 复检时为 0）
  const scriptFile = join(outDir, 'script.json');
  if (flag('gates-only') && existsSync(scriptFile)) {
    script = JSON.parse(readFileSync(scriptFile, 'utf-8'));
  } else {
    console.log(`▸ S2 生成解说脚本：《${bookTitle}》${chapters.length} 章 → ${minutes} 分钟版`);
    const r = await generateScript({ repoRoot: REPO_ROOT, bookId, bookTitle, chapters, targetMinutes: minutes, outDir });
    script = r.script;
    genLlm = r.usage.llmCalls;
    genChars = script.sequences.reduce((n: number, q: any) => n + q.beats.reduce((m: number, b: any) => m + b.sentences.reduce((k: number, s: any) => k + String(s.text).length, 0), 0), 0);
    recordUsage(outDir, 'script', { llmCalls: genLlm, chars: genChars });
    console.log(`  LLM 调用 ${r.usage.llmCalls} 次；序列 ${script.sequences.length}；拍 ${script.sequences.reduce((n, q) => n + q.beats.length, 0)}`);
  }

  console.log('▸ S3a 结构门…');
  const sg = structureGate(script, minutes);
  console.log(`  ${sg.passed ? '✅ 通过' : '❌ 不通过'}：口播 ${sg.totalChars} 字 / 预估 ${sg.estimatedMinutes} 分钟 / 拍 ${sg.stats.beats} / peak ${sg.stats.peakCount} / 正脸 ${(sg.stats.faceShotRatio * 100).toFixed(0)}% / 最长无转折 ${sg.stats.longestStretchWithoutTurnS}s`);
  for (const iss of sg.issues) console.log(`  - ${iss}`);

  console.log('▸ S3b 因果稽核门…');
  const cg = await causalGate(script, join(outDir, '.maps-facts.json'), REPO_ROOT);
  console.log(`  ${cg.passed ? '✅ 通过' : '❌ 不通过'}（对照 ${cg.triplesChecked} 条事实三元组）`);
  for (const v of cg.violations) console.log(`  - [${v.beatId}] ${v.problem}`);
  // 因果稽核门本身是一次 LLM 调用——计入阶段用量（门禁失败/复检都真实花了钱）
  if (genChars === 0) {
    try { genChars = ((JSON.parse(readFileSync(join(outDir, 'usage.json'), 'utf-8')) as any).script?.chars) ?? 0; } catch { /* 无既往 */ }
  }
  recordUsage(outDir, 'script', { llmCalls: genLlm + 1, chars: genChars });

  writeFileSync(join(outDir, 'gates-report.json'), JSON.stringify({ structure: sg, causal: cg }, null, 2));
  if (!sg.passed || !cg.passed) {
    console.log('\n⚠ 门未全绿。修复方式：调 prompt/参数重跑（缓存按章失效），或手工改 script.json 后 --gates-only 复检。');
    process.exitCode = 2;
  }
}

async function cmdAudio(): Promise<void> {
  const book = arg('book');
  if (!book) throw new Error('--book 必填');
  const range = arg('chapters');
  const { bookTitle } = await loadBookChapters(book, range);
  const outDir = outDirOf(bookTitle, arg('out'));
  const scriptFile = join(outDir, 'script.timed.json');
  const src = existsSync(scriptFile) ? scriptFile : join(outDir, 'script.json');
  const script = JSON.parse(readFileSync(src, 'utf-8'));
  console.log(`▸ S4 多轨音频（引擎 ${arg('engine', 'volcengine')}，句 ${script.sequences.reduce((n: number, q: any) => n + q.beats.reduce((m: number, b: any) => m + b.sentences.length, 0), 0)}）`);
  const r = await buildAudio({ script, outDir, ttsEngine: arg('engine') ?? 'volcengine' });
  recordUsage(outDir, 'audio', { ttsChars: r.synthChars, durationMs: r.totalMs });
  console.log(`  ${r.missing.length === 0 ? '✅ 缺段 0' : `❌ 缺段 ${r.missing.length}：${r.missing.join(',')}`}`);
  console.log(`  成片音轨 ${Math.round(r.totalMs / 1000)}s → ${r.mp3}\n  字幕 ${r.srt}`);
  if (r.missing.length > 0) process.exitCode = 2;
}

async function cmdProto(): Promise<void> {
  const book = arg('book');
  if (!book) throw new Error('--book 必填');
  const { bookTitle } = await loadBookChapters(book);
  const outDir = outDirOf(bookTitle, arg('out'));
  console.log('▸ 微原型：beat 真实时长切片（前 3 拍）…');
  const r = await buildPrototype(outDir);
  console.log(`  ✅ 对齐 ${Math.round(r.driftMs)}ms ≤ 500ms → ${r.file}`);
}

async function cmdSheets(): Promise<void> {
  const book = arg('book');
  if (!book) throw new Error('--book 必填');
  const { bookTitle } = await loadBookChapters(book);
  const outDir = outDirOf(bookTitle, arg('out'));
  const script = JSON.parse(readFileSync(join(outDir, 'script.json'), 'utf-8'));
  console.log(`▸ S5a 定妆照（角色 ${script.characters.length}）…`);
  const generated = await generateCharacterSheets(script, outDir);
  recordUsage(outDir, 'sheets', { images: generated });
  if (flag('approve')) {
    for (const c of script.characters) if (c.sheetFile) c.status = 'approved';
    writeFileSync(join(outDir, 'script.json'), JSON.stringify(script, null, 2));
    console.log('  ✅ 全部定妆照已批准（approved 门打开，可跑 scenes）');
  } else {
    console.log('  审看 characters/*.jpg 后 --approve 批准（或重跑本命令重新生成）');
  }
}

async function cmdScenes(): Promise<void> {
  const book = arg('book');
  if (!book) throw new Error('--book 必填');
  const { bookTitle } = await loadBookChapters(book);
  const outDir = outDirOf(bookTitle, arg('out'));
  const script = JSON.parse(readFileSync(join(outDir, 'script.json'), 'utf-8'));
  console.log('▸ S5b 分镜图（Seedream 参考图，角色一致性）…');
  const r = await generateSceneImages(script, outDir);
  recordUsage(outDir, 'scenes', { images: r.ok });
  console.log(`  ✓ ${r.ok} 张；fallback ${r.fallback.length} 张${r.fallback.length ? '：' + r.fallback.join(',') : ''}（渲染阶段将以上一帧/定妆照兜底）`);
}

async function cmdRender(): Promise<void> {
  const book = arg('book');
  if (!book) throw new Error('--book 必填');
  const { bookTitle } = await loadBookChapters(book);
  const outDir = outDirOf(bookTitle, arg('out'));
  const script = JSON.parse(readFileSync(join(outDir, 'script.timed.json'), 'utf-8'));
  console.log('▸ S6 全片渲染（beat 精确切片，串行）…');
  const r = await renderVideo(script, outDir);
  console.log(`  ✅ ${r.video}`);
  if (flag('shorts')) {
    console.log('▸ Shorts（3×50s 竖屏）…');
    const shorts = await renderShorts(script, outDir);
    for (const s of shorts) console.log(`  ✅ ${s}`);
  }
  if (flag('thumb')) {
    console.log('▸ 封面…');
    console.log(`  ✅ ${await renderThumbnail(script, outDir)}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'script': return cmdScript();
    case 'audio': return cmdAudio();
    case 'proto': return cmdProto();
    case 'sheets': return cmdSheets();
    case 'scenes': return cmdScenes();
    case 'render': return cmdRender();
    default:
      console.log('用法：pnpm narration <script|audio|proto|sheets|scenes|render> --book <书名> [--minutes 30] [--approve] [--shorts] [--thumb] [--chapters 1-6] [--engine volcengine] [--out dir] [--gates-only]');
      process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
