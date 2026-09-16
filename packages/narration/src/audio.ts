/**
 * S4 多轨音频：解说主轨 + 证物引语轨（换音色+EQ）+ beat 间隙节奏。
 * 复用 audiobook TTS 引擎（volcengine 悬疑解说音色已实测）与 ffmpeg 封装。
 * 产出：句级 mp3（缓存）→ 时长回填 script.timed.json → 全片 narration.mp3 + 句级 SRT。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type NarrationScript, type NarrationBeat, flattenBeats, flattenSentences,
} from '@novel-eval/shared';
import { createEngine as createTtsEngine, type TtsEngine } from '@novel-eval/audiobook/tts';
import type { Segment } from '@novel-eval/audiobook/annotate';
import { writeSrt, type Cue } from '@novel-eval/audiobook/srt';
import { ffprobeDurationMs, ffmpeg } from '@novel-eval/audiobook/ffmpeg';

/** 音色班底（edge voice 键 → volcengine VOICE_MAP 落到豆包音色） */
const NARRATOR_VOICE = 'zh-CN-YunjianNeural';   // → 悬疑解说（旁白主轨）
const QUOTE_VOICES: Record<string, string> = {
  elderly_warm: 'zh-CN-XiaohanNeural',          // 温柔淑女 → 母亲遗言/录音笔
};

/** beat 收尾停顿（口播节奏；turn/peak 后多留半拍） */
const GAP_BY_KIND: Record<NarrationBeat['kind'], number> = {
  hook: 1100, turn: 650, peak: 800, close: 900, coda: 1400,
};
const GAP_SENTENCE = 180;

export interface AudioOptions {
  script: NarrationScript;
  outDir: string;
  ttsEngine: string;             // 'volcengine' | 'edge'
}

export interface AudioResult {
  mp3: string;
  srt: string;
  timedScript: string;
  totalMs: number;
  missing: string[];             // 缺段 id（质量门：必须为空）
  /** 本跑真实送进 TTS 引擎的字数（缓存命中不计——成本台账只记新花费） */
  synthChars: number;
}

export async function buildAudio(opts: AudioOptions): Promise<AudioResult> {
  const ttsDir = join(opts.outDir, 'tts');
  mkdirSync(ttsDir, { recursive: true });
  const engine: TtsEngine = await createTtsEngine(opts.ttsEngine);

  // ── 1. 句级合成（主轨+引语轨统一走 Segment；quote 换 voice）──
  const segments: Segment[] = flattenSentences(opts.script).map((s, i) => ({
    id: s.id,
    text: s.text,
    kind: s.quote ? 'dialogue' : 'narration',
    voice: s.quote ? (QUOTE_VOICES[s.quote.voice] ?? NARRATOR_VOICE) : NARRATOR_VOICE,
    rate: '0%',
    pitch: '+0Hz',
    gapAfterMs: 0,
    // 句号偏移量 i 仅作排序锚，真实顺序由数组保序
  }));

  // 缺段质量门（audiobook synthesizeWithGate 同款思路：一轮补跑）。
  // 合成前快照各段缓存文件 mtime：跑完后 mtime 变化/新建 = 本跑真实合成（成本口径）
  const mtimeBefore = new Map<string, number>();
  for (const s of segments) {
    const f = join(ttsDir, `${s.id}.mp3`);
    if (existsSync(f)) mtimeBefore.set(s.id, statSync(f).mtimeMs);
  }
  let results = await engine.synthesize(segments, ttsDir);
  const missing1 = segments.filter((s) => !results.some((r) => r.segmentId === s.id));
  if (missing1.length > 0) {
    console.warn(`⚠ 缺 ${missing1.length} 段，冷却补跑一轮…`);
    await new Promise((r) => setTimeout(r, 90_000));
    const fix = await engine.synthesize(missing1, ttsDir);
    results = results.concat(fix);
  }
  let synthChars = 0;
  for (const s of segments) {
    const f = join(ttsDir, `${s.id}.mp3`);
    const m = existsSync(f) ? statSync(f).mtimeMs : 0;
    if (mtimeBefore.get(s.id) !== m) synthChars += s.text.length;
  }
  const byId = new Map(results.map((r) => [r.segmentId, r]));
  const missing = segments.filter((s) => !byId.get(s.id)).map((s) => s.id);

  // ── 2. 引语 EQ（recorder/phone 滤镜，产品评审：证物音色要有"介质感"）──
  for (const s of flattenSentences(opts.script)) {
    if (!s.quote?.eq) continue;
    const r = byId.get(s.id);
    if (!r) continue;
    const filtered = join(ttsDir, `${s.id}-eq.mp3`);
    if (!existsSync(filtered) || statSync(filtered).size < 1000) {
      const hp = s.quote.eq === 'phone' ? 400 : 200;
      const lp = s.quote.eq === 'phone' ? 3400 : 2800;
      await ffmpeg([
        '-y', '-i', r.file,
        '-af', `highpass=f=${hp},lowpass=f=${lp},volume=1.05`,
        '-b:a', '128k', filtered,
      ]);
    }
    r.file = filtered;
  }

  // ── 3. 时长回填 + 全片时间轴（唯一时钟源：真实 durationMs）──
  const beats = flattenBeats(opts.script);
  let cursorMs = 0;
  const cues: Cue[] = [];
  for (const b of beats) {
    b.startMs = cursorMs;
    let beatNetMs = 0;
    for (const s of b.sentences) {
      const r = byId.get(s.id);
      const dur = r?.durationMs ?? (r?.file ? await ffprobeDurationMs(r.file) : 0);
      s.durationMs = dur;
      cues.push({ startMs: cursorMs, endMs: cursorMs + dur, text: s.text });
      cursorMs += dur + GAP_SENTENCE;
      beatNetMs += dur;
    }
    cursorMs -= GAP_SENTENCE;               // 句间隙不收尾拍
    b.durationMs = beatNetMs;
    cursorMs += GAP_BY_KIND[b.kind];        // 拍间隙
  }
  const totalMs = cursorMs;

  // ── 4. 装配全片：concat（句+间隙静音）→ loudnorm 两遍（对齐 audiobook -16 LUFS）──
  const listFile = join(ttsDir, 'assembly.txt');
  const gapDir = join(ttsDir, 'gaps');
  mkdirSync(gapDir, { recursive: true });
  const lines: string[] = [];
  const silence = async (ms: number, tag: string): Promise<string> => {
    const f = join(gapDir, `g-${tag}.mp3`);
    if (!existsSync(f) || statSync(f).size < 100) {
      await ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', (ms / 1000).toFixed(3), '-b:a', '64k', f]);
    }
    return f;
  };
  const gapCache: Record<string, string> = {};
  for (const b of beats) {
    const sentGap = gapCache['s'] ??= await silence(GAP_SENTENCE, 's');
    const kindGap = gapCache[b.kind] ??= await silence(GAP_BY_KIND[b.kind], b.kind);
    b.sentences.forEach((s, i) => {
      const r = byId.get(s.id);
      if (r) lines.push(`file '${r.file}'`);
      if (i < b.sentences.length - 1) lines.push(`file '${sentGap}'`);
    });
    lines.push(`file '${kindGap}'`);
  }
  writeFileSync(listFile, lines.join('\n') + '\n');

  const raw = join(opts.outDir, 'narration-raw.mp3');
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', raw]);
  const mp3 = join(opts.outDir, 'narration.mp3');
  await ffmpeg(['-y', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-b:a', '160k', mp3]);

  // ── 5. 产物落盘 ──
  const srt = join(opts.outDir, 'narration.srt');
  writeFileSync(srt, writeSrt(cues));
  const timedScript = join(opts.outDir, 'script.timed.json');
  writeFileSync(timedScript, JSON.stringify(opts.script, null, 2));

  return { mp3, srt, timedScript, totalMs, missing, synthChars };
}
