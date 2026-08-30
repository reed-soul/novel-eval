// 从 scan.json 里挑出各目标频道的头部视频（按播放量）
import { writeFileSync, readFileSync } from 'node:fs';

const scan = JSON.parse(readFileSync('data/scan.json', 'utf8'));
const CHANNELS = ['夜语轶事', '灵异讲述屋', '快樂的憨小胖', '十三兰德', 'Feel at ease', '鲶鱼夜话', '小四推文'];
const picked = [];
for (const name of CHANNELS) {
  const vids = scan.videos.filter((v) => v.channelName.includes(name)).sort((a, b) => b.views - a.views);
  if (!vids.length) continue;
  // 每频道取 top2（如果有）
  for (const v of vids.slice(0, 2)) picked.push(v);
}
writeFileSync('data/pick.json', JSON.stringify(picked, null, 1));
for (const v of picked) console.log(`${v.id} | ${String(v.views).padStart(7)} | ${v.duration.padStart(6)} | ${v.channelName.slice(0, 12)} | ${v.title.slice(0, 40)}`);
