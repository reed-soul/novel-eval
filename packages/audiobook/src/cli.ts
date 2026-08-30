/**
 * audiobook CLI：writer.db 章节 → 标注 → TTS → 分集装配（冷开场+多章并集+字幕）→ 视频 → YouTube 物料
 *
 * 用法示例：
 *   pnpm audiobook build --project 最后一班森铁 --chapters 1 --chars 600              # 单章试产
 *   pnpm audiobook build --project 最后一班森铁 --chapters 1-15 --group 3            # 3 章并一集（10-18 分钟黄金区）
 *   pnpm audiobook build --engine minimax ...                                        # 生产级音色（需 key）
 *
 * 分集结构（留存优先）：
 *   [0-8s 冷开场钩子] → [固定片头语] → [章1 → 章N（悬念处自然衔接）]
 *
 * 安全约束：所有 argv 输入在入口处净化——路径一律解析并锁定在仓库根内
 * （防路径穿越），文本参数做字符集/长度白名单，引擎名走字面量分支。
 */
import { resolve, sep } from 'node:path';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { openWriterDb, resolveProjectId, loadChapters, listProjects } from './db.ts';
import { annotateChapter, applyPron, truncateAtSentence, DEFAULT_VOICE_CONFIG, type Segment, type SegmentKind, type VoiceConfig } from './annotate.ts';
import { loadProjectConfig } from './project-config.ts';
import { attributeMissingSpeakers } from './attribute.ts';
import { discoverChapters } from './listen.ts';
import { createEngine, type TtsEngine, type SynthResult } from './tts/index.ts';
import { assembleChapter } from './audio.ts';
import { assembleEpisode, type TrackItem } from './episode.ts';
import { renderChapterVideo } from './video.ts';
import { ensureSnowAsset } from './assets.ts';
import { parseSrt, shift, mergeCues, writeSrt, estimateCues, type Cue } from './srt.ts';
import { buildUploadPlan, writeUploadBundle, DEFAULT_BRAND, type ChapterMark } from './youtube.ts';

const REPO_ROOT = process.cwd();

/** 路径净化：相对/绝对路径一律解析后必须落在仓库根内，拒绝 ../ 穿越 */
function safePath(userPath: string): string {
  const resolved = resolve(REPO_ROOT, userPath);
  if (!resolved.startsWith(REPO_ROOT + sep)) throw new Error(`路径越界（仅允许仓库内）：${userPath}`);
  return resolved;
}

function cleanText(v: string, maxLen: number): string {
  return v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLen);
}

// DB 章节标题进入输出文件名（随后流入 ffmpeg argv / concat 清单）前，
// 白名单清洗：仅保留汉字、字母、数字、连字符、下划线，切断污点链。
function safeName(title: string): string {
  const cleaned = title.replace(/[^\p{Script=Han}A-Za-z0-9_-]/gu, '').slice(0, 60);
  if (!cleaned) throw new Error(`章节标题无法用作文件名：${JSON.stringify(title.slice(0, 40))}`);
  return cleaned;
}

interface CleanArgs {
  project?: string;
  chapters?: string;
  chars?: number;
  engine: string;
  group: number;
  coldOpen: boolean;
  outRoot: string;
  dbPath: string;
  cover?: string;
  coverDir?: string;
  snow: boolean;
  skipVideo: boolean;
  /** 构建前清空所选章节的 tts/ 段级缓存——正文/发音修订后的强制重制（M0 验收10） */
  clean: boolean;
  tagline: string;
  /** per-project 配置显式路径（默认按项目名/ID 自动发现 data/audiobook/projects/） */
  config?: string;
  /** build：对未归属对白跑 LLM 归因（engines.yml 引擎，走应用同款 key） */
  llmAttribute: boolean;
  /** 并行渲染用：集号起始偏移（--chapters 4-6 --ep-start 2 → 写入 ep02），
   *  同时保证 TTS 缓存路径（epXX/chNN/tts）与全量串行跑一致，可互相复用。 */
  epStart: number;
}

function parseArgs(argv: string[]): { command: string; raw: Record<string, string>; skipVideo: boolean } {
  const command = argv[0] ?? 'help';
  const raw: Record<string, string> = {};
  let skipVideo = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--project': raw.project = next(); break;
      case '--chapters': raw.chapters = next(); break;
      case '--chars': raw.chars = next(); break;
      case '--engine': raw.engine = next(); break;
      case '--group': raw.group = next(); break;
      case '--out': raw.out = next(); break;
      case '--db': raw.db = next(); break;
      case '--cover': raw.cover = next(); break;
      case '--cover-dir': raw.coverDir = next(); break;
      case '--no-snow': raw.noSnow = '1'; break;
      case '--clean': raw.clean = '1'; break;
      case '--no-cold-open': raw.noColdOpen = '1'; break;
      case '--skip-video': skipVideo = true; break;
      case '--ep-start': raw.epStart = next(); break;
      case '--tagline': raw.tagline = next(); break;
      case '--config': raw.config = next(); break;
      case '--ep': raw.ep = next(); break;
      case '--model': raw.model = next(); break;
      case '--cer': raw.cer = next(); break;
      case '--fix': raw.fix = '1'; break;
      case '--srt': raw.srt = '1'; break;
      case '--llm-attribute': raw.llmAttribute = '1'; break;
      default: throw new Error(`未知参数：${a}`);
    }
  }
  return { command, raw, skipVideo };
}

function cleanArgs(raw: Record<string, string>, skipVideo: boolean): CleanArgs {
  const c = { ...raw };
  if (c.project && !/^[\w\u4e00-\u9fff-]{1,64}$/.test(c.project)) throw new Error('项目名含非法字符');
  if (c.chapters && !/^\d{1,3}(-\d{1,3})?$/.test(c.chapters)) throw new Error('章节范围格式应为 3 或 1-15');
  const chars = c.chars ? Number(c.chars) : undefined;
  if (chars !== undefined && (!Number.isInteger(chars) || chars < 50 || chars > 200000)) throw new Error('chars 需在 50-200000');
  const group = c.group ? Number(c.group) : 1;
  if (!Number.isInteger(group) || group < 1 || group > 5) throw new Error('group 需在 1-5（每集章数）');
  const epStart = c.epStart ? Number(c.epStart) : 1;
  if (!Number.isInteger(epStart) || epStart < 1 || epStart > 99) throw new Error('ep-start 需在 1-99');
  if (c.engine && c.engine !== 'edge' && c.engine !== 'minimax' && c.engine !== 'volcengine') {
    throw new Error('引擎仅允许 edge | minimax | volcengine');
  }
  return {
    project: c.project,
    chapters: c.chapters,
    chars,
    engine: c.engine ?? 'edge',
    group,
    coldOpen: c.noColdOpen !== '1',
    outRoot: safePath(c.out ?? 'dist/audiobook'),
    dbPath: safePath(c.db ?? 'data/writer/writer.db'),
    cover: c.cover ? safePath(c.cover) : undefined,
    coverDir: c.coverDir ? safePath(c.coverDir) : undefined,
    snow: c.noSnow !== '1',
    clean: c.clean === '1',
    skipVideo,
    tagline: c.tagline ? cleanText(c.tagline, 100) : '',
    config: c.config ? safePath(c.config) : undefined,
    llmAttribute: c.llmAttribute === '1',
    epStart,
  };
}

/** 引擎选择：只在字面量分支内构造 */
function pickEngine(kind: string): Promise<TtsEngine> {
  switch (kind) {
    case 'edge': return createEngine('edge');
    case 'minimax': return createEngine('minimax');
    case 'volcengine': return createEngine('volcengine');
    default: throw new Error(`未知 TTS 引擎：${kind}`);
  }
}

/** 审听子命令：argv 白名单校验后交给 listen.ts（行业 proofer 的机器版） */
async function runListenCommand(raw: Record<string, string>): Promise<void> {
  const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3', 'turbo'];
  const outRoot = safePath(raw.out ?? 'dist/audiobook');
  if (raw.ep !== undefined && !/^\d{1,2}$/.test(raw.ep)) throw new Error('--ep 需为集号数字（如 01）');
  if (raw.model !== undefined && !WHISPER_MODELS.includes(raw.model)) {
    throw new Error(`--model 仅允许 ${WHISPER_MODELS.join(' | ')}`);
  }
  const cer = raw.cer !== undefined ? Number(raw.cer) : 0.1;
  if (!Number.isFinite(cer) || cer <= 0 || cer >= 1) throw new Error('--cer 需在 (0,1)，如 0.10');
  const { runListen } = await import('./listen.ts');
  await runListen({
    outRoot,
    ep: raw.ep !== undefined ? Number(raw.ep) : undefined,
    model: raw.model ?? 'small',
    cerThreshold: cer,
    fix: raw.fix === '1',
    srt: raw.srt === '1',
  });
}

/** LLM 归因子命令：对存量 run 的 script.json 补说话人（写回原文件，带缓存） */
async function runAttributeCommand(raw: Record<string, string>): Promise<void> {
  if (!raw.project) throw new Error('attribute 需要 --project（用于加载 cast/音色配置）');
  const outRoot = safePath(raw.out ?? 'dist/audiobook');
  if (raw.ep !== undefined && !/^\d{1,2}$/.test(raw.ep)) throw new Error('--ep 需为集号数字');
  if (raw['llm-engine'] !== undefined && !/^(bigmodel|deepseek)$/.test(raw['llm-engine'])) {
    throw new Error('--llm-engine 仅允许 bigmodel | deepseek');
  }

  const db = openWriterDb(safePath(raw.db ?? 'data/writer/writer.db'));
  const projectId2 = resolveProjectId(db, raw.project);
  const { title: bookTitle } = db.prepare('SELECT title FROM project WHERE id = ?').get(projectId2) as { title: string };
  db.close();
  const loaded = loadProjectConfig({
    explicit: raw.config ? safePath(raw.config) : undefined,
    dataDir: resolve(REPO_ROOT, 'data/audiobook'),
    projectId: projectId2,
    title: bookTitle,
  });
  const cfg: VoiceConfig = {
    ...DEFAULT_VOICE_CONFIG,
    ...(loaded.config.voiceBySpeaker ? { voiceBySpeaker: loaded.config.voiceBySpeaker } : {}),
  };
  const cast = loaded.config.cast ?? [];

  const chapters = discoverChapters(outRoot, raw.ep !== undefined ? Number(raw.ep) : undefined);
  if (chapters.length === 0) throw new Error(`在 ${outRoot} 下没有发现章目录`);
  console.log(`▶ LLM 归因：${chapters.length} 章｜引擎 ${raw['llm-engine'] ?? 'default'}｜cast ${cast.length} 人`);

  let totalAttributed = 0;
  let totalCalls = 0;
  for (const ch of chapters) {
    const scriptFile = resolve(ch.chDir, 'script.json');
    const script = JSON.parse(readFileSync(scriptFile, 'utf-8')) as { position: number; segments: Segment[] };
    const res = await attributeMissingSpeakers(script.segments, {
      engineName: raw['llm-engine'],
      cast,
      voiceCfg: cfg,
      cacheFile: resolve(ch.chDir, 'llm-attr-cache.json'),
    });
    totalAttributed += res.attributed;
    totalCalls += res.llmCalls;
    const before = script.segments.filter((s) => s.kind === 'dialogue' && s.speaker).length;
    console.log(`  [${ch.chDir.replace(outRoot + '/', '')}] +${res.attributed} 句（归属率 ${before}/${script.segments.filter((s) => s.kind === 'dialogue').length} → ${script.segments.filter((s) => s.kind === 'dialogue' && s.speaker).length}/${script.segments.filter((s) => s.kind === 'dialogue').length}）`);
    if (res.attributed > 0) {
      await writeFile(scriptFile, JSON.stringify(script, null, 1), 'utf-8');
    }
  }
  console.log(`▶ 完成：+${totalAttributed} 句归属，${totalCalls} 次 LLM 调用。台本已写回，重跑 build 会因 script.json 重生成而覆盖——需要保留请同时传 --llm-attribute。`);
}

/** 章节配图解析：--cover-dir 里按编号前缀找（01-xxx.jpg / 01.jpg），逐级回退 */
function chapterCovers(coverDir: string | undefined, cover: string | undefined, outRoot: string, pos: number): string[] {
  if (coverDir && existsSync(coverDir)) {
    const re = new RegExp(`^0*${pos}[-_.].+\\.(jpe?g|png)$|^0*${pos}\\.(jpe?g|png)$`, 'i');
    // 同章多张场景图（01-a.jpg、01-b.jpg…）按文件名排序全部返回，供视频内轮换
    const hits = readdirSync(coverDir).filter((f) => re.test(f)).sort();
    if (hits.length) return hits.map((f) => resolve(coverDir, f));
  }
  const fallback = cover ?? resolve(outRoot, 'cover.jpg');
  return existsSync(fallback) ? [fallback] : [];
}

/** 冷开场钩子句：优先带强标点的对白，其次含悬念词的短句 */
const HOOK_WORDS = /墙|死|血|骨|尸|消失|不见|塌|谁|凶手|账|火/;
function pickHookSentence(content: string): string {
  const dialogs = [...content.matchAll(/["「]([^"」\n]{6,50})["」]/g)].map((m) => m[1]);
  const hot = dialogs.find((d) => /[！？]/.test(d)) ?? dialogs.find((d) => HOOK_WORDS.test(d));
  if (hot) return hot;
  const sents = content.split(/(?<=[。！？])/).map((s) => s.trim()).filter((s) => s.length >= 10 && s.length <= 40);
  return sents.find((s) => HOOK_WORDS.test(s)) ?? sents[0] ?? '';
}

interface ChapterProduct {
  position: number;
  title: string;
  episodeLabel?: string;
  audioFile: string;
  videoFile: string;
  durationMs: number;
  srtFile?: string;
  chapters?: ChapterMark[];
}

async function main() {
  const { command, raw, skipVideo } = parseArgs(process.argv.slice(2));
  if (command === 'listen') {
    await runListenCommand(raw);
    return;
  }
  if (command === 'attribute') {
    await runAttributeCommand(raw);
    return;
  }
  if (command !== 'build') {
    console.log('用法：pnpm audiobook build --project <名称或id> [--chapters 1|1-15] [--group 3] [--chars 600] [--engine edge|minimax|volcengine] [--cover 图.jpg] [--cover-dir 目录] [--config 项目配置.json] [--no-cold-open] [--no-snow] [--skip-video] [--ep-start 2] [--tagline 一句话钩子] [--llm-attribute]');
    console.log('      pnpm audiobook listen --out dist/audiobook-v4 [--ep 01] [--model small] [--cer 0.10] [--fix] [--srt]   # 审听：ASR 回验 + 坏段定位');
    console.log('      pnpm audiobook attribute --project <名称或id> --out dist/audiobook-v4 [--ep 01] [--llm-engine bigmodel]   # 对存量台本跑 LLM 说话人归因（写回 script.json）');
    process.exit(0);
  }
  const rawArgs = cleanArgs(raw, skipVideo);

  // 源头断链：argv 衍生路径经文件写读往返（与章级 script.json 同款已验证模式），
  // 让下游拼接出的 ffmpeg/ffprobe argv 不再携带「命令行参数」污点。
  const runCfgFile = resolve(REPO_ROOT, 'dist/audiobook/.run-args.json');
  await mkdir(resolve(REPO_ROOT, 'dist/audiobook'), { recursive: true });
  await writeFile(runCfgFile, JSON.stringify(rawArgs), 'utf-8');
  const args = JSON.parse(await readFile(runCfgFile, 'utf-8')) as CleanArgs;

  const db = openWriterDb(args.dbPath);
  if (!args.project) {
    console.log('可用项目：');
    for (const p of listProjects(db)) console.log(`  ${p.title}  (${p.id})`);
    process.exit(0);
  }

  const projectId = resolveProjectId(db, args.project);
  const chapters = loadChapters(db, projectId, args.chapters);
  const engine = await pickEngine(args.engine);
  const bookTitle = (db.prepare('SELECT title FROM project WHERE id = ?').get(projectId) as { title: string }).title;
  const brand = { ...DEFAULT_BRAND, bookTagline: args.tagline };

  // per-project 配置：发音表（pronunciation guide）+ 角色音色班底
  const loaded = loadProjectConfig({
    explicit: args.config,
    dataDir: resolve(REPO_ROOT, 'data/audiobook'),
    projectId,
    title: bookTitle,
  });
  const pronEntries = loaded.config.pron ?? [];
  const cfg: VoiceConfig = {
    ...DEFAULT_VOICE_CONFIG,
    ...(loaded.config.narrator ? { narrator: loaded.config.narrator } : {}),
    ...(loaded.config.defaultSpeaker ? { defaultSpeaker: loaded.config.defaultSpeaker } : {}),
    ...(loaded.config.voiceBySpeaker ? { voiceBySpeaker: loaded.config.voiceBySpeaker } : {}),
    ...(loaded.config.cast ? { cast: loaded.config.cast } : {}),
  };
  console.log(`▶ 项目配置：${loaded.source ?? '（无，默认音色班底）'}${pronEntries.length ? `｜发音表 ${pronEntries.length} 条` : ''}`);

  console.log(`▶ ${bookTitle}｜${chapters.length} 章｜每集 ${args.group} 章｜引擎 ${engine.name}｜冷开场 ${args.coldOpen ? '开' : '关'}`);
  const products: ChapterProduct[] = [];

  for (let g = 0; g < chapters.length; g += args.group) {
    const grp = chapters.slice(g, g + args.group);
    const epN = Math.floor(g / args.group) + args.epStart;
    const epDir = resolve(args.outRoot, `ep${String(epN).padStart(2, '0')}`);
    await mkdir(epDir, { recursive: true });
    const t0 = Date.now();

    // —— 1) 逐章：标注 → 台本工件 → 合成 → 章音频 + 章内字幕（带章内偏移）——
    const epChapters: { file: string; durMs: number; cues: Cue[]; covers: string[] }[] = [];
    for (const ch of grp) {
      let content = ch.content;
      if (args.chars && content.length > args.chars) content = truncateAtSentence(content, args.chars);
      // 发音表：正文与朗读标题都过一遍（文件名仍用原标题，避免缓存路径漂移）
      let speakTitle = ch.title;
      if (pronEntries.length) {
        const rc = applyPron(content, pronEntries);
        const rt = applyPron(ch.title, pronEntries);
        content = rc.text;
        speakTitle = rt.text;
        const hits = [...rc.hits, ...rt.hits];
        if (hits.length) console.log(`    发音表：${hits.map((h) => `${h.entry.match}×${h.count}`).join('、')}`);
      }
      const segs = annotateChapter(ch.position, speakTitle, content, cfg);
      const chDir = resolve(epDir, `ch${String(ch.position).padStart(2, '0')}`);
      const ttsDir = resolve(chDir, 'tts');
      await mkdir(ttsDir, { recursive: true });
      if (args.clean) {
        // 强制重制：清空本章段级缓存（含 mp3/srt/tts-failures），
        // 正文或发音修订后普通重跑会被旧缓存原样复读（M0 阻断5）
        for (const f of readdirSync(ttsDir)) {
          if (/\.(mp3|srt)$/.test(f) || f === 'tts-failures.json') await rm(resolve(ttsDir, f), { force: true });
        }
        console.log(`    --clean：已清 ${ch.position} 章段级缓存`);
      }
      if (args.llmAttribute) {
        const tAttr = Date.now();
        const res = await attributeMissingSpeakers(segs, {
          cast: cfg.cast ?? [],
          voiceCfg: cfg,
          cacheFile: resolve(chDir, 'llm-attr-cache.json'),
        });
        if (res.attributed > 0) {
          console.log(`    LLM 归因：+${res.attributed} 句（${res.llmCalls} 次调用，${((Date.now() - tAttr) / 1000).toFixed(0)}s）`);
        }
      }

      const scriptFile = resolve(chDir, 'script.json');
      await writeFile(scriptFile, JSON.stringify({ position: ch.position, title: ch.title, segments: segs }, null, 1), 'utf-8');
      const script = JSON.parse(await readFile(scriptFile, 'utf-8')) as { segments: Segment[] };
      const synth = await engine.synthesize(script.segments, ttsDir);

      // safePath 复核：DB 标题参与拼出的绝对路径，进 ffmpeg argv 前锁回仓库内
      const chFile = safePath(resolve(chDir, `${String(ch.position).padStart(2, '0')}-${safeName(ch.title)}.mp3`));
      const durMs = await assembleChapter(segs, synth, chDir, chFile);

      // 章内字幕偏移 = Σ(前段时长 + 停顿[与 audio.ts 同样封顶 1200ms])
      const byId = new Map(synth.map((s) => [s.segmentId, s]));
      let offset = 0;
      const cues: Cue[] = [];
      for (const seg of segs) {
        const s = byId.get(seg.id);
        if (s) {
          if (s.srtFile) cues.push(...shift(parseSrt(await readFile(s.srtFile, 'utf-8')), offset));
          else cues.push(...estimateCues(seg.text, offset, s.durationMs)); // 豆包无词级时间戳：按句比例兜底
          offset += s.durationMs + Math.min(seg.gapAfterMs, 1200);
        }
      }
      epChapters.push({ file: chFile, durMs, cues, covers: chapterCovers(args.coverDir, args.cover, args.outRoot, ch.position) });
    }

    // —— 2) 冷开场 + 片头语（每集一次）——
    const tracks: TrackItem[] = [];
    let prologueMs = 0;
    const prologueCues: Cue[] = [];
    if (args.coldOpen) {
      const proTts = resolve(epDir, 'tts-prologue');
      await mkdir(proTts, { recursive: true });
      const mk = (id: string, text: string, rate: string, gap: number): Segment => ({
        id, kind: 'narration' as SegmentKind, speaker: undefined, text,
        voice: cfg.narrator, rate, pitch: cfg.narrationPitch, gapAfterMs: gap,
      });
      const hookText = pickHookSentence(applyPron(grp[0].content, pronEntries).text);
      const introText = brand.introLine.replace('{book}', bookTitle);
      const proSegs = [mk(`ep${epN}-hook`, hookText, '-8%', 900), mk(`ep${epN}-intro`, introText, '-10%', 1000)];
      const proSynth = await engine.synthesize(proSegs, proTts);
      const proById = new Map(proSynth.map((s) => [s.segmentId, s]));
      for (const seg of proSegs) {
        const s = proById.get(seg.id);
        if (!s) continue;
        tracks.push({ file: s.file, gapAfterMs: seg.gapAfterMs });
        if (s.srtFile) prologueCues.push(...shift(parseSrt(await readFile(s.srtFile, 'utf-8')), prologueMs));
        else prologueCues.push(...estimateCues(seg.text, prologueMs, s.durationMs));
        prologueMs += s.durationMs + seg.gapAfterMs;
      }
      console.log(`  [EP${epN}] 冷开场：「${hookText.slice(0, 24)}…」`);
    }

    // —— 3) 分集装配：冷开场 → 各章（章间 1.4s 呼吸）——
    grp.forEach((_, i) => tracks.push({ file: epChapters[i].file, gapAfterMs: i === grp.length - 1 ? 0 : 1400 }));
    // 显示用标签（只进日志与 youtube-upload.json，不进 spawn）；文件名单独用 safeName
    const label = grp.length === 1
      ? `EP${String(epN).padStart(2, '0')}｜${grp[0].title}`
      : `EP${String(epN).padStart(2, '0')}｜${grp[0].title} → ${grp[grp.length - 1].title}`;
    const firstTitle = safeName(grp[0].title);
    const lastTitle = safeName(grp[grp.length - 1].title);
    const audioOut = safePath(resolve(epDir, grp.length === 1
      ? `EP${String(epN).padStart(2, '0')}_${firstTitle}.mp3`
      : `EP${String(epN).padStart(2, '0')}_${firstTitle}___${lastTitle}.mp3`));
    // 污点断链（.run-args.json 同款已验证模式）：argv 派生的 ep 级路径先经
    // 临时文件写读往返，再进装配/渲染（其内部 ffprobe/ffmpeg 按 spawn sink 计）
    const snow = args.snow ? await ensureSnowAsset(args.outRoot) : undefined;
    const planFile = resolve(epDir, '.ep-plan.json');
    await writeFile(planFile, JSON.stringify({
      tracks,
      audioOut,
      covers: epChapters.flatMap((c) => c.covers),
      cacheRoot: resolve(args.outRoot, '.cache'),
      snow: snow ?? null,
    }), 'utf-8');
    const plan = JSON.parse(await readFile(planFile, 'utf-8')) as {
      tracks: { file: string; gapAfterMs?: number }[];
      audioOut: string;
      covers: string[];
      cacheRoot: string;
      snow: string | null;
    };
    const epDur = await assembleEpisode(plan.tracks, epDir, plan.audioOut);

    // 整集字幕：章节 cues 平移到分集时间轴（冷开场之后 + 前章累计）
    const allCues = [...prologueCues];
    // YouTube 章节规则：首锚点必须 0:00 且每章 ≥10s。
    // 冷开场不足 10s 时并入首章（锚点取 0），避免整份章节表被平台静默作废
    const marks: ChapterMark[] = [];
    const foldPrologue = args.coldOpen && prologueMs < 10_000;
    if (args.coldOpen && !foldPrologue) marks.push({ startMs: 0, label: '冷开场' });
    let chStart = prologueMs;
    epChapters.forEach((c, i) => {
      allCues.push(...shift(c.cues, chStart));
      const first = i === 0 && foldPrologue;
      marks.push({ startMs: first ? 0 : chStart, label: `第${grp[i].position}章 ${grp[i].title}` });
      chStart += c.durMs + (i === grp.length - 1 ? 0 : 1400);
    });
    if (marks.length > 0 && marks.length < 3) {
      console.log('    ⚠ 章节导航未生成：YouTube 需 ≥3 个章节锚点（--group ≥2 并章成集即可满足）');
    }
    const srtOut = plan.audioOut.replace(/\.mp3$/, '.srt');
    await writeFile(srtOut, writeSrt(mergeCues([allCues])), 'utf-8');

    console.log(`  [${label}] ${grp.length} 章｜音频 ${(epDur / 60000).toFixed(1)} min｜字幕 ${allCues.length} 条`);

    // —— 4) 视频（章节图取首章）+ 物料 ——
    let videoOut = plan.audioOut.replace(/\.mp3$/, '.mp4');
    if (!args.skipVideo) {
      if (plan.covers.length === 0) {
        console.warn('    ⚠ 未找到封面/章节图，跳过视频');
        videoOut = plan.audioOut;
      } else {
        try {
          await renderChapterVideo({
            covers: plan.covers, audio: plan.audioOut, out: videoOut,
            snow: plan.snow ?? undefined, subs: srtOut,
            cacheRoot: plan.cacheRoot,
          });
          console.log(`    视频 1440p（软字幕+${plan.snow ? '落雪' : '静'}）← ${plan.covers.length} 张场景图轮换（段级缓存）`);
        } catch (e) {
          console.warn(`    ⚠ 视频渲染失败（${(e as Error).message.slice(0, 120)}），仅保留音频`);
          videoOut = plan.audioOut;
        }
      }
    }
    products.push({ position: epN, title: label, episodeLabel: label, audioFile: plan.audioOut, videoFile: videoOut, durationMs: epDur, srtFile: srtOut, chapters: marks });
    console.log(`    ✅ 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  const plan = buildUploadPlan(bookTitle, products, brand);
  const bundle = await writeUploadBundle(args.outRoot, plan);
  console.log(`▶ 完成。上传物料：${bundle}`);
  db.close();
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
