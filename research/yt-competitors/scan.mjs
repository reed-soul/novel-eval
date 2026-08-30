// 关键词扫描：收集赛道玩家
import { Innertube } from 'youtubei.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const yt = await Innertube.create();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYWORDS = [
  '悬疑小说解说',
  '悬疑有声书',
  '有声小说 悬疑',
  '小说推文 悬疑',
  '悬疑故事 解说',
  '中式恐怖 故事',
  '民俗恐怖 故事',
  '悬疑小说 推荐',
  '恐怖故事 完结',
  '一口气看完 悬疑小说',
];

const videos = new Map(); // id -> record
for (const kw of KEYWORDS) {
  try {
    const s = await yt.search(kw);
    const items = (s.videos ?? []).filter((x) => x.type === 'Video');
    let added = 0;
    for (const v of items) {
      const num = (t) => {
        if (t == null) return 0;
        if (typeof t === 'number') return t;
        const n = parseInt(String(t.text ?? t).replace(/[^\d]/g, ''), 10);
        return Number.isNaN(n) ? 0 : n;
      };
      const rec = {
        id: v.id,
        title: v.title?.text ?? '',
        channelId: v.author?.id ?? '',
        channelName: v.author?.name ?? '',
        views: num(v.view_count ?? v.short_view_count),
        published: v.published?.text ?? '',
        duration: v.duration?.text ?? '',
      };
      if (rec.channelId && !videos.has(rec.id)) { videos.set(rec.id, { ...rec, kw }); added++; }
    }
    console.log(`[scan] "${kw}": ${items.length} videos, ${added} new`);
  } catch (e) {
    console.log(`[scan] "${kw}" FAILED: ${String(e.message).slice(0, 80)}`);
  }
  await sleep(900);
}

const all = [...videos.values()];
const byChannel = new Map();
for (const v of all) {
  const c = byChannel.get(v.channelId) ?? { channelId: v.channelId, channelName: v.channelName, hits: 0, totalViews: 0, maxViews: 0, sampleTitles: [] };
  c.hits++;
  c.totalViews += v.views;
  c.maxViews = Math.max(c.maxViews, v.views);
  if (c.sampleTitles.length < 3) c.sampleTitles.push(v.title.slice(0, 40));
  byChannel.set(v.channelId, c);
}
const channels = [...byChannel.values()].sort((a, b) => b.hits - a.hits || b.totalViews - a.totalViews);

mkdirSync('data', { recursive: true });
writeFileSync('data/scan.json', JSON.stringify({ scannedAt: new Date().toISOString(), keywords: KEYWORDS, videos: all, channels }, null, 1));
console.log(`\n[scan] total videos: ${all.length}, unique channels: ${channels.length}`);
console.log('[scan] top channels:');
for (const c of channels.slice(0, 15)) console.log(`  ${c.hits}x | avg=${Math.round(c.totalViews / c.hits)} max=${c.maxViews} | ${c.channelName}`);
