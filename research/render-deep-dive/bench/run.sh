#!/bin/zsh
# 渲染方案基准：60s 单图场景，对比当前管线与候选优化（串行执行，避免压机器）
# 注意：这是实施前的探索性基准（1080p 口径、秒级计时精度、nice 限速），
# 结论用于方案选型；与 v2 生产配置（1440p/CRF18/5120 预放大）的差异由 e2e 测试覆盖。
set -e
cd "$(dirname "$0")"
mkdir -p out
rm -f out/*.mp4
LOG=results.txt
: > $LOG

# ---------- 素材准备 ----------
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=2560x1440:duration=1 -frames:v 1 out/img.png
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=12:duration=60" -c:v libx264 -crf 20 -pix_fmt yuv420p out/snowish.mp4   # 伪雪花层（测 blend 成本，内容不重要）
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=60" -c:a libmp3lame -b:a 128k out/audio.mp3

t() { local name=$1; shift; local s=$(date +%s); nice -n 15 "$@" ; local e=$(date +%s); echo "$name: $((e-s))s" | tee -a $LOG; }

# ---------- B1 基线：当前 video.ts 精确滤镜链（60s 单槽 + 雪花 + VT 4M 12fps）----------
t B1-baseline-current \
ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t 60 -i out/img.png -i out/audio.mp3 -stream_loop -1 -i out/snowish.mp4 \
  -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(1+0.00004*on,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,fps=12[v0];[v0]format=gbrp[vb];[2:v]scale=1920:1080,fps=12,format=gbrp[snow];[vb][snow]blend=all_mode=screen:all_opacity=0.6,format=yuv420p[vout]" \
  -map "[vout]" -map 1:a -t 60 -r 12 -c:v h264_videotoolbox -b:v 4M -pix_fmt yuv420p -c:a aac -b:a 128k out/b1.mp4

# ---------- B2 候选：supersample zoompan（先4x线性放大）+ 24fps + x264 CRF ----------
t B2-supersample-x264-24fps \
ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t 60 -i out/img.png \
  -filter_complex "[0:v]scale=7680:4320:flags=lanczos,zoompan=z='min(1+0.00002*on,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=24[v]" \
  -map "[v]" -t 60 -r 24 -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -an out/b2.mp4

# ---------- B3 候选：亮度平面直混（yuv420p 上 blend=c0_mode=screen，免 gbrp 往返）----------
t B3-luma-blend-only \
ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t 60 -i out/img.png -i out/audio.mp3 -stream_loop -1 -i out/snowish.mp4 \
  -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(1+0.00004*on,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,fps=12[v0];[2:v]scale=1920:1080,fps=12[snow];[v0][snow]blend=c0_mode=screen:all_opacity=0.6[vout]" \
  -map "[vout]" -map 1:a -t 60 -r 12 -c:v h264_videotoolbox -b:v 4M -pix_fmt yuv420p -c:a aac -b:a 128k out/b3.mp4

# ---------- B4 候选：分段渲染 + concat -c copy（两段 30s，x264 CRF，模拟缓存组装）----------
t B4a-segment-30s \
ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t 30 -i out/img.png \
  -filter_complex "[0:v]scale=7680:4320:flags=lanczos,zoompan=z='min(1+0.00002*on,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=24[v]" \
  -map "[v]" -t 30 -r 24 -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -x264-params "keyint=24:min-keyint=24:scenecut=0" -an out/seg0.mp4
cp out/seg0.mp4 out/seg1.mp4   # 模拟第二张图的段（成本相同）
printf "file 'seg0.mp4'\nfile 'seg1.mp4'\n" > out/concat.txt
t B4b-concat-copy \
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i out/concat.txt -i out/audio.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -t 60 out/b4.mp4

# ---------- 校验 ----------
echo "----- 产物校验 -----" | tee -a $LOG
for f in b1 b2 b3 b4; do
  # 先捕获再输出（$(cat) 在管道末端会读脚本自身 stdin，拿不到探测结果）
  local_probe=$(ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,r_frame_rate,nb_frames -of csv=p=0 "out/$f.mp4" | tr '\n' ' ')
  echo "$f: $local_probe" | tee -a $LOG
done
ls -la out/*.mp4 | awk '{print $NF, $5}' | tee -a $LOG
