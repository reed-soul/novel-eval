# 有声书视频渲染管线 · 深度调研任务书

## 你是谁、要干什么
你是一名视频渲染/多媒体工程方向的资深研究员。请针对下面的管线做**深度调研**（要求联网查证 2025-2026 最新资料，标注来源与日期，拒绝过时记忆），产出一份可直接落地的技术方案建议。

## 项目背景
- 本地 TypeScript monorepo（novel-eval），用 ffmpeg CLI 把小说做成「有声书视频」投 YouTube。
- 硬件：Apple M4 / 16GB RAM / macOS。曾因 5 路并行 ffmpeg 压死机器 → **渲染必须低并发（≤2-3 路小任务）串行为主**。
- 每集 10-18 分钟，1080p，最终上传 YouTube（YouTube 服务端会重编码）。

## 当前管线（packages/audiobook/src/video.ts，可读源码）
1. 多张场景图（2560×1440 静态 PNG/JPG）按 ≤25s 槽位轮换（图少则循环）；
2. 每槽 `-loop 1 -t <dur> -i img` 输入 → `scale=1920:1080:force_original_aspect_ratio=increase,crop, zoompan=z='min(1+0.00004*on,1.06)':d=1:s=1920x1080, fps=12`（Ken Burns 缓推，**12fps**）；
3. 全部槽位 `concat` 成一条视频流；
4. 落雪氛围层：`stream_loop -1` 铺雪花视频（白点黑底）→ `format=gbrp` → `blend=all_mode=screen:all_opacity=0.6` → `format=yuv420p`（因为 screen 在 YUV 上会出紫雪，被迫转 RGB 平面）；
5. 编码：`-r 12 -c:v h264_videotoolbox -b:v 4M`，音频 AAC 128k，字幕 mov_text 软字幕轨，+faststart；
6. **每集从零全时间线重编码**（无视频层缓存；TTS 音频有缓存）。现状单集视频段约 8 分钟（曾用纯软编 45 分钟）。

本机 ffmpeg 7.1（homebrew）：有 `libx264`、`libsvtav1`、`h264_videotoolbox`、`hevc_videotoolbox`、`scale_vt`（VideoToolbox GPU 缩放 filter）、`libvmaf`、`libass`；hwaccel=videotoolbox。

## 痛点（按优先级）
1. **视觉效果不够好**：zoompan 慢推有整数像素取整造成的抖动/wobble；12fps 运动不流畅；雪花 screen 混合发灰发假；整体「PPT 感」。
2. **渲染太慢**：每集全时间线重编码 ~8 分钟；改任何一处（如换一张图、调雪花透明度）就全部重来。
3. 长期：希望流程化到「Web 端一键出片」，渲染层必须可缓存、可增量、可队列化。

## 研究问题（务必逐条回答）
1. **ffmpeg 原生优化天花板**：
   - 分段渲染 + concat demuxer `-c copy` 组装：静态图段如何设计 GOP/关键帧使任意时长可切？zoompan 段能否按 (图,时长桶) 缓存复用？雪花层如何跨切点保持粒子连续（如按全局时间偏移取模铺）？
   - zoompan 抖动的权威修法（supersample：先放大 4x 再 zoompan 再 lanczos 下采样？还是 crop+t 表达式？），24fps 的代价；
   - GPU 链路：`hwaccel videotoolbox` 解码 + `scale_vt` + 硬编的零拷贝链在 ffmpeg 7.1 的实际可用性；blend 能否避免 gbrp 往返（如 `blend=c0_mode=screen` 只混亮度平面）；
   - 编码器选型：同码率下 h264_videotoolbox vs libx264(preset/CRF) 画质差多少（有 VMAF 数据吗）；上传 YouTube 该给 H.264 高码率还是 HEVC/AV1；SVT-AV1 在 Apple Silicon 的速度实测。
2. **替代渲染引擎**（认真评估，别只列名单）：
   - macOS 原生 AVFoundation + Core Animation（CAEmitterCell 粒子雪 + subpixel transform Ken Burns + AVAssetExportSession 硬编）：实际速度/画质/工程成本；
   - WebCodecs + OffscreenCanvas（headless Chrome/Node）做 GPU 合成渲染；
   - Remotion / Motion Canvas 在 15 分钟长视频场景的可行性与渲染速度；
   - libplacebo/mpv 渲染管线方案。
3. **AI 动态背景**（效果跃迁的关键）：
   - 图生视频（即梦 Seedance / 可灵 / Veo / Runway 等）生成 5-10s 无缝循环 ambient 镜头替代 Ken Burns：2026 年 8 月各家 API 现状、价格、生成速度、能否 API 化批量；
   - 2.5D 视差（深度图 + displace/网格变形）低成本做法；
   - 循环视频的 seamless loop 技巧（首尾帧插值等）。
4. **工程架构**：缓存粒度设计（素材层/段层/成片层）、增量渲染（改一张图只重渲该段）、任务队列与断点续渲、分布式（局域网 Win11/NVENC 是否值得）。

## 输出要求
- 写入 `research/render-deep-dive/<你的名字>.md`；
- 结构：TL;DR 推荐架构 → 分主题结论（每条给依据+来源+日期）→ 你心目中的最终方案（大胆但要论证）→ 风险与不确定项；
- 中文，术语保留英文；给出的 ffmpeg 命令要完整可跑；
- 明确区分「已验证事实（有来源）」「社区经验」「你的推断」。
