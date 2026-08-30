/**
 * 审听（proof-listen）：行业 proofer 岗的机器版。
 *
 * 对每章：章成品音频 → whisper ASR → 按 audio.ts 同款时间窗切回逐段，
 * 段文本 vs ASR 文本算 CER（字错率）→ 出报告；坏段可 --fix 删除缓存 mp3
 * 触发重合成（段级缓存保证重跑只补坏段）。
 * --srt：用 ASR 真实时间戳重对齐整集字幕（修 estimateCues 的比例分摊漂移）。
 *
 * 章发现：outRoot 下 ep 目录内 ch 目录（含 script.json 者）；章成品 mp3 为
 * 目录内非 chapter-raw / sil 前缀的 .mp3。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { estimateCues, parseSrt, shift, writeSrt, type Cue } from './srt.ts';
import type { Segment } from './annotate.ts';

export interface ListenOptions {
  outRoot: string;
  ep?: number;            // 只审该集号
  model: string;          // whisper 模型（默认 small）
  cerThreshold: number;   // suspect 阈值（默认 0.10）；bad 固定 0.30
  fix: boolean;           // 删除 missing/bad 段缓存，触发重跑重合成
  srt: boolean;           // 重对齐整集字幕
}

type Verdict = 'ok' | 'suspect' | 'bad' | 'missing' | 'silent' | 'short';

export interface SegmentAudit {
  id: string;
  verdict: Verdict;
  cer: number;            // -1 = 不适用（missing/silent/short）
  ref: string;
  hyp: string;
  startMs: number;        // 章内时间窗
}

export interface ChapterAudit {
  dir: string;            // 相对 outRoot
  audioMs: number;
  segmentsTotal: number;
  counts: Record<Verdict, number>;
  worst: SegmentAudit[];  // 按 cer 降序前 10（suspect/bad）
}

const BAD_CER = 0.30;
const WHISPER_TIMEOUT_MS = 30 * 60_000;

// ── 纯函数（单测覆盖）──────────────────────────────────────────

/** whisper zh 偶发繁体输出：高频繁简差异字归一（比对用，不求全覆盖） */
const T2S_PAIRS = [
  '們们', '個个', '時时', '說说', '話话', '來来', '對对', '過过', '還还', '沒没',
  '進进', '開开', '車车', '間间', '點点', '後后', '裡里', '見见', '聽听', '長长',
  '張张', '誰谁', '發发', '電电', '機机', '鐵铁', '線线', '廠厂', '東东', '訊讯',
  '處处', '務务', '經经', '濟济', '現现', '樣样', '覺觉', '轉转', '頭头', '門门',
  '問问', '邊边', '聲声', '響响', '應应', '滿满', '濕湿', '淨净', '潔洁', '燒烧',
  '燙烫', '熱热', '凍冻', '風风', '霧雾', '煙烟', '氣气', '帶带', '給给', '幾几',
  '條条', '塊块', '種种', '語语', '數数', '學学', '師师', '醫医', '藥药', '針针',
  '繡绣', '樹树', '嶺岭', '鎮镇', '廳厅', '牆墙', '磚砖', '塵尘', '礦矿', '該该',
  '當当', '實实', '確确', '認认', '識识', '報报', '紙纸', '輛辆', '馬马', '騎骑',
  '駕驾', '駛驶', '驚惊', '嚇吓', '夢梦', '陣阵', '漸渐', '緩缓', '輕轻', '緊紧',
  '鬆松', '斷断', '續续', '結结', '繩绳', '絲丝', '縫缝', '補补', '爛烂', '舊旧',
  '紅红', '藍蓝', '綠绿', '黃黄', '顏颜', '淺浅', '燈灯', '暗暗', '影影', '靜静',
  '隱隐', '顯显', '飄飘', '動动', '體体', '髮发', '臉脸', '齒齿', '肩膀', '膚肤',
  '腳脚', '蓋盖', '邊边', '鐘钟', '錶表', '銀银', '錢钱', '銅铜', '鐵铁', '鏽锈',
  '鎖锁', '鑰钥', '鑽钻', '開开', '關关', '閉闭', '閃闪', '悶闷', '問问', '聞闻',
  '腦脑', '臟脏', '騰腾', '觀观', '視视', '覽览', '親亲', '覺觉', '攝摄', '斷断',
  '煩烦', '燙烫', '瘋疯', '療疗', '癮瘾', '發发', '皺皱', '盡尽', '監监', '盤盘',
  '眾众', '睏困', '瞇眯', '矇蒙', '瞞瞒', '知知', '短短', '石石', '碼码', '確确',
  '這这', '為为', '麼么', '從从', '環环', '亂乱', '樓楼', '總总', '記记', '難难',
  '飯饭', '餓饿', '飲饮', '廚厨', '廁厕', '衛卫', '趕赶', '軟软', '較较', '懷怀',
  '槍枪', '彈弹', '傷伤', '護护', '屍尸', '鬥斗', '戰战', '號号', '嘆叹', '噴喷',
  '圍围', '壓压', '搖摇', '擺摆', '擊击', '擋挡', '擲掷', '敵敌',
];
const T2S: Record<string, string> = {};
for (const pair of T2S_PAIRS) {
  if (pair[0] !== pair[1]) T2S[pair[0]] = pair[1]; // 跳过同形对（無效但无害）
}

const CN_DIGIT: Record<string, string> = { 零: '0', 〇: '0', 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' };
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 中文数字串→阿拉伯：一九九八→1998；十二→12；两百→200；解析失败原样返回 */
function cnRunToDigits(run: string): string {
  if ([...run].every((c) => c in CN_DIGIT)) return [...run].map((c) => CN_DIGIT[c]).join('');
  let num = 0;
  let cur = 0;
  for (const c of run) {
    if (c in CN_DIGIT && c !== '零' && c !== '〇') cur = cur * 10 + Number(CN_DIGIT[c]);
    else if (c === '零' || c === '〇') continue;
    else if (c in CN_UNIT) {
      num += (cur || 1) * CN_UNIT[c];
      cur = 0;
    } else if (c === '万') {
      num = (num + cur) * 10000;
      cur = 0;
    } else return run;
  }
  return String(num + cur);
}

/** CER 归一：繁→简、中文数字→阿拉伯数字、只留汉字/字母/数字、小写 */
export function normForCer(text: string): string {
  const t2s = [...text].map((c) => T2S[c] ?? c).join('');
  const numed = t2s.replace(/[零〇一二两三四五六七八九十百千万]+/g, (run) => cnRunToDigits(run));
  return numed.replace(/[^一-鿿a-zA-Z0-9]/g, '').toLowerCase();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function cerOf(ref: string, hyp: string): number {
  const r = normForCer(ref);
  const h = normForCer(hyp);
  if (!r.length) return -1;
  return levenshtein(r, h) / r.length;
}

/**
 * 半全局对齐：ref 作为 needle 在 haystack 里滑动匹配，不罚首尾插入。
 * 用于邻窗救援——whisper 一行吞掉 2-3 个 TTS 段时，段文本其实都被念了，
 * 只是整行被记到某个窗名下；普通 CER 会被插入字符灌水。
 * 返回 dist / len(ref)；haystack 过短返回 Infinity。
 */
export function cerInHaystack(ref: string, haystack: string): number {
  const r = normForCer(ref);
  const h = normForCer(haystack);
  if (!r.length || h.length < r.length) return Number.POSITIVE_INFINITY;
  // DP：首行 0（起点免费），末行取 min（终点免费）
  let prev = new Array<number>(h.length + 1).fill(0);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.min(...prev) / r.length;
}

export interface AsrLine { startMs: number; endMs: number; text: string }

/** ASR 行按 ≥50% 时长落窗归属（跨窗行归重叠多的一侧） */
export function linesInWindow(lines: AsrLine[], winStart: number, winEnd: number): AsrLine[] {
  return lines.filter((l) => {
    const overlap = Math.min(l.endMs, winEnd) - Math.max(l.startMs, winStart);
    return overlap > 0.5 * Math.max(1, l.endMs - l.startMs);
  });
}

/**
 * 段内字幕真实对齐：把 seg.text 按 estimateCues 切句，但时长摊到
 * ASR 实测语音跨度（首行 start → 末行 end）而非名义时长。
 * 无 ASR 行（静音/漏段）退回名义窗口比例分摊。
 */
export function realignSegmentCues(segText: string, lines: AsrLine[], winStart: number, winEnd: number): Cue[] {
  const inWin = linesInWindow(lines, winStart, winEnd);
  if (inWin.length === 0) return estimateCues(segText, winStart, winEnd - winStart);
  const obsStart = Math.max(winStart, inWin[0].startMs);
  const obsEnd = Math.min(winEnd, inWin[inWin.length - 1].endMs);
  if (obsEnd - obsStart < 200) return estimateCues(segText, winStart, winEnd - winStart);
  return estimateCues(segText, obsStart, obsEnd - obsStart);
}

// ── 基础设施 ─────────────────────────────────────────────────

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      stderr += `\n[timeout] ${timeoutMs}ms`;
      p.kill('SIGKILL');
    }, timeoutMs);
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => {
      clearTimeout(timer);
      res({ code: code ?? 1, stderr });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      res({ code: 1, stderr: String(e) });
    });
  });
}

/** 章成品 ASR：whisper → json；结果缓存于 chDir/listen/asr.json（音频 newer 则重跑） */
async function transcribe(audio: string, cacheDir: string, model: string): Promise<AsrLine[]> {
  const cacheFile = join(cacheDir, 'asr.json');
  if (existsSync(cacheFile) && statSync(audio).mtimeMs <= statSync(cacheFile).mtimeMs) {
    return JSON.parse(readFileSync(cacheFile, 'utf-8')) as AsrLine[];
  }
  await mkdir(cacheDir, { recursive: true });
  const r = await run('whisper', [
    audio,
    '--model', model,
    '--language', 'zh',
    '--output_format', 'json',
    '--output_dir', cacheDir,
    '--condition_on_previous_text', 'False',
    '--verbose', 'False',
  ], WHISPER_TIMEOUT_MS);
  // whisper 输出 <basename>.json
  const base = audio.split('/').pop()!.replace(/\.[^.]+$/, '');
  const outFile = join(cacheDir, `${base}.json`);
  if (r.code !== 0 || !existsSync(outFile)) {
    throw new Error(`whisper 失败（code ${r.code}）：${r.stderr.slice(-300)}`);
  }
  const parsed = JSON.parse(readFileSync(outFile, 'utf-8')) as { segments?: { start: number; end: number; text: string }[] };
  const lines: AsrLine[] = (parsed.segments ?? []).map((s) => ({
    startMs: Math.round(s.start * 1000),
    endMs: Math.round(s.end * 1000),
    text: (s.text ?? '').trim(),
  }));
  await writeFile(cacheFile, JSON.stringify(lines), 'utf-8');
  return lines;
}

interface ChapterDir {
  epDir: string;
  chDir: string;
  ep: number;
  audio: string;
}

/** 发现 outRoot 下 ep 目录内的 ch 章目录与章成品音频 */
export function discoverChapters(outRoot: string, epFilter?: number): ChapterDir[] {
  const out: ChapterDir[] = [];
  for (const d of readdirSync(outRoot, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^ep\d{1,2}$/.test(d.name)) continue;
    const ep = Number(d.name.slice(2));
    if (epFilter !== undefined && ep !== epFilter) continue;
    const epDir = join(outRoot, d.name);
    for (const c of readdirSync(epDir, { withFileTypes: true })) {
      if (!c.isDirectory() || !/^ch\d{1,2}$/.test(c.name)) continue;
      const chDir = join(epDir, c.name);
      if (!existsSync(join(chDir, 'script.json'))) continue;
      const audio = readdirSync(chDir)
        .filter((f) => f.endsWith('.mp3') && !/^(chapter-raw|sil-)/.test(f))
        .sort()[0];
      if (audio) out.push({ epDir, chDir, ep, audio: join(chDir, audio) });
    }
  }
  return out.sort((a, b) => a.ep - b.ep || a.chDir.localeCompare(b.chDir));
}

/** 与 audio.ts 装配口径一致：段窗 = Σ(前段时长 + min(gap,1200)) */
function segmentWindows(segs: Segment[], durOf: (id: string) => number | undefined): { seg: Segment; startMs: number; endMs: number }[] {
  const wins: { seg: Segment; startMs: number; endMs: number }[] = [];
  let offset = 0;
  for (const seg of segs) {
    const dur = durOf(seg.id);
    if (dur !== undefined) {
      wins.push({ seg, startMs: offset, endMs: offset + dur });
      offset += dur + Math.min(seg.gapAfterMs, 1200);
    }
    // 无音频（合成失败）的段不占窗口：下一可听段紧接其后（装配时被跳过）
  }
  return wins;
}

// ── 主流程 ───────────────────────────────────────────────────

export async function runListen(opts: ListenOptions): Promise<void> {
  const chapters = discoverChapters(opts.outRoot, opts.ep);
  if (chapters.length === 0) throw new Error(`在 ${opts.outRoot} 下没有发现 ep*/ch*/script.json 章目录`);
  console.log(`▶ 审听：${chapters.length} 章｜whisper ${opts.model}｜suspect>${opts.cerThreshold} bad≥${BAD_CER}${opts.fix ? '｜fix 开' : ''}${opts.srt ? '｜srt 重对齐开' : ''}`);

  const report: { generatedAt: string; model: string; cerThreshold: number; chapters: ChapterAudit[]; fixDeleted: string[] } = {
    generatedAt: new Date().toISOString(),
    model: opts.model,
    cerThreshold: opts.cerThreshold,
    chapters: [],
    fixDeleted: [],
  };
  // srt 重对齐按集聚合章结果，集内全部审完再重写
  const chaptersByEp = new Map<number, ChapterDir[]>();
  for (const ch of chapters) {
    const list = chaptersByEp.get(ch.ep) ?? [];
    list.push(ch);
    chaptersByEp.set(ch.ep, list);
  }

  for (const ch of chapters) {
    const script = JSON.parse(readFileSync(join(ch.chDir, 'script.json'), 'utf-8')) as { segments: Segment[] };
    const ttsDir = join(ch.chDir, 'tts');
    const durOf = (id: string): number | undefined => {
      const f = join(ttsDir, `${id}.mp3`);
      return existsSync(f) && statSync(f).size > 512 ? ffprobeDurationMsSync(f) : undefined;
    };
    const audioMs = ffprobeDurationMsSync(ch.audio);
    const lines = await transcribe(ch.audio, join(ch.chDir, 'listen'), opts.model);

    const counts: Record<Verdict, number> = { ok: 0, suspect: 0, bad: 0, missing: 0, silent: 0, short: 0 };
    const flagged: SegmentAudit[] = [];
    const windows = segmentWindows(script.segments, durOf);

    // 两遍式：先取各窗 ASR 文本（邻窗救援要用），再判级
    const hypBySeg = new Map(windows.map((w) => {
      const hyp = linesInWindow(lines, w.startMs, w.endMs).map((l) => l.text).join('');
      return [w.seg.id, hyp] as const;
    }));
    const hypNear = (idx: number, radius = 2): string => {
      let out = '';
      for (let k = Math.max(0, idx - radius); k <= Math.min(windows.length - 1, idx + radius); k++) {
        out += hypBySeg.get(windows[k].seg.id) ?? '';
      }
      return out;
    };

    for (const seg of script.segments) {
      const audit: SegmentAudit = { id: seg.id, verdict: 'ok', cer: -1, ref: seg.text, hyp: '', startMs: 0 };
      const wIdx = windows.findIndex((x) => x.seg.id === seg.id);
      if (wIdx < 0) {
        audit.verdict = 'missing'; // 无缓存音频：合成失败被跳过的段
        counts.missing += 1;
        flagged.push(audit);
        continue;
      }
      const w = windows[wIdx];
      audit.startMs = w.startMs;
      const hyp = hypBySeg.get(seg.id) ?? '';
      audit.hyp = hyp;
      const refLen = normForCer(seg.text).length;
      if (refLen < 4) {
        audit.verdict = 'short';
        counts.short += 1;
        continue;
      }
      if (normForCer(hyp).length === 0) {
        // 邻窗救援：whisper 行粒度≠段粒度，短段常被并入邻行转写——
        // ±2 窗拼接文本里能滑到本段文字，就是时序伪影而非静音事故
        const rescued = cerInHaystack(seg.text, hypNear(wIdx));
        if (rescued <= opts.cerThreshold) {
          counts.ok += 1;
          continue;
        }
        audit.verdict = 'silent'; // 有音频但 ASR 全程没听见：空音频/爆音/电平事故
        counts.silent += 1;
        flagged.push(audit);
        continue;
      }
      audit.cer = cerOf(seg.text, hyp);
      if (audit.cer > opts.cerThreshold) {
        // 邻窗救援：行跨界污染邻段（整行吞多段）时用半全局对齐降级
        const best = Math.min(audit.cer, cerInHaystack(seg.text, hypNear(wIdx)));
        if (best <= opts.cerThreshold) {
          audit.cer = best;
          counts.ok += 1;
          continue;
        }
        audit.cer = best;
        audit.verdict = audit.cer >= BAD_CER ? 'bad' : 'suspect';
        counts[audit.verdict] += 1;
        flagged.push(audit);
      } else {
        counts.ok += 1;
      }
    }
    const worst = flagged.filter((f) => f.verdict === 'bad' || f.verdict === 'suspect' || f.verdict === 'missing' || f.verdict === 'silent')
      .sort((a, b) => b.cer - a.cer)
      .slice(0, 10);
    report.chapters.push({ dir: ch.chDir.replace(opts.outRoot + '/', ''), audioMs, segmentsTotal: script.segments.length, counts, worst });

    const problems = counts.bad + counts.suspect + counts.missing + counts.silent;
    console.log(`  [${ch.chDir.replace(opts.outRoot + '/', '')}] ok ${counts.ok}｜suspect ${counts.suspect}｜bad ${counts.bad}｜missing ${counts.missing}｜silent ${counts.silent}${problems ? '' : '  ✅'}`);
    for (const w0 of worst.slice(0, 3)) {
      console.log(`    ${w0.verdict} ${w0.id} cer=${w0.cer.toFixed(2)}@${(w0.startMs / 1000).toFixed(1)}s 「${w0.ref.slice(0, 18)}」⇢ ASR「${normForCer(w0.hyp).slice(0, 18)}」`);
    }

    if (opts.fix) {
      for (const f of flagged) {
        if (f.verdict !== 'bad' && f.verdict !== 'missing' && f.verdict !== 'silent') continue;
        const mp3 = join(ttsDir, `${f.id}.mp3`);
        const srt = join(ttsDir, `${f.id}.srt`);
        if (existsSync(mp3)) await rm(mp3);
        if (existsSync(srt)) await rm(srt);
        report.fixDeleted.push(`${ch.chDir.replace(opts.outRoot + '/', '')}/tts/${f.id}.mp3`);
      }
    }
  }

  // 报告按集 merge：单集重审只更新本次审的章，其余章沿用旧报告
  // （M0 阻断2：整文件覆盖会把他集 QA 结果写丢）
  const reportFile = join(opts.outRoot, 'listen-report.json');
  interface OldReport { generatedAt?: string; model?: string; cerThreshold?: number; chapters?: ChapterAudit[]; fixDeleted?: string[] }
  const old = (() => {
    try {
      return JSON.parse(readFileSync(reportFile, 'utf-8')) as OldReport;
    } catch {
      return {} as OldReport;
    }
  })();
  const audited = new Set(report.chapters.map((c) => c.dir));
  const merged = [...(old.chapters ?? []).filter((c) => !audited.has(c.dir)), ...report.chapters]
    .sort((a, b) => a.dir.localeCompare(b.dir));
  const finalReport = { ...report, chapters: merged };
  await writeFile(reportFile, JSON.stringify(finalReport, null, 1), 'utf-8');
  const totalBad = finalReport.chapters.reduce((a, c) => a + c.counts.bad + c.counts.missing + c.counts.silent, 0);
  const totalSuspect = finalReport.chapters.reduce((a, c) => a + c.counts.suspect, 0);
  console.log(`▶ 报告：${reportFile}｜按集合并后共 ${finalReport.chapters.length} 章｜P0 ${totalBad}｜suspect ${totalSuspect}`);
  if (report.fixDeleted.length) {
    console.log(`▶ 已删除 ${report.fixDeleted.length} 个坏段缓存。重跑同一条 build 命令即可只重合成这些段（段级缓存）。`);
  }

  if (opts.srt) {
    for (const [ep, eps] of chaptersByEp) {
      await realignEpisodeSrt(opts.outRoot, ep, eps);
    }
  }
}

/** ffprobe 同步包装：章内段数 ≤ 数百，单次 ~30ms，总量可接受（15 章 × 150 段 ≈ 70s） */
function ffprobeDurationMsSync(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf-8' });
  return Math.round(Number(out.trim()) * 1000);
}

/**
 * 整集字幕重对齐：以 ep-concat.txt 为权威时间线（每个成员 ffprobe），
 * 章内用 ASR 实测跨度切句（realignSegmentCues），片头语用段级 srt（如有）。
 */
async function realignEpisodeSrt(outRoot: string, ep: number, eps: ChapterDir[]): Promise<void> {
  const epDir = eps[0].epDir;
  const concatFile = join(epDir, 'ep-concat.txt');
  if (!existsSync(concatFile)) {
    console.log(`  [ep${ep}] 无 ep-concat.txt，跳过 srt 重对齐`);
    return;
  }
  const entries = readFileSync(concatFile, 'utf-8')
    .split('\n').map((l) => l.trim()).filter((l) => l.startsWith('file '))
    .map((l) => l.slice(5).trim().replace(/^'|'$/g, ''))
    .map((f) => resolve(epDir, f));

  // 时间线：每个成员的真实时长 → 后续成员的起点
  const startOf = new Map<string, number>();
  let t = 0;
  for (const f of entries) {
    if (!existsSync(f)) continue;
    startOf.set(f, t);
    t += ffprobeDurationMsSync(f);
  }

  const cues: Cue[] = [];
  // 片头语：tts-prologue 段级 srt（edge 引擎产物）存在则按时间线平移
  const proDir = join(epDir, 'tts-prologue');
  if (existsSync(proDir)) {
    for (const f of readdirSync(proDir).filter((x) => x.endsWith('.srt')).sort()) {
      const mp3 = join(proDir, f.replace(/\.srt$/, '.mp3'));
      const start = startOf.get(mp3);
      if (start === undefined) continue;
      cues.push(...shift(parseSrt(readFileSync(join(proDir, f), 'utf-8')), start));
    }
  }
  // 各章：ASR 重对齐 cues 平移到集时间轴
  for (const ch of eps) {
    const script = JSON.parse(readFileSync(join(ch.chDir, 'script.json'), 'utf-8')) as { segments: Segment[] };
    const lines: AsrLine[] = existsSync(join(ch.chDir, 'listen', 'asr.json'))
      ? (JSON.parse(readFileSync(join(ch.chDir, 'listen', 'asr.json'), 'utf-8')) as AsrLine[])
      : [];
    const chStart = startOf.get(ch.audio);
    if (chStart === undefined) continue;
    const ttsDir = join(ch.chDir, 'tts');
    const windows = segmentWindows(script.segments, (id) => {
      const f = join(ttsDir, `${id}.mp3`);
      return existsSync(f) && statSync(f).size > 512 ? ffprobeDurationMsSync(f) : undefined;
    });
    for (const w of windows) {
      // 词级 srt（edge 引擎产物）优先：比 ASR 跨度比例分摊更准；
      // 无 srt（豆包等）才走 ASR 重对齐——修 estimateCues 比例分摊的漂移
      const segSrt = join(ttsDir, `${w.seg.id}.srt`);
      if (existsSync(segSrt) && statSync(segSrt).size > 0) {
        cues.push(...shift(parseSrt(readFileSync(segSrt, 'utf-8')), chStart + w.startMs));
      } else {
        cues.push(...shift(realignSegmentCues(w.seg.text, lines, w.startMs, w.endMs), chStart));
      }
    }
  }

  if (cues.length === 0) return;
  cues.sort((a, b) => a.startMs - b.startMs);
  const epAudios = readdirSync(epDir).filter((f) => f.endsWith('.mp3') && !/^(ep-raw|sil-)/.test(f));
  const srtFile = epAudios.length ? join(epDir, epAudios[0].replace(/\.mp3$/, '.srt')) : join(epDir, `ep${ep}.srt`);
  const bak = `${srtFile}.bak`;
  if (existsSync(srtFile) && !existsSync(bak)) await rename(srtFile, bak); // 只保留最初的原始稿
  await writeFile(srtFile, writeSrt(cues), 'utf-8');
  console.log(`  [ep${ep}] 字幕重对齐：${cues.length} 条（原始稿备份 .bak）→ ${srtFile.split('/').pop()}`);
}
