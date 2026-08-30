// 自己频道：搜索定位 + About + RSS
import { Innertube } from 'youtubei.js';
import { writeFileSync } from 'node:fs';

const yt = await Innertube.create();

function parseRss(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1];
    const get = (tag) => e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1];
    return {
      title: get('title') ?? '',
      videoId: get('yt:videoId') ?? '',
      published: get('published') ?? '',
      views: parseInt(e.match(/<media:statistics views="(\d+)"/)?.[1] ?? '0', 10),
    };
  });
}

// 多关键词定位自己
const queries = ['悬疑借阅室', '最后一班森铁 有声书', '森铁 有声'];
let found = null;
for (const q of queries) {
  const s = await yt.search(q);
  const chan = (s.results ?? s.videos ?? []).find((x) => x.type === 'Channel');
  if (chan) { found = chan; console.log(`[me] channel via "${q}":`, chan.title?.text ?? chan.author?.name, chan.id); break; }
  const vid = (s.videos ?? []).find((x) => x.type === 'Video');
  if (vid?.author?.id) { found = { id: vid.author.id, title: { text: vid.author.name } }; console.log(`[me] via video "${q}":`, vid.author.name, vid.author.id); break; }
}

if (!found?.id) {
  console.log('[me] NOT FOUND — 需要手动提供频道 URL');
} else {
  const ch = await yt.getChannel(found.id);
  const about = await ch.getAbout();
  const ab = about?.metadata ?? about;
  const recent = ch.metadata?.rss_url ? parseRss(await (await fetch(ch.metadata.rss_url)).text()) : [];
  const rec = {
    name: ch.metadata?.title ?? found.title?.text,
    channelId: found.id,
    vanity: ch.metadata?.vanity_channel_url,
    description: (ab?.description ?? '').slice(0, 300),
    country: ab?.country ?? '',
    subscribers: ab?.subscriber_count ?? '',
    totalViews: ab?.view_count ?? '',
    videoCount: ab?.video_count ?? '',
    joined: ab?.joined_date?.text ?? '',
    recent,
  };
  writeFileSync('data/me.json', JSON.stringify(rec, null, 1));
  console.log(`[me] ${rec.name} | subs=${rec.subscribers} | videos=${rec.videoCount} | totalViews=${rec.totalViews}`);
  for (const r of recent) console.log(`   ${r.published.slice(0, 10)} | ${String(r.views).padStart(6)} views | ${r.title.slice(0, 40)}`);
}
