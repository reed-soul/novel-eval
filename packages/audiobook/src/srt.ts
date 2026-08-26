/**
 * SRT 工具：解析 → 时间平移 → 合并（用于把逐段字幕对齐到整集时间轴）。
 */

export interface Cue { startMs: number; endMs: number; text: string }

function toMs(ts: string): number {
  const m = ts.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return (+m[1]) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + (+m[4].padEnd(3, '0'));
}

function toTs(ms: number): string {
  const h = Math.floor(ms / 3600000), mn = Math.floor(ms % 3600000 / 60000);
  const s = Math.floor(ms % 60000 / 1000), mil = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mil).padStart(3, '0')}`;
}

export function parseSrt(content: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of content.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const t = lines.find((l) => l.includes(' --> '));
    if (!t) continue;
    const [a, b] = t.split(' --> ');
    const text = lines.slice(lines.indexOf(t) + 1).join(' ');
    if (text) cues.push({ startMs: toMs(a), endMs: toMs(b), text });
  }
  return cues;
}

export function shift(cues: Cue[], offsetMs: number): Cue[] {
  return cues.map((c) => ({ startMs: c.startMs + offsetMs, endMs: c.endMs + offsetMs, text: c.text }));
}

export function mergeCues(chunks: Cue[][]): Cue[] {
  return chunks.flat().sort((a, b) => a.startMs - b.startMs);
}

export function writeSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${toTs(c.startMs)} --> ${toTs(c.endMs)}\n${c.text}\n`).join('\n');
}
