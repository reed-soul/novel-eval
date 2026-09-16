/**
 * S6 全片渲染（M2）：beat 真实时长切片（非 planSlots 槽位）+ 进度锚点 +
 * 字幕烧录（无中文字体则退外挂）+ SFX 程序化合成 + BGM 侧链避让（有 bgm.mp3 才混）。
 * 渲染铁律：全程串行。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NarrationScript, NarrationBeat } from '@novel-eval/shared';
import { ffmpeg, ffprobeDurationMs } from '@novel-eval/audiobook/ffmpeg';
import { mixBgmWithSidechainDucking } from '@novel-eval/audiobook/audio';

const GAP: Record<string, number> = { hook: 1100, turn: 650, peak: 800, close: 900, coda: 1400 };
const FPS = 24;
const FONT_CANDIDATES = [
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  '/Library/Fonts/Arial Unicode.ttf',
];

function findChineseFont(): string | undefined {
  return FONT_CANDIDATES.find((f) => existsSync(f));
}

/** SFX 程序化合成（产品评审：turn/peak 处音效钩；零资产依赖；表达式均实测通过） */
async function synthSfx(dir: string, kind: 'heartbeat' | 'tick' | 'stinger'): Promise<string> {
  const f = join(dir, `sfx-${kind}.mp3`);
  if (existsSync(f)) return f;
  if (kind === 'tick') {
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'aevalsrc=sin(1000*2*PI*t)*exp(-40*t):d=0.12:s=44100', '-b:a', '128k', f]);
  } else if (kind === 'heartbeat') {
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'aevalsrc=sin(55*2*PI*t)*exp(-9*t)*0.95:d=0.6:s=44100', '-b:a', '128k', f]);
  } else {
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=f=392:d=0.8', '-af', 'afade=t=out:st=0.05:d=0.75', '-b:a', '128k', f]);
  }
  return f;
}

/** 画面解析：缺图兜底链 = 本拍图 → 上一拍图 → 出场角色定妆照 → 纯色卡 */
function resolveImage(script: NarrationScript, outDir: string, beatId: string, prev?: string): string {
  const scene = join(outDir, 'scenes', `${beatId}.jpg`);
  if (existsSync(scene)) return scene;
  if (prev && existsSync(prev)) return prev;
  for (const q of script.sequences) {
    const b = q.beats.find((x) => x.id === beatId);
    if (b) for (const cid of b.visual.characterIds) {
      const c = script.characters.find((x) => x.id === cid);
      if (c?.sheetFile && existsSync(join(outDir, c.sheetFile))) return join(outDir, c.sheetFile);
    }
  }
  return '';
}

export interface RenderResult {
  video: string;
  videoNoSubs: string;
  audio: string;
  srt: string;
  driftMs: number;
}

export async function renderVideo(script: NarrationScript, outDir: string): Promise<RenderResult> {
  const segDir = join(outDir, 'render-segs');
  mkdirSync(segDir, { recursive: true });
  const font = findChineseFont();
  const beats: NarrationBeat[] = script.sequences.flatMap((q) => q.beats);
  if (beats.some((b) => b.durationMs === undefined || b.startMs === undefined)) {
    throw new Error('script.timed.json 缺时长回填（先跑 audio）');
  }

  // ── 音频底座：SFX 叠加（adelay 到拍点）→ 可选 BGM 侧链 ──
  const narrationFile = join(outDir, 'narration.mp3');
  const sfxDir = join(outDir, 'sfx');
  mkdirSync(sfxDir, { recursive: true });
  const sfxBeats = beats.filter((b) => b.sfxHint && b.sfxHint !== 'none' && (b.kind === 'turn' || b.kind === 'peak'));
  let audioBase = narrationFile;
  if (sfxBeats.length > 0) {
    const inputs: string[] = ['-y', '-i', narrationFile];
    const chains: string[] = [];
    let idx = 1;
    for (const b of sfxBeats) {
      const f = await synthSfx(sfxDir, b.sfxHint as 'heartbeat' | 'tick' | 'stinger');
      inputs.push('-i', f);
      chains.push(`[${idx}:a]adelay=${Math.round(b.startMs!)}|${Math.round(b.startMs!)}[d${idx}]`);
      idx++;
    }
    const mixIns = ['[0:a]', ...Array.from({ length: idx - 1 }, (_, i) => `[d${i + 1}]`)].join('');
    const mixed = join(outDir, 'audio-with-sfx.mp3');
    await ffmpeg([...inputs, '-filter_complex', `${chains.join(';')};${mixIns}amix=inputs=${idx}:duration=first:normalize=0,alimiter=limit=0.95`, '-b:a', '160k', mixed]);
    audioBase = mixed;
  }
  const bgmFile = join(outDir, 'bgm.mp3');
  const audioFinal = join(outDir, 'audio-final.mp3');
  if (existsSync(bgmFile)) {
    await mixBgmWithSidechainDucking(audioBase, bgmFile, audioFinal, {});
    console.log('  ♪ BGM 侧链避让混音完成');
  } else {
    console.log('  （未发现 bgm.mp3，纯口播音轨；放入 outDir/bgm.mp3 可启用侧链混音）');
  }
  const finalAudio = existsSync(audioFinal) ? audioFinal : audioBase;

  // ── 视频段：每 beat 一段（zoompan 缓推，beat 精确时长；段级缓存）──
  const segFiles = beats.map((b) => join(segDir, `${b.id}.mp4`));
  // 串行渲染（铁律）
  const seqOf = new Map<string, { idx: number; total: number; label: string }>();
  script.sequences.forEach((q, i) => seqOf.set(q.id, { idx: i + 1, total: script.sequences.length, label: q.title }));
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const img = resolveImage(script, outDir, b.id, undefined);
    const durS = (b.durationMs! + GAP[b.kind]) / 1000;
    const seg = segFiles[i];
    if (existsSync(seg)) continue;
    const frames = Math.max(2, Math.round(durS * FPS));
    // zoompan 缓推（audiobook 同款参数手感）
    const z = `zoompan=z='min(1.001+on/${frames}*0.001,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=2560x1440:fps=${FPS}`;
    let vf = `scale=4608:2592:force_original_aspect_ratio=increase,crop=4608:2592,${z},format=yuv420p`;
    const seqInfo = script.sequences.find((q) => q.beats.includes(b));
    if (seqInfo) {
      const meta = seqOf.get(seqInfo.id)!;
      const anchor = `疑点 ${meta.idx}/${meta.total}`;
      vf += font
        ? `,drawtext=fontfile=${font}:text='${anchor.replace(/'/g, '')}':fontcolor=0x9fb4d8:fontsize=44:x=90:y=78`
        : '';
    }
    const args = ['-y'];
    if (img) args.push('-loop', '1', '-t', (frames / FPS).toFixed(3), '-i', img);
    else args.push('-f', 'lavfi', '-i', `color=c=0x0b1220:s=2560x1440:r=${FPS}:d=${durS.toFixed(3)}`);
    args.push('-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', seg);
    await ffmpeg(args);
    console.log(`  段 ${b.id} ✓（${durS.toFixed(1)}s）`);
  }

  // ── 组装 ──
  const listFile = join(segDir, 'list.txt');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(listFile, segFiles.map((f) => `file '${f}'`).join('\n') + '\n');
  const videoNoSubs = join(outDir, 'narration-video-raw.mp4');
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-i', finalAudio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', videoNoSubs]);

  // 字幕烧录（无中文字体则退外挂）
  const srt = join(outDir, 'narration.srt');
  const video = join(outDir, 'narration-video.mp4');
  if (font) {
    await ffmpeg(['-y', '-i', videoNoSubs, '-vf', `subtitles=${srt.replace(/:/g, '\\:')}:force_style='FontName=PingFang SC,FontSize=26,PrimaryColour=&H00FFFFFF,OutlineColour=&H66000000,BorderStyle=1,Outline=2,MarginV=56'`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'copy', video]);
  } else {
    await ffmpeg(['-y', '-i', videoNoSubs, '-c', 'copy', '-c:s', 'mov_text', video]);
    console.warn('  ⚠ 未找到中文字体，字幕退 mov_text 软轨（YouTube 不识别，需 captions.insert）');
  }

  const vMs = await ffprobeDurationMs(videoNoSubs);
  const aMs = await ffprobeDurationMs(finalAudio);
  const expectMs = beats.reduce((n, b) => n + b.durationMs! + GAP[b.kind], 0);
  const driftMs = Math.abs(vMs - expectMs);
  console.log(`  全片 ${Math.round(vMs / 1000)}s（音轨 ${Math.round(aMs / 1000)}s，期望 ${Math.round(expectMs / 1000)}s，漂移 ${Math.round(driftMs)}ms）`);
  if (driftMs > 1500) throw new Error(`全片对齐漂移 ${driftMs}ms > 1500ms`);
  return { video, videoNoSubs, audio: finalAudio, srt, driftMs };
}

/** 3 条 Shorts（M2）：hook 拍 + 两个最强 peak 为锚，各 ~50s 竖屏 1080x1920 */
export async function renderShorts(script: NarrationScript, outDir: string): Promise<string[]> {
  const font = findChineseFont();
  const beats = script.sequences.flatMap((q) => q.beats);
  const peaks = [...beats].sort((a, b) => (b.kind === 'peak' ? 1 : 0) - (a.kind === 'peak' ? 1 : 0));
  const anchors = [beats.find((b) => b.kind === 'hook')!, peaks.find((b) => b.kind === 'peak' && b !== beats.find((x) => x.kind === 'hook'))!, peaks.filter((b) => b.kind === 'peak')[1]].filter(Boolean);
  const shorts: string[] = [];
  const srtCues = (await import('@novel-eval/audiobook/srt')).parseSrt(readFileSync(join(outDir, 'narration.srt'), 'utf-8'));
  for (let n = 0; n < Math.min(3, anchors.length); n++) {
    const anchor = anchors[n];
    const idx = beats.indexOf(anchor);
    // 从锚点向前回溯拼 ~50s（用拍起点切片：取 [startMs, startMs+50s) 内的拍）
    const startMs = anchor.startMs!;
    const endMs = startMs + 50_000;
    const inRange = beats.filter((b) => b.startMs! >= startMs && b.startMs! < endMs);
    const segDir = join(outDir, `shorts-segs-${n}`);
    mkdirSync(segDir, { recursive: true });
    const segs: string[] = [];
    for (const b of inRange) {
      const img = resolveImage(script, outDir, b.id, undefined);
      const from = Math.max(b.startMs!, startMs);
      const to = Math.min(b.startMs! + b.durationMs! + GAP[b.kind], endMs);
      const durS = (to - from) / 1000;
      const frames = Math.max(2, Math.round(durS * FPS));
      const seg = join(segDir, `${b.id}.mp4`);
      if (!existsSync(seg)) {
        const vf = `scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,crop=ih*9/16:ih,scale=1080:1920,zoompan=z='min(1.001+on/${frames}*0.0012,1.12)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${FPS},format=yuv420p`;
        const args = ['-y'];
        if (img) args.push('-loop', '1', '-t', (frames / FPS).toFixed(3), '-i', img);
        else args.push('-f', 'lavfi', '-i', `color=c=0x0b1220:s=1080x1920:r=${FPS}:d=${durS.toFixed(3)}`);
        args.push('-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-an', seg);
        await ffmpeg(args);
      }
      segs.push(seg);
    }
    const listFile = join(segDir, 'list.txt');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(listFile, segs.map((f) => `file '${f}'`).join('\n') + '\n');
    const raw = join(outDir, `short-${n + 1}-raw.mp4`);
    const audioSlice = join(outDir, `short-${n + 1}.m4a`);
    const finalAudio = [join(outDir, 'audio-final.mp3'), join(outDir, 'audio-with-sfx.mp3'), join(outDir, 'narration.mp3')]
      .find((f) => existsSync(f))!;
    await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', raw]);
    await ffmpeg(['-y', '-i', finalAudio, '-ss', (startMs / 1000).toFixed(3), '-t', '50', '-c:a', 'aac', '-b:a', '160k', audioSlice]);
    // 竖屏字幕：切片窗内 cues 平移
    const { shift, writeSrt } = await import('@novel-eval/audiobook/srt');
    const cues = srtCues.filter((c) => c.startMs >= startMs && c.startMs < endMs);
    const shortSrt = join(outDir, `short-${n + 1}.srt`);
    writeFileSync(shortSrt, writeSrt(shift(cues, -startMs)));
    const out = join(outDir, `short-${n + 1}.mp4`);
    const subsArgs = font
      ? ['-vf', `subtitles=${shortSrt.replace(/:/g, '\\:')}:force_style='FontName=PingFang SC,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H66000000,Outline=2,MarginV=40'`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '21']
      : ['-c:v', 'copy'];
    await ffmpeg(['-y', '-i', raw, '-i', audioSlice, '-map', '0:v', '-map', '1:a', ...subsArgs, '-c:a', 'copy', '-shortest', out]);
    shorts.push(out);
    console.log(`  Short ${n + 1} ✓ ${Math.round((endMs - startMs) / 1000)}s（锚点 ${anchor.id}）`);
  }
  return shorts;
}

/** 封面：hook 拍图 + 书名大字（M2；画幅 1280x720） */
export async function renderThumbnail(script: NarrationScript, outDir: string): Promise<string> {
  const font = findChineseFont();
  const hook = script.sequences.flatMap((q) => q.beats).find((b) => b.kind === 'hook');
  if (!hook) throw new Error('无 hook 拍');
  const img = resolveImage(script, outDir, hook.id, undefined);
  const out = join(outDir, 'thumbnail.jpg');
  const title = script.bookTitle.replace(/'/g, '');
  await ffmpeg([
    '-y',
    ...(img ? ['-i', img] : ['-f', 'lavfi', '-i', 'color=c=0x0b1220:s=1280x720']),
    '-vf', `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720${font ? `,drawtext=fontfile=${font}:text='${title}':fontcolor=white:fontsize=88:box=1:boxcolor=0x000000B0:boxborderw=24:x=(w-text_w)/2:y=h-180` : ''}`,
    '-q:v', '2', out,
  ]);
  return out;
}
