# 有声书视频渲染 · 最佳实践架构方案（终稿）

> 汇总自五路平行深度调研 + 本机（Apple M4 / 16GB / ffmpeg 7.1）8 组实测：
> [我的基准 bench/](bench/run.sh) · [agy.md](agy.md)（含其自跑 M4 基准+VMAF）· [cursor.md](cursor.md) · [zc-ffmpeg-native.md](zc-ffmpeg-native.md) · [zc-render-engines.md](zc-render-engines.md) · [zc-ai-motion-delivery.md](zc-ai-motion-delivery.md)
> 日期：2026-08-30。grok CLI 因免费额度耗尽中途出局。

---

## 0. 一句话方案

**把「每集全时间线重编」改成「段级缓存 + 秒级无损组装」的增量管线，同时做画质四连击（24fps / supersample / 1440p VT 8M / 亮度直混雪花），交付侧修掉字幕被 YouTube 忽略的 bug，效果跃迁走「2.5D 视差底座 + AI 图生视频 hero 槽位」混合。**

四方调研在核心判断上完全收敛：**瓶颈不是缺一个新引擎，而是架构（无缓存）+ zoompan 数学（整数截断）+ 混合路径（gbrp 往返）**。Remotion / Motion Canvas / WebCodecs / AVFoundation / libplacebo 全部评估后否决或降级为未来 PoC（详见 zc-render-engines.md：Remotion 实测耗时=视频时长 2-4 倍，比现状慢一个量级）。

## 1. 实测证据汇总（本机 M4）

| # | 实验 | 结果 | 结论 |
|---|------|------|------|
| B1 | 现状管线精确复刻（60s） | **30s**（≈0.5x 实时） | 15min 集 ≈7.5min，与体感一致 |
| B2 | 8K supersample + 24fps + x264 medium | 24s | 画质升级代价很小 |
| B3 | `blend=c0_mode=screen`（亮度直混，免 gbrp） | **5s（6 倍提速）** | gbrp 往返+全平面混合是最大单点浪费 |
| B4 | 30s 段渲染 + concat `-c copy` | 段 11s，**组装 0s** | 分段架构的组装成本为零 |
| B5 | 成片层雪花 overlay 通道（VT 8M） | 14s/60s | 雪花放组装层可行但非零成本（~3.5min/集） |
| B6 | VT 尊重 `-g 24 -bf 0`？ | **严格 IDR+23P 循环** | 硬编段 closed GOP 可靠，任意关键帧对齐可切 |
| B7 | screen 混合抬黑量化 | YAVG +2（亮场） | 暗场更明显——「发灰」体感来源之一 |
| B8 | 雪花全局偏移烘焙跨切点连续性 | 对齐 36.8dB vs 错相 30.1dB | **锁相方案数学上成立，实测无粒子跳变** |

agy 补充实测（同机）：4K supersample 是甜点（8K 慢 63% 边际收益差）；**VMAF：VT 4M=95.15、x264 medium=97.28、HEVC-VT 4M=96.41、VT 6-8M≈97.5+ 且速度不变**；VT 渲染时 CPU <15%（专用 ASIC）。

## 2. 为什么现在慢、为什么现在不好看

**慢**：单 graph 全时间线重编 + `format=gbrp` 全帧色域往返 + 任何改动（换一张图/调雪透明度/换 TTS）全部推倒重来。视频层零缓存。

**效果**：四个独立病因叠加——
1. **zoompan 整数截断抖动**：数学上每帧步长仅 0.076px，导致「静止 13 帧→跳 1px」的周期性颤抖（agy 推导）；
2. **12fps 幻灯感**：不在 YouTube「常见帧率」承诺清单内，慢推明显卡顿；
3. **screen 全平面混合抬黑**：暗场发灰、雪花发假；
4. **主动降分辨率**：场景图原生 2560×1440 却 `crop=1920:1080`，把自己送进 YouTube 1080p 低码率 avc1 转码池（agy [已验证]：1440p 上传才触发 VP9/AV1 高码率通道）。

**交付 bug**：现管线 `-c:s mov_text` 字幕轨 **YouTube 完全忽略**（zc-ai-motion-delivery [已验证]），必须走 `captions.insert` API 上传 SRT（`zh-Hans`，裸 `zh` 无效）。

## 3. 目标架构：三级缓存增量管线

```
L1 素材层（只读，内容哈希寻址）
├─ covers/     原生 2560×1440 归一化图 + 【一次性预放大 2x 变体缓存】
│              （zc-ffmpeg-native 实测：预放大后段渲染 10.1s vs 每帧现放大 44.5s）
├─ snow/       雪花母本，预转 1440p + 标准化（周期 L=10s 记录在元数据）
└─ ambient/    动态背景循环（2.5D 或 AI i2v 产物，5-10s seamless loop）

L2 段层（核心资产）
   key = sha256(图哈希 + 运动预设 + 时长桶 + 分辨率 + fps + 编码参数 + 雪参数)
   每段：closed GOP、首帧 IDR、统一 2560×1440@24fps yuv420p
   音频绝不切段（priming sample 漂移），段内无音轨

L3 组装层（秒级）
   concat demuxer -c copy → 全局音频一次挂载 + 字幕 + faststart
```

### 3.1 黄金路径命令（生产级）

```bash
# ── 0) 一次性资产预处理：预放大 2x 入 L1（每图仅一次）──
ffmpeg -y -i cover.png -vf "scale=5120:2880:flags=lanczos" covers_2x/<hash>.png

# ── L2 单段渲染（20s 桶，用预放大图，锁相雪花）──
# 注意：-stream_loop -1 必须配输出 -t（实测不配会写出 11GB 直到磁盘爆）
ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t 20.000 -i covers_2x/<hash>.png \
  -ss 0 -stream_loop -1 -i snow_1440p.mp4 \
  -filter_complex "\
[0:v]zoompan=z='min(1+0.000025*on,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=2560x1440:fps=24[bg];\
[1:v]fps=24[snow];\
[bg][snow]blend=c0_mode=screen:c0_opacity=0.35,format=yuv420p[vout]" \
  -map "[vout]" -t 20 -r 24 \
  -c:v libx264 -preset medium -crf 18 \
  -g 24 -keyint_min 24 -sc_threshold 0 -flags +cgop \
  -pix_fmt yuv420p -an seg_xxx.tmp.mp4 && mv seg_xxx.tmp.mp4 seg_xxx.mp4

# ── L3 组装（15min 成片 ≈1-2s）──
ffmpeg -hide_banner -loglevel error -y \
  -f concat -safe 0 -i concat.txt \
  -i episode.mp3 -i episode.srt \
  -map 0:v -map 1:a -map 2:s \
  -c:v copy -c:a aac -b:a 128k \
  -c:s mov_text -metadata:s:s:0 language=chi \
  -movflags +faststart -shortest ep_final.mp4
```

要点：
- **supersample 做成资产预处理**（zc-ffmpeg-native 实测）：每帧现放大 4x = 44.5s/12s，预放大 2x 缓存图后 = 10.1s——放大只做一次进 L1，段渲染直接吃大图；
- **雪花锁相（agy 周期整数倍法）**：标准桶时长 = 雪花周期整数倍（20s = 2×10s）→ 所有标准段 `-ss 0` 起播、缓存键与全局时间彻底解耦；仅尾段按 `T_start mod L` 计算偏移（B8 已验证无跳变）；
- **亮度直混**：`blend=c0_mode=screen` 只写 c0 即可——未指定的平面默认透传底图（字节级实测验证），真实雪花视觉等效 PSNR≈33.7dB，快 3.4x，根除紫雪；透明度 0.6→0.35 治发灰。仍嫌灰再退预烘焙 alpha overlay；
- **段编码器选 x264 CRF18 而非 VT**（关键反转，双实测交叉）：本内容形态（近静态）x264 medium CRF 模式 **240fps > VT 4M 的 183fps，且同 VMAF 下体积约一半**——CRF 率控对静态内容天然友好；closed GOP 参数齐全（VT 那边 `-g/-bf` 虽也生效但无 CRF）。VT 10M 保留给「赶速度」档；SVT-AV1 preset6 仅做存档母带；
- **24fps 免费拿**（实测 24fps 5.1s ≈ 12fps 5.5s，VT/静态内容下帧数翻倍但单帧成本减半）；
- **-shortest + 尾段动态时长**：总时长=音频时长，前 N-1 段标准桶，尾段=余数，防黑尾。

### 3.2 防死机工程约束（16GB 红线）

- Worker 并发 **≤2**（p-limit / SQLite 队列），段渲染单进程内存 ~1GB 可控（现状整集 graph 才是 OOM 元凶）；
- 原子写：`.tmp.mp4` → `rename`；断点续渲=重启扫目录清 `.tmp`、跳过已存在段；
- `nice -n 15` 保持前台可用。

### 3.3 增量语义（改什么，重渲什么）

| 改动 | 重渲范围 | 耗时 |
|------|---------|------|
| 换一张场景图 | 该图 L1 预放大 + 命中的段 | ~2s/段 + 组装 2s |
| 调雪花透明度 | 若雪在段内：全部段；若雪在 L3 通道：仅一条 VT pass | 前者分钟级 / 后者 ~3min |
| 换 TTS / 改字幕 | **零重渲**，重新组装 | ~2s |
| 新一集（同图库） | 段全命中 + 尾段 | ~5s |
| 新图库首渲 | 全部段（x264 CRF18） | ~2-4min/集 |

## 4. 画质四连击（全部本周可落地）

1. **24fps**（实测与 12fps 成本相同：5.1s vs 5.5s——白赚一倍流畅度，且进 YouTube 帧率承诺清单）；
2. **supersample zoompan**（一次性预放大进 L1，消灭 0.076px/帧整数截断颤抖）；
3. **1440p + x264 CRF18 段母带**（原生分辨率直出 + 触发 VP9/AV1 转码池；同 VMAF 下比 VT 更快更小；赶速度档用 VT 10M，VMAF 97.5+）；
4. **亮度直混雪花 @0.35**（免 RGB 往返、不抬黑、不紫雪，3.4x 提速）。

**QA 门**：libvmaf `n_threads=8` 实测 116fps——15 分钟成片约 3 分钟可全片回归（单线程仅 28fps，务必开多线程）；注意 VMAF 会漏检硬编预滤波类模糊，需配肉眼抽查。

## 5. 交付侧修正（bug 级，立刻做）

1. 字幕：`captions.insert` API 上传 SRT，`language=zh-Hans`（MP4 内 mov_text 保留给本地播放器，YouTube 不读它）；`videos.update` 设 `defaultLanguage=zh-Hans`；
2. 章节标记：首章 0:00、≥3 章、章名用情节钩子（听书类刚需，回访场景）；
3. 多音轨（未来英配）：**Data API 不支持 MLA**，Studio UI 手动——管线里做成上传后 checklist 项。

## 6. 效果跃迁三档（按留存数据逐档推进）

| 档 | 内容 | 成本 | 时机 |
|----|------|------|------|
| **P2-1** | 全槽 2.5D 视差替代 zoompan：`coreml-depth-anything-v2-small` 本地出深度图（M4 秒级/张）+ `displace` sin 缓动（天然无缝循环、无生成风险、人物不变形） | ¥0，本地 | 画质四连击验收后 |
| **P2-2** | hero 槽位 AI 循环：每集 6-8 槽（冷开场/章节转场/高潮）用同图首尾帧 i2v；首选 Vidu Q3-turbo（$0.33/条 1080p）或 Kling 2.5 Turbo Pro via fal（$0.35/5s），压成本用 Wan2.6-flash 无声（¥1.25/条）；prompt 锁 `static camera, subtle ambient motion`（Seedance 另有 API 级 `camera=fixed`） | **¥15-25/集** | P2-1 数据出来后 |
| **P2-3** | 全量 36 槽 AI 化 | ¥135-660/本 | 仅当 hero 槽位留存提升被验证 |

循环策略：背景层往复型运动（云/树摇/烛光）→ palindromic 兜底安全；**雪花始终独立层持续向下，绝不倒放**。AI 段失败自动降级回 Ken Burns 段（不阻塞发布）。

## 7. 与 Web 一键出片的衔接

- 渲染 worker 天然队列化（L2 任务粒度小、可断点），直接挂进 web server 现有 jobs 模式（`POST /api/projects/:id/audiobook` → 入队 → SSE 进度 → 产物下载）；
- 增量语义（3.3 表）让 Web 端「换图即时出片」成为可能（<10s 反馈闭环）；
- 远期若要浏览器内所见即所得预览：WebCodecs + mediabunny（TS 原生，Screen Studio 生产先例）是唯一与「Web 一键」同构的路线（zc-render-engines 路线 B），仅做预览，成片仍走本管线。

## 8. 明确不做

- ❌ 换 Remotion / Motion Canvas / AVFoundation 当主渲染器（四方一致否决，速度与工程成本双输）
- ❌ 默认 SVT-AV1 本地压制（YouTube 不需要，白烧 CPU）
- ❌ 指望 `scale_vt`/零拷贝救 zoompan（zoompan/blend 是 CPU 滤镜，7.1 无 VT 版；agy 源码级确认）
- ❌ Win11/NVENC 分布式（缓存红利吃完后瓶颈在 I/O 不在算力；跨平台维护负收益）
- ❌ ffmpeg 8 / libplacebo / Vulkan（brew 无 libplacebo；等官方构建再说，收益不在痛点上）

## 9. 风险与验证点

| 风险 | 级别 | 缓解 |
|------|------|------|
| 1440p→VP9/AV1 通道说法是社区共识级 | 中 | 首集上传后用「统计-流量来源/播放画质」实测确认，回退方案=保持高码率母带（8-10M） |
| luma 直混观感（发灰缓解但非 alpha 合成） | 低 | 实施时 A/B：luma 直混 vs 预烘焙 alpha overlay，VMAF+肉眼双门 |
| displace 2.5D 边缘拉扯 | 中 | supersample 5-10% 后 displace 再裁回 + `edge=smear`；真实素材先跑 5 张 |
| i2v 首尾帧同图偶发「近静止」/被忽略 | 中 | 每家先跑 5 条小样本再定供应商；Veo 用亮度 +1% 差异规避 |
| AI 价格周更 | 中 | 下单前复核官方页（报告内价格快照 2026-08-30） |
| **磁盘常年 95%+（本机实况）** | 高 | L2 缓存设容量上限+LRU 清理；上传后成片即转 `~/Downloads`/外置盘；磁盘紧张时 `AUDIOBOOK_NO_FASTSTART=1`（faststart 瞬时双倍空间；YouTube 上传本不需要它） |
| **`-stream_loop -1` 不配输出 `-t`** | 高 | 已实测误用会无限写盘（11GB）——渲染器代码里二者强制成对出现 |
| 16GB 内存 | 中 | 并发≤2 硬顶 + 分段（架构本身即解） |

## 10. 落地顺序与状态

1. **P0 ✅（2026-08-30 已落地）**：`video.ts` 重构为段渲染器 + concat 组装 + 缓存目录（实现拆为 `video.ts`/`render-assets.ts`/`assemble.ts` 三文件，过 Mimosa 写入门）；参数 24fps/2x supersample(5120×2880)/1440p/**x264 CRF18 段母带**/luma 直混 0.35（env 可调 AUDIOBOOK_SNOW_OPACITY）/锁相 20s 桶。**e2e 实测（62s 双图+雪花+字幕）：冷渲 23.1s、全缓存命中重渲 0.5s、换一张图 15.1s（仅重渲 1/3 段）**；产物 2560×1440@24 + mov_text 中文轨校验通过；
2. **P0.5 ✅**：youtube.ts 章节时间戳（首条 0:00、≥3 条生效）进描述；captions 字段（zh-Hans）+ UPLOAD.md 上传指引（YouTube 忽略 MP4 内封字幕轨）；实际 captions.insert API 待 publish 步骤接入 OAuth 后补；
3. **P1 ✅（2026-08-30 实测，森铁 EP01，edge 引擎验证）**：56 分钟真实一集全流程 899s（TTS 大头，视频渲染仅 222s）；**169 槽 / 153 缓存命中**（15 图轮换 × 20s 标准桶 → 仅 16 个唯一段真渲，缓存设计按预期发挥）。QA 门全过：规格（1440p24/h264+aac/mov_text chi/时长贴合）、无黑帧、响度 -16.72 LUFS/-1.46 TP、VMAF 96.8（CRF18 vs CRF12 参考，>95 门）；成片 3.1GB @7.9Mbps。上传物料含章节导航（0:00 冷开场…）与 captions(zh-Hans)。**VP9 通道验证待用户传 unlisted 测试片**（dist/audiobook-v4/vp9-test-60s.mp4，60s/76MB，传后 yt-dlp -F 验证）。**磁盘警示**：全片仅剩 6.8Gi，5 集 × 3.1GB 不可行——需 上传后即删 / 转 Win11（tailnet rsync）/ AUDIOBOOK_NO_FASTSTART 策略之一；
4. **P2**：2.5D 模块 → hero 槽 i2v provider（火山/fal 抽象）→ 按留存逐档推进；
5. **P3**：Web 端一键出片（jobs 挂载 + SSE 进度 + 产物面板）。

测试：`tests/unit/video.test.ts` 12 用例（锁相/帧栅格/stream_loop-t 成对/closed-GOP/章节规则）+ `tests/e2e/render.e2e.test.ts`（AUDIOBOOK_E2E=1 触发真渲染，含 blend 色度透传回归）。既有失败 `信件段` 用例在 HEAD 上已存在，与本次无关。

### Review 轮次（opencodereview / glm-5.3-flash，2026-08-30）
11 条意见，处置：**8 条采纳修复**——章节两处（冷开场 <10s 并入首章锚点、<3 锚点时打警告防静默失效）、缓存键编码指纹改为从 X264_SEG_PARAMS 派生、雪花派生文件改内容哈希寻址、concat 清单单引号转义、run.sh 的 $(cat) 管道 bug 与陈旧产物清理；**1 条 high 证伪**——「blend 只设 c0 时色度被雪洗掉」经分平面 PSNR 实证不成立（u/v≈62dB 纹丝不动；反而按文档直觉补 c1_opacity=0 会真把色度变灰），行为已锁进 e2e 回归测试与代码注释；run.sh 其余 3 条（计时精度/场景口径/shebang）以头注说明为探索性基准，不再投入。
