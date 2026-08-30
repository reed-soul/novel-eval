// 解析字幕开场 + 从 watch HTML 抓简介
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const picked = JSON.parse(readFileSync('data/pick.json', 'utf8'));
const ids = [...new Set(picked.map((v) => v.id))];
const meta = new Map(picked.map((v) => [v.id, v]));

// ---- 1) 字幕解析 ----
const files = readdirSync('data/transcripts').filter((f) => f.endsWith('.json3'));
const byVideo = new Map();
for (const f of files) {
  const id = f.split('.')[0];
  const lang = f.split('.').slice(1, -1).join('.');
  // 选原始轨：优先无连字符的短 lang（zh-CN/zh-Hant），跳过 A-B 形式的自动翻译轨
  if (lang.includes('-zh')) continue;
  const cur = byVideo.get(id);
  if (!cur || (lang === 'zh-CN' && cur.lang !== 'zh-CN')) byVideo.set(id, { file: `data/transcripts/${f}`, lang });
}

const transcripts = {};
for (const [id, { file, lang }] of byVideo) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const lines = [];
  for (const ev of j.events ?? []) {
    if (!ev.segs) continue;
    const text = ev.segs.map((s) => s.utf8).join('').replace(/\n/g, '').trim();
    if (text) lines.push({ t: Math.round((ev.tStartMs ?? 0) / 1000), text });
  }
  if (!lines.length) continue;
  const dur = meta.get(id)?.duration ?? '';
  const [mm, ss] = dur.split(':').map(Number);
  const durSec = mm * 60 + ss;
  const totalChars = lines.reduce((s, l) => s + l.text.length, 0);
  transcripts[id] = {
    channel: meta.get(id)?.channelName,
    title: meta.get(id)?.title,
    views: meta.get(id)?.views,
    duration: dur,
    lang,
    totalChars,
    charsPerMin: durSec ? Math.round(totalChars / (durSec / 60)) : 0,
    opening: lines.slice(0, 12).map((l) => l.text),
  };
}

// ---- 2) watch HTML 抓简介 ----
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const descriptions = {};
for (const id of ids) {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'user-agent': UA } });
    const html = await res.text();
    const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|const\s|let\s|<\/script>)/s);
    if (m) {
      const pr = JSON.parse(m[1]);
      descriptions[id] = {
        title: pr.videoDetails?.title ?? '',
        desc: (pr.videoDetails?.shortDescription ?? '').slice(0, 500),
        keywords: (pr.videoDetails?.keywords ?? []).slice(0, 10),
        views: pr.videoDetails?.viewCount,
      };
    }
  } catch { /* skip */ }
  await new Promise((r) => setTimeout(r, 600));
}

mkdirSync('data', { recursive: true });
writeFileSync('data/deep.json', JSON.stringify({ transcripts, descriptions }, null, 1));
console.log('== transcripts captured ==');
for (const [id, t] of Object.entries(transcripts)) console.log(`  ${id} ${t.channel.slice(0, 10)} cpm=${t.charsPerMin} chars=${t.totalChars}`);
console.log('== descriptions captured ==', Object.keys(descriptions).length);
