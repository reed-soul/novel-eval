/**
 * 视频渲染：封面竖图居中 + 高斯模糊背景铺满 + Ken Burns 缓推 + 落雪氛围层，
 * 16:9 1080p，音频直通。这是有声书长视频的标准包装，避免纯静态图特征。
 */
import { spawn } from 'node:child_process';
import { ffmpeg, ffprobeDurationMs } from './ffmpeg.ts';

function probeImageSize(file: string): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { shell: false });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => {
      const [w, h] = out.trim().split(',').map(Number);
      code === 0 && w > 0 && h > 0 ? res({ w, h }) : rej(new Error(`ffprobe 图片尺寸失败: ${out.trim()}`));
    });
    p.on('error', rej);
  });
}

export async function renderChapterVideo(opts: {
  cover: string;       // 封面/章节场景图（任意比例，推荐竖版 3:4）
  audio: string;       // 章节 mp3
  out: string;         // 输出 mp4
  snow?: string;       // 落雪循环素材（assets.ensureSnowAsset 产物）；缺省不加雪
  snowOpacity?: number;
  subs?: string;       // 整集 srt，作为软字幕流封装进 mp4
  title?: string;      // 预留（后续叠加标题字卡）
  drawText?: boolean;
}): Promise<void> {
  const { cover, audio, out } = opts;
  const dur = (await ffprobeDurationMs(audio)) / 1000;
  const { w: cw, h: chh } = await probeImageSize(cover);

  // 前景：等比缩到高 900（宽取偶数），zoompan 用字面量尺寸（s= 不支持 iw/ih 表达式）
  const fgW = Math.max(2, Math.round((900 * cw) / chh / 2) * 2);
  const bg = '[1:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=28:2,eq=brightness=-0.18[bg]';
  // 缓推：约 60 秒从 1.00 推到 1.06，封顶后静止
  const fg = `[0:v]scale=${fgW}:900,zoompan=z='min(1+0.00004*on,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${fgW}x900[fg]`;

  const args: string[] = ['-loop', '1', '-i', cover, '-loop', '1', '-i', cover, '-i', audio];
  let graph = `${bg};${fg};[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`;

  if (opts.snow) {
    // 落雪：白点黑底循环素材 stream_loop 无限铺。
    // 注意：screen 混合必须在 RGB 平面做——若直接在 yuv420p 上 blend，
    // screen 会同时作用于 U/V 色度平面，把雪花处推向品红（紫色雪）。
    args.push('-stream_loop', '-1', '-i', opts.snow);
    const op = (opts.snowOpacity ?? 0.6).toFixed(2);
    graph += `;[v]format=gbrp[vb];[3:v]scale=1920:1080,fps=25,format=gbrp[snow];[vb][snow]blend=all_mode=screen:all_opacity=${op},format=yuv420p[vout]`;
  }
  const lastLabel = opts.snow ? '[vout]' : '[v]';

  const subIdx = args.filter((a) => a === '-i').length; // 字幕输入的序号 = 已有输入数
  await ffmpeg([
    ...args,
    ...(opts.subs ? ['-i', opts.subs] : []),
    '-filter_complex', graph,
    '-map', lastLabel, '-map', '2:a',
    ...(opts.subs ? ['-map', `${subIdx}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi'] : []),
    '-t', dur.toFixed(3),
    '-r', '25',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    out,
  ]);
}
