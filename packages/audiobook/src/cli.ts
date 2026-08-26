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
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { openWriterDb, resolveProjectId, loadChapters, listProjects } from './db.ts';
import { annotateChapter, DEFAULT_VOICE_CONFIG, type Segment, type SegmentKind } from './annotate.ts';
import { createEngine, type TtsEngine, type SynthResult } from './tts/index.ts';
import { assembleChapter } from './audio.ts';
import { assembleEpisode, type TrackItem } from './episode.ts';
import { renderChapterVideo } from './video.ts';
import { ensureSnowAsset } from './assets.ts';
import { parseSrt, shift, mergeCues, writeSrt, type Cue } from './srt.ts';
import { buildUploadPlan, writeUploadBundle, DEFAULT_BRAND } from './youtube.ts';

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
  tagline: string;
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
      case '--no-cold-open': raw.noColdOpen = '1'; break;
      case '--skip-video': skipVideo = true; break;
      case '--tagline': raw.tagline = next(); break;
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
  if (c.engine && c.engine !== 'edge' && c.engine !== 'minimax') throw new Error('引擎仅允许 edge | minimax');
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
    skipVideo,
    tagline: c.tagline ? cleanText(c.tagline, 100) : '',
  };
}

/** 引擎选择：只在字面量分支内构造 */
function pickEngine(kind: string): Promise<TtsEngine> {
  switch (kind) {
    case 'edge': return createEngine('edge');
    case 'minimax': return createEngine('minimax');
    default: throw new Error(`未知 TTS 引擎：${kind}`);
  }
}

/** 章节配图解析：--cover-dir 里按编号前缀找（01-xxx.jpg / 01.jpg），逐级回退 */
function chapterCover(coverDir: string | undefined, cover: string | undefined, outRoot: string, pos: number): string {
  if (coverDir && existsSync(coverDir)) {
    const re = new RegExp(`^0*${pos}[-_.].+\\.(jpe?g|png)$|^0*${pos}\\.(jpe?g|png)$`, 'i');
    const hit = readdirSync(coverDir).find((f) => re.test(f));
    if (hit) return resolve(coverDir, hit);
  }
  const fallback = cover ?? resolve(outRoot, 'cover.jpg');
  return existsSync(fallback) ? fallback : '';
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
}

async function main() {
  const { command, raw, skipVideo } = parseArgs(process.argv.slice(2));
  if (command !== 'build') {
    console.log('用法：pnpm audiobook build --project <名称或id> [--chapters 1|1-15] [--group 3] [--chars 600] [--engine edge|minimax] [--cover 图.jpg] [--cover-dir 目录] [--no-cold-open] [--no-snow] [--skip-video] [--tagline 一句话钩子]');
    process.exit(0);
  }
  const args = cleanArgs(raw, skipVideo);

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
  const cfg = DEFAULT_VOICE_CONFIG;

  console.log(`▶ ${bookTitle}｜${chapters.length} 章｜每集 ${args.group} 章｜引擎 ${engine.name}｜冷开场 ${args.coldOpen ? '开' : '关'}`);
  const products: ChapterProduct[] = [];

  for (let g = 0; g < chapters.length; g += args.group) {
    const grp = chapters.slice(g, g + args.group);
    const epN = Math.floor(g / args.group) + 1;
    const epDir = resolve(args.outRoot, `ep${String(epN).padStart(2, '0')}`);
    await mkdir(epDir, { recursive: true });
    const t0 = Date.now();

    // —— 1) 逐章：标注 → 台本工件 → 合成 → 章音频 + 章内字幕（带章内偏移）——
    const epChapters: { file: string; durMs: number; cues: Cue[]; cover: string }[] = [];
    for (const ch of grp) {
      let content = ch.content;
      if (args.chars && content.length > args.chars) content = content.slice(0, args.chars);
      const segs = annotateChapter(ch.position, ch.title, content, cfg);
      const chDir = resolve(epDir, `ch${String(ch.position).padStart(2, '0')}`);
      const ttsDir = resolve(chDir, 'tts');
      await mkdir(ttsDir, { recursive: true });

      const scriptFile = resolve(chDir, 'script.json');
      await writeFile(scriptFile, JSON.stringify({ position: ch.position, title: ch.title, segments: segs }, null, 1), 'utf-8');
      const script = JSON.parse(await readFile(scriptFile, 'utf-8')) as { segments: Segment[] };
      const synth = await engine.synthesize(script.segments, ttsDir);

      const chFile = resolve(chDir, `${String(ch.position).padStart(2, '0')}-${ch.title}.mp3`);
      const durMs = await assembleChapter(segs, synth, chDir, chFile);

      // 章内字幕偏移 = Σ(前段时长 + 停顿[与 audio.ts 同样封顶 1200ms])
      const byId = new Map(synth.map((s) => [s.segmentId, s]));
      let offset = 0;
      const cues: Cue[] = [];
      for (const seg of segs) {
        const s = byId.get(seg.id);
        if (s) {
          if (s.srtFile) cues.push(...shift(parseSrt(await readFile(s.srtFile, 'utf-8')), offset));
          offset += s.durationMs + Math.min(seg.gapAfterMs, 1200);
        }
      }
      epChapters.push({ file: chFile, durMs, cues, cover: chapterCover(args.coverDir, args.cover, args.outRoot, ch.position) });
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
      const hookText = pickHookSentence(grp[0].content);
      const introText = brand.introLine.replace('{book}', bookTitle);
      const proSegs = [mk(`ep${epN}-hook`, hookText, '-8%', 900), mk(`ep${epN}-intro`, introText, '-10%', 1000)];
      const proSynth = await engine.synthesize(proSegs, proTts);
      const proById = new Map(proSynth.map((s) => [s.segmentId, s]));
      for (const seg of proSegs) {
        const s = proById.get(seg.id);
        if (!s) continue;
        tracks.push({ file: s.file, gapAfterMs: seg.gapAfterMs });
        if (s.srtFile) prologueCues.push(...shift(parseSrt(await readFile(s.srtFile, 'utf-8')), prologueMs));
        prologueMs += s.durationMs + seg.gapAfterMs;
      }
      console.log(`  [EP${epN}] 冷开场：「${hookText.slice(0, 24)}…」`);
    }

    // —— 3) 分集装配：冷开场 → 各章（章间 1.4s 呼吸）——
    grp.forEach((_, i) => tracks.push({ file: epChapters[i].file, gapAfterMs: i === grp.length - 1 ? 0 : 1400 }));
    const label = grp.length === 1
      ? `EP${String(epN).padStart(2, '0')}｜${grp[0].title}`
      : `EP${String(epN).padStart(2, '0')}｜${grp[0].title} → ${grp[grp.length - 1].title}`;
    const audioOut = resolve(epDir, `${label.replace(/[｜→\s]/g, '_')}.mp3`);
    const epDur = await assembleEpisode(tracks, epDir, audioOut);

    // 整集字幕：章节 cues 平移到分集时间轴（冷开场之后 + 前章累计）
    const allCues = [...prologueCues];
    let chStart = prologueMs;
    epChapters.forEach((c, i) => {
      allCues.push(...shift(c.cues, chStart));
      chStart += c.durMs + (i === grp.length - 1 ? 0 : 1400);
    });
    const srtOut = audioOut.replace(/\.mp3$/, '.srt');
    await writeFile(srtOut, writeSrt(mergeCues([allCues])), 'utf-8');

    console.log(`  [${label}] ${grp.length} 章｜音频 ${(epDur / 60000).toFixed(1)} min｜字幕 ${allCues.length} 条`);

    // —— 4) 视频（章节图取首章）+ 物料 ——
    let videoOut = audioOut.replace(/\.mp3$/, '.mp4');
    if (!args.skipVideo) {
      const cover = epChapters[0].cover;
      if (!cover) {
        console.warn('    ⚠ 未找到封面/章节图，跳过视频');
        videoOut = audioOut;
      } else {
        const snow = args.snow ? await ensureSnowAsset(args.outRoot) : undefined;
        try {
          await renderChapterVideo({ cover, audio: audioOut, out: videoOut, snow, subs: srtOut });
          console.log(`    视频 1080p（软字幕+${snow ? '落雪' : '静'}）← ${cover.split('/').pop()}`);
        } catch (e) {
          console.warn(`    ⚠ 视频渲染失败（${(e as Error).message.slice(0, 120)}），仅保留音频`);
          videoOut = audioOut;
        }
      }
    }
    products.push({ position: epN, title: label, episodeLabel: label, audioFile: audioOut, videoFile: videoOut, durationMs: epDur, srtFile: srtOut });
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
