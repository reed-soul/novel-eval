/**
 * 视频渲染：多张场景图轮换（每张 ≤25s，不足循环复用）+ Ken Burns 缓推 +
 * 落雪氛围层，16:9 1080p 满幅，音频直通。这是有声书长视频的标准包装，
 * 避免纯静态图特征。
 */
import { ffmpeg, ffprobeDurationMs } from './ffmpeg.ts';

export async function renderChapterVideo(opts: {
  covers: string[];     // 场景图列表（推荐 16:9 2560×1440；任意比例都会居中裁满）
  audio: string;       // 整集 mp3
  out: string;         // 输出 mp4
  snow?: string;       // 落雪循环素材（assets.ensureSnowAsset 产物）；缺省不加雪
  snowOpacity?: number;
  subs?: string;       // 整集 srt，作为软字幕流封装进 mp4
  title?: string;      // 预留（后续叠加标题字卡）
  drawText?: boolean;
}): Promise<void> {
  const { covers, audio, out } = opts;
  if (covers.length === 0) throw new Error('renderChapterVideo 需要至少一张场景图');
  const dur = (await ffprobeDurationMs(audio)) / 1000;

  // 场景轮换槽位：每张 ≤25s（运营分析定的 15-25s 甜区），图少则循环；
  // 相邻同图槽位合并为一段长缓推。
  const SLOT_CAP_S = 25;
  const slots = Math.max(covers.length, Math.ceil(dur / SLOT_CAP_S));
  const slotDur = dur / slots;
  const plan: { img: string; dur: number }[] = [];
  for (let i = 0; i < slots; i++) {
    const img = covers[i % covers.length];
    const last = plan[plan.length - 1];
    if (last && last.img === img) last.dur += slotDur;
    else plan.push({ img, dur: slotDur });
  }

  // 每槽：满幅裁切 + 缓推。zoompan 的 s= 只认字面量尺寸（不支持 iw/ih 表达式）。
  // z 随输出帧递增（输入 25fps），每槽从 1.00 重新起推，60 秒约推到 1.06。
  const args: string[] = [];
  const chains: string[] = [];
  plan.forEach((slot, k) => {
    args.push('-loop', '1', '-t', slot.dur.toFixed(3), '-i', slot.img);
    chains.push(
      `[${k}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,` +
      `zoompan=z='min(1+0.00004*on,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,fps=12[v${k}]`
    );
  });
  const audioIdx = plan.length;
  args.push('-i', audio);
  let graph = `${chains.join(';')};${plan.map((_, k) => `[v${k}]`).join('')}concat=n=${plan.length}:v=1:a=0[v]`;

  if (opts.snow) {
    // 落雪：白点黑底循环素材 stream_loop 无限铺。
    // 注意：screen 混合必须在 RGB 平面做——若直接在 yuv420p 上 blend，
    // screen 会同时作用于 U/V 色度平面，把雪花处推向品红（紫色雪）。
    args.push('-stream_loop', '-1', '-i', opts.snow);
    const op = (opts.snowOpacity ?? 0.6).toFixed(2);
    graph += `;[v]format=gbrp[vb];[${audioIdx + 1}:v]scale=1920:1080,fps=12,format=gbrp[snow];[vb][snow]blend=all_mode=screen:all_opacity=${op},format=yuv420p[vout]`;
  }
  const lastLabel = opts.snow ? '[vout]' : '[v]';

  const subIdx = args.filter((a) => a === '-i').length; // 字幕输入的序号 = 已有输入数
  await ffmpeg([
    ...args,
    ...(opts.subs ? ['-i', opts.subs] : []),
    '-filter_complex', graph,
    '-map', lastLabel, '-map', `${audioIdx}:a`,
    ...(opts.subs ? ['-map', `${subIdx}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi'] : []),
    '-t', dur.toFixed(3),
    '-r', '12',  // 近静止画面：12fps 足够，编码减半
    '-c:v', 'h264_videotoolbox', '-b:v', '4M', // M4 硬编码：视频耗时 45min→~8min
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    // faststart 二次封装瞬时需要双倍磁盘（~2×成片大小）；磁盘紧张时可用
    // AUDIOBOOK_NO_FASTSTART=1 跳过——YouTube/B站上传后服务端重编码，无需 faststart。
    ...(process.env.AUDIOBOOK_NO_FASTSTART === '1' ? [] : ['-movflags', '+faststart']),
    out,
  ]);
}
