// 竞品频道深挖：About（订阅数/国家/加入时间）+ RSS（近15条视频含播放量）
import { Innertube } from 'youtubei.js';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const yt = await Innertube.create();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = [
  '夜语轶事Nighttime Anecdotes',
  '灵异讲述屋',
  '快樂的憨小胖',
  '十三兰德',
  'Feel at ease',
  '鲶鱼夜话-真实灵异恐怖故事',
  '小四推文',
  '荔枝推文',
  '莓莓奶昔',
];

const scan = JSON.parse(readFileSync('data/scan.json', 'utf8'));
const idByName = new Map(scan.channels.map((c) => [c.channelId, c.channelName]));
const findId = (name) => {
  for (const [id, n] of idByName) if (n.includes(name) || name.includes(n)) return id;
  return null;
};

function parseRss(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1];
    const get = (tag) => e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1];
    const views = e.match(/<media:statistics views="(\d+)"/)?.[1];
    return {
      title: get('title') ?? '',
      videoId: get('yt:videoId') ?? '',
      published: get('published') ?? '',
      views: views ? parseInt(views, 10) : 0,
    };
  });
  return entries;
}

const out = [];
for (const name of TARGETS) {
  const id = findId(name);
  if (!id) { console.log(`[ch] ${name}: not in scan results`); continue; }
  try {
    const ch = await yt.getChannel(id);
    const about = await ch.getAbout();
    const ab = about?.metadata ?? about;
    const rssUrl = ch.metadata?.rss_url;
    let recent = [];
    if (rssUrl) {
      const rss = await (await fetch(rssUrl)).text();
      recent = parseRss(rss);
    }
    const dates = recent.map((r) => new Date(r.published)).filter((d) => !Number.isNaN(d)).sort((a, b) => b - a);
    const gapDays = dates.length >= 2
      ? Math.round((dates[0] - dates[dates.length - 1]) / 86400000 / (dates.length - 1) * 10) / 10
      : null;
    const rec = {
      name: ch.metadata?.title ?? name,
      channelId: id,
      vanity: ch.metadata?.vanity_channel_url?.replace('http://www.youtube.com/', ''),
      description: (ab?.description ?? '').slice(0, 200),
      country: ab?.country ?? '',
      subscribers: ab?.subscriber_count ?? '',
      totalViews: ab?.view_count ?? '',
      videoCount: ab?.video_count ?? '',
      joined: ab?.joined_date?.text ?? '',
      rssVideos: recent.length,
      recentAvgViews: recent.length ? Math.round(recent.reduce((s, r) => s + r.views, 0) / recent.length) : 0,
      recentMedianViews: recent.length ? [...recent].sort((a, b) => a.views - b.views)[Math.floor(recent.length / 2)].views : 0,
      cadenceDays: gapDays,
      recent: recent.slice(0, 15),
    };
    out.push(rec);
    console.log(`[ch] ${rec.name} | subs=${rec.subscribers} | videos=${rec.videoCount} | cadence=${gapDays}d | median=${rec.recentMedianViews} | latest="${recent[0]?.title.slice(0, 24)}"`);
  } catch (e) {
    console.log(`[ch] ${name} FAILED: ${String(e.message).slice(0, 80)}`);
  }
  await sleep(1200);
}

writeFileSync('data/channels.json', JSON.stringify(out, null, 1));
console.log(`\n[ch] saved ${out.length} channels`);
