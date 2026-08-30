# ffmpeg 原生管线：静态图 + Ken Burns + 粒子氛围层 长视频极速高画质方案

> 调研人：ZCode（多媒体工程研究员）｜日期：2026-08-30
> 环境：Apple M4 / 16GB / macOS / ffmpeg 7.1（homebrew，`--enable-videotoolbox --enable-libsvtav1 --enable-libvmaf --enable-libx264`，实测**无 libplacebo 滤镜**，有 `scale_vt`）
> 佐证方式：联网调研（来源+日期标注）+ **本机实测基准**（标注「本机实测」，均可复现，命令附后）。

---

## TL;DR 推荐架构

```
资产层(缓存)                 段层(缓存, -c copy 可切)              成片层
cover.png ─→ cover_2x.png ─→ seg_{img}_{桶}.mp4 ──concat -c copy──→ master.mp4
snow.mp4  ─→ snow_24.mp4      (GOP=1s 全 IDR 起点,        (+音频AAC+字幕mov_text)
                               帧内烘焙雪花, trim 帧偏移)
```

1. **视觉**：zoompan 前把图**预先放大 2x（一次性离线，缓存 PNG）**，输出 **24fps**（实测与 12fps 滤镜成本相同）；雪花混合改为 `blend=c0_mode=screen`（只混亮度平面，直接在 yuv420p 上跑，**快 3.4x**，实测视觉等效 PSNR≈33.7dB，且不再有紫雪风险）。
2. **速度**：按 (图， 时长桶) 缓存段文件，`concat -c copy` 组装（本机实测拼接后时长帧数精确无损）。一集只渲染「没缓存过的段」，换一张图/调雪花透明度只影响该段。首次全量段渲染 ~36 段 × ~21s ≈ 13 分钟可 2-3 路并行压缩到 ~5 分钟，此后每集成片≈纯组装（秒级）+ 音频 AAC。
3. **画质/编码**：本机实测同 VMAF(~95.2-95.4) 下 **x264 medium CRF 23 比 h264_videotoolbox 4M 更快（0.60s vs 0.79s/6s）且体积减半**——本内容形态（近静态+粒子）CPU 软编反超硬编；投 YouTube 用 `libx264 -preset medium -crf 18~20`（或最低 veryfast）高码率母带即可，无需上 4M 硬编。追求体积/画质极致可 SVT-AV1 preset 6（VMAF 最高 96.9、体积最小，速度 74fps@1080p24，15 分钟片子约 5 分钟）。
4. **画质门**：`libvmaf` 做 CI 回归（`n_threads=8` 实测 116fps，15 分钟成片全片 VMAF ≈ 3 分钟）。

---

## 1. 分段渲染 + 无损组装（concat demuxer -c copy）

### 1.1 结论

- **`-c copy` 拼接只要求每段「以关键帧(IDR)开头」**，段尾可以在任何帧结束（解码器只是停在那里）[已验证来源：FFmpeg Wiki Concatenate, https://trac.ffmpeg.org/wiki/Concatenate；本机实测]。所有段还必须「同 codec、同参数（分辨率/像素格式/profile/timebase）」[已验证来源：同上 Wiki："exactly the same codec and codec parameters"]。
- **任意点切割做不到，只能关键帧对齐切割**：非关键帧处 `-c copy` 切出的段首帧是 P/B 帧（本机实测 `-ss 1.5 -c copy` 切出的段首两帧 `key_frame=0`，类型 P、B），播放起始会花屏/拖影直到下一个 IDR [本机实测 + 社区经验：reddit r/ffmpeg keyframe issues with concat, https://www.reddit.com/r/ffmpeg/comments/6p4i4g/keyframe_issues_with_concat/；ffmpeg-user 邮件列表 2020-01 关于 B 帧时间戳问题, https://ffmpeg.org/pipermail/ffmpeg-user/2020-January/046554.html]。
- **工程解法：把 GOP 网格做成切割粒度**。段以 `-g N -keyint_min N -sc_threshold 0 -flags +cgop` 编码（本机实测 x264 与 h264_videotoolbox 均严格遵守，6s@24fps、`-g 48` 恰好 3 个 IDR）。GOP=1s（24fps 时 `-g 24`）即可获得 1 秒粒度的免重编码裁剪：从缓存母段 `-ss 0 -t <N>` `-c copy` 切任意 N 秒（起点恒为 0 号 IDR，安全）。
  - 依据：Superuser「What is the correct way to fix keyframes in ffmpeg for DASH」(`-g X -keyint_min X -force_key_frames`, https://superuser.com/questions/908280/)；FFmpeg Trac #670（固定 keyframe 距离需禁 scenecut）[已验证来源]。
  - 注意 x264 默认 `keyint_min = keyint/2` 且 scenecut 会插入计划外 I 帧，必须显式 `-sc_threshold 0` + `-keyint_min` 才是严格固定 GOP [已验证来源：同上 Superuser / Trac #670]。
  - YouTube 官方上传要求里正好有「Closed GOP. GOP of half the frame rate」（30fps→15 帧一个关键帧）——说明段级 1-2s GOP 对 YouTube 完全无冲突 [已验证来源：YouTube 推荐编码设置， https://support.google.com/youtube/answer/1722171，2026-08 检索]。
- **切割点不对齐时的最小重编码**：只需重编码「切点前最后一个不完整 GOP」（≤1s），用与母段完全相同的编码参数从上一个 IDR 起算 `-ss <idr_t> -t <tail>` 重编码，再与前后两段 concat。这是 MPEG-TS 流切割/ 新闻拆条工具的通用做法 [社区经验：VideoHelp 论坛 GOP 级拆条工作流， https://www.videohelp.com/forum]。对缩放/滤镜不同的段落，则退回 concat **filter**（必须重编码，`-c copy` 不兼容）[已验证来源：FFmpeg Wiki Concatenate]。
- **提速倍数的论证**：分段并行的收益来自「按核数并行 + 命中缓存零渲染」。Kdenlive issue #1868 实测 0.7fps→3.5fps（5 并行，~5x）[已验证来源：https://invent.kde.org/multimedia/kdenlive/-/issues/1868]；Blender VSE 社区同款工作流（分段渲染 + `ffmpeg -f concat -c copy` 瞬时合并）[已验证来源：https://blender.stackexchange.com/questions/7738/]。对本项目更大的收益是**跨集缓存复用**：8 张封面 × 25s 桶只渲染一次，后续每集视频成本≈0 [推断，工程论证]。

### 1.2 (图， 时长桶) 段缓存设计 [推断·部分实测]

- **桶设计**：不缓存任意时长，而是每张图渲染一个「最长桶」（25s）母段，GOP=1s；实际需要 18s 时用 `-t 18 -c copy` 从母段切（起点 IDR 安全，尾帧无所谓）。比多桶缓存省空间且组合灵活。zoom 速率按满桶计算（`z='min(1+0.0001*on,1.06)'`，24fps×25s=600 帧推满 6%），短切时段落缩推没到底——视觉可接受；若要「每槽都推满」，按 (图， 桶={10s,15s,25s}) 三档缓存。
- **雪花跨切点连续**：blend 是逐帧无记忆的，只要第 k 段消费的雪花帧 = 全局时间 T_k 对应的雪花帧即可连续。做法：把雪花素材**预处理成 24fps/1080p/yuv420p 的循环资产**（25fps 原素材的 25→24 转换相位会让帧偏移对不齐——本机实测踩坑），段内用 `trim=start_frame=<T_k*24 mod 周期>` 取相位。本机实测：拼接点平均 PSNR≈40dB（视觉无缝，但非逐位一致；残差来自 blend framesync 按 pts 对齐两路时的 ±1 帧滑动，且 `-stream_loop -1 -ss N` 的 demuxer seek 在循环输入上不可靠，必须用 trim 滤镜）[本机实测]。对「落雪」这类随机粒子，不做偏移直接每段从雪花 0 帧开始也几乎不可感知 [推断]。
- **段渲染命令（完整可跑，本机已验证等价链路）**：

```bash
# 0) 一次性资产预处理（缓存）
#    图：居中裁 16:9 后放大 2x（3840x2160），lanczos
ffmpeg -y -i cover.png -vf "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,scale=3840:2160:flags=lanczos" -frames:v 1 cover_2x.png
#    雪花：统一 24fps/1080p/yuv420p（消除帧率相位问题）
ffmpeg -y -i snow.mp4 -vf "fps=24,scale=1920:1080,format=yuv420p" -c:v libx264 -qp 0 -preset ultrafast -an snow_24.mp4

# 1) 渲染 (图,25s桶) 段：2x 超采样 zoompan + 24fps + yuv 域亮度 screen 雪花 + 固定 GOP
ffmpeg -y -loop 1 -framerate 24 -t 25 -i cover_2x.png -stream_loop -1 -i snow_24.mp4 -filter_complex \
"[0:v]zoompan=z='min(1+0.0001*on,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,fps=24,format=yuv420p[base];\
 [1:v]trim=start_frame=0,setpts=PTS-STARTPTS,format=yuv420p[ovl];\
 [base][ovl]blend=c0_mode=screen:c0_opacity=0.6" \
 -t 25 -r 24 -video_track_timescale 12288 \
 -c:v libx264 -preset veryfast -crf 18 -g 24 -keyint_min 24 -sc_threshold 0 -flags +cgop \
 -pix_fmt yuv420p -an seg_<imgHash>_25s.mp4
# 注：trim 的 start_frame 按该段全局起点取模雪花周期设置

# 2) 组装：任意 1s 粒度裁剪 + concat -c copy（瞬时）
ffmpeg -y -ss 0 -t 18.5 -i seg_A_25s.mp4 -c copy -video_track_timescale 12288 slotA.mp4   # 尾帧可非关键帧
ffmpeg -y -ss 0 -t 12   -i seg_B_25s.mp4 -c copy -video_track_timescale 12288 slotB.mp4
printf "file 'slotA.mp4'\nfile 'slotB.mp4'\n" > list.txt
ffmpeg -y -f concat -safe 0 -i list.txt -c copy video_only.mp4
# 本机实测：两段 3s(IDR 对齐) concat -c copy → 时长精确 6.000000s、144 帧整、无告警（x264 与 h264_videotoolbox 均验过）

# 3) 成片封装：视频流不重编码，挂音频/字幕
ffmpeg -y -i video_only.mp4 -i audio.mp3 -i subs.srt \
 -map 0:v -map 1:a -map 2:s -c:v copy -c:a aac -b:a 160k -c:s mov_text \
 -metadata:s:s:0 language=chi -shortest out.mp4
```

- **统一参数清单**（任何不一致都会让 `-c copy` 拼接出问题）：resolution/fps/pix_fmt/profile/level/timebase（用 `-video_track_timescale 12288` 钉死）、编码器与参数完全一致 [已验证来源：FFmpeg Wiki Concatenate；本机实测]。
- **运维风险（本机实测遭遇）**：`-stream_loop -1` 输入**必须**配输出侧 `-t`，否则 filter_complex 会无限渲染（我一次误操作写出 11GB 文件把盘写满——该机器磁盘常年 95%+，`+faststart` 需要约 2×成片临时空间，BRIEF 里 `AUDIOBOOK_NO_FASTSTART` 的开关请保留，并在渲染前做磁盘配额检查）。

---

## 2. zoompan 抖动修法

### 2.1 根因与权威修法

- **根因（官方 bug，2015 年至今 open）**：zoompan 把 crop 窗口的位置/尺寸**截断到整数像素**，无子像素插值。Trac #4298「zoompan filter creates shaky image」，Gyan（ffmpeg-filters 文档维护者）2024-10 复核：「It is not about the input — it is about sub-pixel rendering … What's needed is anti-aliasing」；2025-03 用户证实 2x 放大能减轻但不能根除；2026-06 有用户改用 libplacebo + 动画 crop 参数后「smooth, renders FAST, no jitter」；社区子像素补丁（pYtoner 2025-04 `subpixel_zoompan` 分支）未合入上游 [已验证来源：https://trac.ffmpeg.org/ticket/4298，检索于 2026-08]。
- **权威 workaround = 先放大再 zoompan**：Superuser 经典问答（Gyan 答复）给的是先 `scale=8000x4000` 再 zoompan [已验证来源：https://superuser.com/questions/1112617/ffmpeg-smooth-zoompan-with-no-jiggle]。ffmpeg-micro 的量分析：1920 宽图 zoom 到 1.4x 时 crop 每帧缩 ~2.2px、x 每帧移 ~1.1px，截断后呈「1,1,2,1,1,2」步进=抖动；放大到 ~4x 输出宽（7680）后 1 源像素=0.24 输出像素，量化误差落到可视阈值以下，缩放器代行了 zoompan 不做的插值 [已验证来源：https://www.ffmpeg-micro.com/blog/ffmpeg-zoompan-filter-ken-burns-zoom-and-pan-without-the-jitter]。
- **关键优化（本机实测）**：**把「放大」从每帧滤镜链挪到一次性资产预处理**。每帧 lanczos 放大到 7680 的成本是灾难性的：

| 滤镜链（12s 输出，M4，null 输出，纯滤镜成本） | 耗时 | 相对现状 |
|---|---|---|
| A 现状：无超采样，**12fps** | 5.5s | 1.0x |
| A24 现状链直接跑 **24fps**（输入 24fps，无丢帧） | 5.1s | **0.9x（免费！）** |
| B 每帧 scale 到 7680×4320 + zoompan，24fps | 44.5s | 8.1x |
| B2 **预先放大 4x 图（缓存 PNG）** + zoompan→1080p，24fps | 34.1s | 6.2x |
| C **预先放大 2x 图（缓存 PNG）** + zoompan→1080p，24fps | **10.1s** | **1.8x** |
| D 预放大 4x + zoompan s=4K + lanczos 下采，24fps | 49.7s | 9.0x |
| E 原图 + zoompan s=4K + lanczos 下采，24fps | 17.1s | 3.1x |

- **推荐 C（2x 预放大）**：crop 整数步进在 3840 域=0.5 输出像素，比现状（1.0 输出像素步进）减半，且 zoompan 内部双线性下采样进一步抹平；社区标准做法是 4x 更保险 [社区经验：ffmpeg-micro/Superuser 的 4x 经验值]，但 4x 的 CPU 成本（6.2x）对「每集十几分钟长片」不划算。折中：**2x 为默认，重点镜头（每集开头/标题图）用 4x** [推断]。
- **24fps 的代价：≈0**（本机实测 A24=5.1s vs A=5.5s——现状 12fps 其实是 25fps 输入经 zoompan 再 `fps=12` 丢帧，滤镜成本本来就按 25fps 付了；直接输出 24fps 不多花钱）。运动流畅度翻倍，这是「免费」的视觉提升。注意 zoom 表达式里 `on` 的步进系数要按帧率换算（12fps 的 0.00004 ≈ 24fps 的 0.00002）。
- **替代方案（不必采用，记录备查）**：
  - `crop`（x/y 支持 t/n 逐帧表达式）+ `scale=eval=frame`（w/h 支持 t）纯表达式实现——但 crop/scale 同样整数化，且 crop 的 w/h 只在初始化求值，zoom 无法逐帧变，仍需超采样域 [已验证来源：ffmpeg-filters 文档 crop/scale 条目， https://ffmpeg.org/ffmpeg-filters.html；推断其精度特性]。
  - libplacebo 滤镜（真子像素、GPU）：homebrew ffmpeg 7.1 **未编译**（本机实测 `-filters` 无输出），需自编译；Trac #4298 2026-06 有用户报告效果又快又稳 [已验证来源：Trac #4298]。
  - 第三方 glide-ffmpeg（浮点变换替代 zoompan）[社区经验：https://ithub.global.ssl.fastly.net/Loomos-hub/glide-ffmpeg，未亲测]。
  - zoom-out 方向要用 `z='if(lte(on,1),1.5,max(1.001,zoom-0.002))'` 以 `on` 播种，避免在 1.0 处弹跳；缓动用 `z='1+0.3*(1-cos(PI*on/249))/2'` [社区经验：ffmpeg-micro]。

### 2.2 推荐段内滤镜链（含雪，完整）

```bash
[0:v]zoompan=z='min(1+0.0001*on,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,fps=24,format=yuv420p[base]
```
（输入是预放大的 cover_2x.png；`s=` 只认字面量尺寸，不支持 iw/ih——与现有代码注释一致）

---

## 3. blend 优化：`c0_mode=screen` 替代 gbrp 全平面 screen

### 3.1 为什么要转 gbrp、以及为什么可以不转

- **原委**：`blend=all_mode=screen` 作用于**所有平面**。在 yuv420p 上意味着 U/V 也被 screen 混合，白色雪花（色度≈128）被推向「U/V 同时变亮」，出现品红/紫雪；所以现实现被迫 `format=gbrp` 进 RGB 平面混完再转回 [已验证来源：现源码 video.ts:50-57 注释；ffmpeg-filters blend 文档 https://ffmpeg.org/ffmpeg-filters.html]。
- **替代已实证**：`blend=c0_mode=screen` 只混第 0 平面。yuv420p 平面序为 Y,U,V，即**只 screen 亮度、色度不动**；且实测未指定的 c1/c2 平面默认直通底图（`c1_opacity=0:c2_opacity=0` 与不写**字节级相同**，本机实测）[已验证来源：ffmpeg-filters 文档（yuv420p 平面 0.5,0.5 子采样说明）+ 本机实测]。
- **视觉等效性（本机实测）**：真实 snow.mp4 + 暗色低饱和底图，两种混合输出 PSNR **y:32.5 / u:35.8 / v:41.2**（对近黑背景+白色粒子，≈「看不出差别」量级；饱和度越高差异越大）。
- **性能（本机实测，1080p24 10s 纯滤镜）**：

| 混合方式 | 耗时 | 倍率 |
|---|---|---|
| `format=gbrp` ×2 + `blend=all_mode=screen` + 回 yuv420p（现状） | 0.57s | 1x |
| yuv420p 直连 `blend=c0_mode=screen:c0_opacity=0.6` | **0.17s** | **3.4x** |

- 注意：blend 本身在整条管线里不是大头（zoompan 才是），但省掉两次像素格式转换也省内存带宽，且**根除紫雪类色域事故面**。
- 白点叠加语义：screen = 1-(1-a)(1-b)，在 Y 上做时「亮处更亮、暗处透出雪花」的观感与 RGB 域一致（Y' 的 screen 与 RGB screen 经 BT.709 矩阵后存在轻微非线性差，实测即上述 ~33dB）[推断+实测佐证]。
- **附加建议**：雪花强度 0.6 偏高导致「发灰发假」的主观感受，可降到 0.35-0.45，并考虑给雪花加 `eq=contrast=1.1` 或改用少量大粒子素材 [推断]。

```bash
# 推荐（yuv 域，只混亮度）
[base][ovl]blend=c0_mode=screen:c0_opacity=0.45
```

---

## 4. GPU 链路现状（ffmpeg 7.x/8.x / VideoToolbox）

### 4.1 ffmpeg 7.1 本机能力（本机实测）

- `scale_vt` 存在且可用；全链冒烟通过：`hwupload → scale_vt → hwdownload → h264_videotoolbox`（3s 1080p→720p 0.29s 含进程启动）。参数只有 w/h/color_matrix/primaries/transfer——**只有缩放**，没有 crop/zoompan/blend 的 VT 等价物，所以「GPU 全程滤镜」不成立；能 GPU 化的只有解码→缩放→编码 [本机实测]。
- `h264_videotoolbox` 关键发现：
  - **默认不输出 B 帧**（实测 6s 素材 12 I + 132 P，0 B）；**`-bf 2` 可以打开**（实测 44 B/8 I/20 P）。Trac #8353 记录了该行为 [已验证来源：https://trac.ffmpeg.org/ticket/8353；本机实测]。
  - 有 `-frames_before/-frames_after`（官方注释：「helps smooth concatenation issues」）——VideoToolbox 会话切换在段边界可能引入质量/码率毛刺，分session硬编拼接时要留意 [已验证来源：`ffmpeg -h encoder=h264_videotoolbox` 本机输出]。
  - ABR 码率控制松：`-b:v 4M` 在易内容上实际只产出 ~2.2Mbps（undershoot）[本机实测]；社区共识是它 CRF/质量模式弱、需要码率调参 [社区经验：stackoverflow.com/questions/63460919；VideoHelp 论坛]。
- **结论：对本管线，GPU 的价值只剩编码**；而滤镜（zoompan/blend）是瓶颈所在，GPU 链路（hwupload/hwdownload 的 NV12 往返）反而增加复杂度。**建议维持 CPU 滤镜 + 视编码器对比结果决定编码落点** [推断，基于 4.2 数据]。

### 4.2 硬编 vs 软编：M4 本机实测（6s@1080p24，zoompan+雪花内容，VMAF 对无损源）

| 编码 | 耗时 | 体积 | VMAF |
|---|---|---|---|
| h264_videotoolbox 4M | 0.79s (183fps) | 1.66MB | 95.39 |
| h264_videotoolbox 4M + `-bf 2` | ~0.8s | 1.90MB | 95.21 |
| h264_videotoolbox 2M | 0.79s | 1.29MB | 94.22 |
| hevc_videotoolbox 2M | 0.81s | 1.35MB | 95.47 |
| libx264 veryfast CRF20 | **0.35s (411fps)** | 0.88MB | 94.70 |
| libx264 medium CRF20 | 0.61s | 1.04MB | 96.05 |
| **libx264 medium CRF23** | **0.60s (240fps)** | **0.77MB** | **95.20** |
| libsvtav1 preset6 CRF32 | 1.94s (74fps) | 0.61MB | **96.92** |
| libsvtav1 preset8 CRF32 | 1.25s (115fps) | 0.82MB | 95.63 |

**读数**：同 VMAF 档（~95.2-95.4）下 `libx264 medium CRF23` 比硬编 4M **更快且体积减半**——近静态+粒子内容是 x264 的主场（B 帧+ lookahead 吃满）；硬编在难内容/高并发时才有优势。外部数据侧写：硬件 H.264 一般比 x264 slow 低 1-3 VMAF，但「VideoToolbox 在 M 系上异常地好」[社区经验：creativeworksofknowledge.com FFmpeg Quest；colinmckellar.com 2024-01 编码器对比（x264 参考最好，https://colinmckellar.com/2024/01/11/video-encoder-comparison/）]；scottstuff 2025-03 实验提醒 **VMAF 可能漏检硬编的预滤波模糊**（nvenc VMAF 打平但肉眼明显更糊，建议加 VMAF_NEG 模型复核）[已验证来源：https://scottstuff.net/posts/2025/03/15/a-tale-of-two-encoders/]。本机数据为单一样本，建议按 §6 的门禁在真实素材上复核 [本机实测+社区经验]。

### 4.3 FFmpeg 8.0「Huffman」（2025-08-22 发布）值不值得升 [已验证来源：https://ffmpeg.org/index.html#news；Phoronix https://www.phoronix.com/news/FFmpeg-8.0-Released；LWN https://lwn.net/Articles/1034813/]

- 新增：Vulkan 计算型编解码（FFv1 编解码、ProRes RAW 解）、**Vulkan AV1 硬编**、Vulkan VP9 硬解、VAAPI VVC 解、Whisper 滤镜（ASR）、colordetect/pad_cuda/scale_d3d11 滤镜、APV/ProRes RAW 原生解码等。**macOS/VideoToolbox 方向零改动**（scale_vt/transpose_vt 早在 6.1）。
- 结论：对本管线**无直接收益，不建议急升**。M4 无 AV1 硬编（M3 起只有 AV1 硬**解**）[已验证来源：MacRumors 论坛勘误 + Apple M3 发布说明， https://forums.macrumors.com/threads/av1-encoding-test.2411996/]，Vulkan AV1 编码在 Apple GPU（MoltenVK 无 compute encode 路径支持）也指望不上 [推断]。8.x 的价值在 AVFoundation 生态外的通用修复，等 homebrew 稳定 8.1.x 再跟。

---

## 5. 投 YouTube 的编码选型

### 5.1 官方推荐（2026-08 检索）[已验证来源：https://support.google.com/youtube/answer/1722171]

- **视频：H.264，High Profile，渐进扫描，2 连续 B 帧，Closed GOP（GOP=帧率一半），CABAC，4:2:0**；容器 MP4 + faststart（moov 前置）+ 无 edit list；音频 AAC-LC 48kHz（立体声推荐 384kbps）。
- 推荐码率：1080p SDR 24/25/30fps **8 Mbps**、48/50/60fps 12 Mbps；**「No bitrate limit is required」——高码率母带被明确允许**（列表仅供参考）。
- 官方页只列 H.264；但 YouTube 实际接受 HEVC/AV1 上传并在服务端转 VP9/AV1 梯子（UHD 已逐步用 AV1 替换 VP9，码率略降质量持平）[已验证来源：reddit r/AV1 实测 https://www.reddit.com/r/AV1/comments/1likz8a/；社区经验：上传 4K 触发更高码率的 VP9/AV1 梯子，回落 1080p 也更好]。创作者圈共识：**上传最高质量母带，让 YouTube 的 VP9/AV1 编码器吃干净源**；有硬件 AV1 时甚至传 AV1 10bit ~60Mbps [社区经验：zebgardner.com 2026 上传指南、EOSHD/VideoStackExchange]。

### 5.2 本项目落地建议

- **主路线：`libx264 -preset medium -crf 18~20 -bf 2`**（本机实测 240-411fps，15 分钟片子 1-3 分钟；CRF18 输出≈视觉无损母带，YouTube 转 VP9 后质量上限最高）。CRF 上限 23 也够（VMAF 95.2）。闭 GOP+`-bf 2`+CABAC 全对齐官方推荐。
- **不推荐 h264_videotoolbox 做母带**：同 VMAF 体积翻倍（本机实测），YouTube 拿到的源质量更低。
- **SVT-AV1 on Apple Silicon（CPU 编码）**：本机实测 preset6/CRF32 @1080p24 = **74fps**（VMAF 96.92、体积最小），preset8=115fps；15 分钟成片分别约 4.9/3.1 分钟。外部参照：SVT-AV1 2.3 起 ARM64 原生 NEON 优化大幅提速（Phoronix AArch64 实测全面快于 2.2， https://www.phoronix.com/news/SVT-AV1-2.3-ARM-Performance；HN 提到 ARM 侧 YoY ~300% 改善， https://news.ycombinator.com/item?id=41984641；v3.0.0 又有 15-25% 提速， https://gitlab.com/AOMediaCodec/SVT-AV1/-/releases）；M1→M3 Max 同任务提速 ~70%（MacRumors 实测， https://forums.macrumors.com/threads/av1-encoding-test.2411996/）。**AV1 只在「本地存档/带宽受限」时有意义**——YouTube 上传收益边际小、耗时 2-4x，不建议为上传专门做 [推断+实测]。
- 15 分钟 1080p24 母带体积预估（按本机码率外推）：x264 CRF18 ≈ 2-4 Mbps ≈ 250-450MB/15min（雪花粒子会抬高码率，建议 `x264-params nal-hrd=cbr` 不必要，plain CRF 即可）[推断]。

```bash
# 成片母带（推荐）
ffmpeg -y -i video_only.mp4 -i audio.mp3 -i subs.srt \
 -map 0:v -map 1:a -map 2:s \
 -c:v libx264 -preset medium -crf 18 -bf 2 -flags +cgop \
 -pix_fmt yuv420p -r 24 -video_track_timescale 12288 \
 -c:a aac -b:a 192k -c:s mov_text -metadata:s:s:0 language=chi \
 -movflags +faststart -shortest out.mp4
```

---

## 6. libvmaf 客观画质门（段级/成片级回归）

- **命令范式**（失真在前、参考在后；分辨率必须一致，否则分数失真）[已验证来源：ffmpeg-filters 文档；Fora Soft 教程 https://www.forasoft.com/learn/video-quality/articles-vqm/measuring-quality-ffmpeg-libvmaf；Netflix/vmaf#248]：

```bash
# 段级：新段 vs 基准段（基准用无损或 CRF0 编码缓存）
ffmpeg -i seg_new.mp4 -i seg_ref.mp4 -lavfi \
 "libvmaf=log_path=vmaf_seg.json:log_fmt=json:n_threads=8:n_subsample=5" -f null -
# 成片级：抽查验全片（n_subsample=5 每 5 帧取 1，速度×5）
ffmpeg -i out_new.mp4 -i out_ref.mp4 -lavfi \
 "libvmaf=log_path=vmaf_full.json:log_fmt=json:n_threads=8" -f null -

# 解析阈值判定（jq）
jq '[.pooled_metrics][] | select(.metric=="vmaf") | .metrics.vmaf | mean' vmaf_seg.json
# 或直接取 stderr 汇总行 "VMAF score: XX.XXXXXX"
```

- **本机实测性能**：单线程 libvmaf 只有 ~28fps（15 分钟全片要 ~13 分钟）；**`n_threads=8` → 116fps（4.2x，15 分钟片约 3 分钟）**。
- **门禁建议**：段级 VMAF ≥ 96（对无损基准）、成片 ≥ 94 抽检；编码器/参数变更跑 A/B；**警惕 VMAF 对硬编预滤波模糊的漏检**（scottstuff 案例），重要变更加肉眼抽帧 [已验证来源：scottstuff 2025-03]。
- 注意 ffmpeg 的 libvmaf 默认模型是 1080p 训练版，与本项目分辨率匹配，无需 `model_path` [已验证来源：ffmpeg-filters 文档]。

---

## 7. 风险与不确定项

1. 本机 VMAF/速度数据为单一样本（testsrc2 派生+真实 snow.mp4），复杂封面图（高频纹理/文字）会拉大 x264 与硬编差距的方向不确定，上线前用 §6 门禁在真实素材上跑一轮 [不确定]。
2. 2x 超采样对「超慢推」(<0.06/25s) 是否完全无感，缺乏正式主观评测；建议先出 A/B 样片人工审 [不确定]。
3. 拼接点雪花 ~40dB 残差：对落雪不可感知，但换更强方向性粒子（雨/萤火）素材时需重验偏移对齐 [推断]。
4. `h264_videotoolbox` 若保留用于草稿快出，段拼接处 VideoToolbox session 切换可能有质量毛刺（`-frames_before/-frames_after` 是官方缓解开关，未定量测试）[不确定]。
5. 磁盘余量是硬约束（本机 95%+）：段缓存全集估算 ≈ 8 图 × 25s × ~2-4Mbps ≈ 60-100MB/集规格，可控；faststart 临时双倍空间需保留开关 [本机实测+推断]。
6. ffmpeg 8.x 升级窗口：待 homebrew 8.1 稳定后验证 `-sc_threshold/-flags +cgop` 行为不变再切 [推断]。

---

## 附：本报告全部本机实测的复现环境

- ffmpeg 7.1 homebrew（`--enable-videotoolbox --enable-libsvtav1 --enable-libvmaf --enable-libx264`），Apple M4 16GB，2026-08-30。
- 基准口径：`-f null -` 纯滤镜/编码成本，`/usr/bin/time -p` 墙钟；VMAF 对 `libx264 -qp 0` 无损基准；PSNR 用 `-lavfi psnr`。
- zoompan 基准用 testsrc2 派生 2560×1440 静帧；雪花混合用仓库内 dist/audiobook-v3/assets/snow.mp4（1920×1080 25fps 10s）。

## 来源索引（检索日期 2026-08-30）

- FFmpeg Trac #4298 zoompan shaky: https://trac.ffmpeg.org/ticket/4298
- FFmpeg Trac #8353 videotoolbox B-frames: https://trac.ffmpeg.org/ticket/8353
- FFmpeg Wiki Concatenate: https://trac.ffmpeg.org/wiki/Concatenate
- Superuser zoompan jiggle: https://superuser.com/questions/1112617/ffmpeg-smooth-zoompan-with-no-jiggle
- ffmpeg-micro zoompan jitter: https://www.ffmpeg-micro.com/blog/ffmpeg-zoompan-filter-ken-burns-zoom-and-pan-without-the-jitter
- ffmpeg-micro split segments: https://www.ffmpeg-micro.com/blog/ffmpeg-split-video-into-segments
- Superuser DASH keyframes: https://superuser.com/questions/908280/what-is-the-correct-way-to-fix-keyframes-in-ffmpeg-for-dash
- Kdenlive #1868 并行渲染： https://invent.kde.org/multimedia/kdenlive/-/issues/1868
- Blender VSE 分段： https://blender.stackexchange.com/questions/7738/how-to-make-vse-render-faster
- FFmpeg 8.0 发布： https://ffmpeg.org/index.html#news ｜ Phoronix: https://www.phoronix.com/news/FFmpeg-8.0-Released ｜ LWN: https://lwn.net/Articles/1034813/
- YouTube 官方编码： https://support.google.com/youtube/answer/1722171
- scottstuff 编码器对比： https://scottstuff.net/posts/2025/03/15/a-tale-of-two-encoders/
- colinmckellar 编码器对比： https://colinmckellar.com/2024/01/11/video-encoder-comparison/
- SVT-AV1 ARM64: https://www.phoronix.com/news/SVT-AV1-2.3-ARM-Performance ｜ https://news.ycombinator.com/item?id=41984641 ｜ https://gitlab.com/AOMediaCodec/SVT-AV1/-/releases ｜ https://forums.macrumors.com/threads/av1-encoding-test.2411996/ ｜ https://www.reddit.com/r/handbrake/comments/1gfpkhv/
- libvmaf 用法： https://ffmpeg.org/ffmpeg-filters.html ｜ https://www.forasoft.com/learn/video-quality/articles-vqm/measuring-quality-ffmpeg-libvmaf ｜ https://stackoverflow.com/questions/67598772/
- scale_vt/hwaccel: https://ffmpeg.org/ffmpeg-filters.html ｜ https://yago.blog/ffmpeg-at-the-speed-of-m5 ｜ https://www.martin-riedl.de/2020/12/06/using-hardware-acceleration-on-macos-with-ffmpeg/
