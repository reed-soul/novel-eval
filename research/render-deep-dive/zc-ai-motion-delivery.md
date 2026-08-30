# AI 动态背景（图生视频）与 YouTube 投递包装 · 深度调研报告

- 调研人：ZCode（AI 视频生成与分发方向研究员）
- 调研日期：**2026-08-30**（全部联网检索当日有效信息，价格为检索时点快照，标注来源与日期；AI 视频行业价格变动极快，下单前务必复核官方页）
- 项目背景：见 `research/render-deep-dive/BRIEF.md`——有声书视频（静态场景图 + Ken Burns 12fps + 落雪层，h264_videotoolbox 4M），每集 10-18 分钟、36 个 ≤25s 槽位轮换，投 YouTube。
- 标注体系：**[已验证]**＝官方文档/定价页或多个独立来源交叉证实；**[社区经验]**＝论坛/博客/第三方实测；**[推断]**＝本报告的工程推断。

---

## TL;DR（先看这个）

1. **图生视频做 ambient 背景，2026-08 已经完全可 API 化批量生产**，且价格战打到地板：**无声 1080p 档最低约 ¥0.25-1.25/5s**（万相 wan2.6-i2v-flash 无声 1080P ¥0.25/s；Vidu Q3-turbo 1080P $0.065/s；Kling 2.5 Turbo Pro $0.07/s）。**36 槽 × 5 集全 AI 化成本约 ¥135-900/本**，不是 ¥几万。
2. **无缝循环的关键能力是「首尾帧（first/last frame）生视频」**，且已平民化：Vidu Q1/Q2/Q3、Kling O1/O3、Seedance 1.0 pro+、万相 2.5/2.7、Veo 3.1、Pikaframes 都支持。**同一张图既当首帧又当尾帧 → 模型被迫生成"回到原点"的运动 = 天然无缝循环**。这是首选方案。
3. **ffmpeg palindromic（正放+倒放）伪循环零成本兜底**，但对**有方向性的粒子（雪/雨/烟/瀑布）是灾难**（倒放时雪往上飘）。本项目雪花是独立图层，背景层若无方向性运动（云、树摇、烛光、水面微光）则 palindromic 完全可用。
4. **「AI 视频 hero 槽位 + Ken Burns 主体槽位」混合是社区教程普遍做法**（尤其"AI 点数不够时降级为 Ken Burns"的工作流），可灵官方甚至自己卖 Ken Burns 生成模板；但没有公开频道做过 A/B 数据，属 [社区经验] 而非 [已验证]。
5. **2.5D 视差（Depth Anything v2 出深度图 + ffmpeg displace）是零 API 成本的"中档升级"**，Apple 官方已发布 `coreml-depth-anything-v2-small` Core ML 模型，M4 本地跑无压力；但 ffmpeg displace 路线**没有现成的权威教程**，需自研（本报告给出完整命令骨架）。
6. **YouTube 侧最大的坑（现状管线 bug 级发现）**：**YouTube 完全忽略上传文件里封装的软字幕轨（mov_text/tx3g 也好、srt-in-mp4 也好）**。现行管线 `-c:s mov_text` 的字幕轨到 YouTube 后等于不存在，必须改走 `captions.insert` API 或 Studio 手动上传 SRT。多音轨（MLA）也只能 Studio UI 操作，**Data API 不支持**。

---

# A. 图生视频做 ambient 动态背景

## A1. 2026-08 可 API 化批量调用的图生视频服务全景

### A1.1 总对比表（价格为 2026-08-30 检索快照）

| 服务/模型 | API | 图生视频价格（1080p 档） | 最长时长 | 分辨率 | 首尾帧 | 运动幅度控制 | 生成速度 | 备注 |
|---|---|---|---|---|---|---|---|---|
| **字节 Seedance 1.0 pro**（火山方舟） | 有（异步任务） | **¥3.67/5s**（¥15/百万 token，1080p；720p ¥7.5/百万 ≈ ¥1.84/5s）[已验证] | 5/10s | 480/720/1080p | 有（2025 年上线首尾帧）[已验证] | `camera=fixed` 参数 + prompt 镜头语言 [已验证] | pro-fast 版更快且降价 72% [已验证] | 国内直付人民币；无音频 |
| **字节 Seedance 2.0**（火山方舟/BytePlus） | 有 | ¥46/百万 token ≈ **¥5/5s**（1080p）；720p Standard $0.199/s（EvoLink 快照，2026-04）[已验证] | 15s | 480/720/1080p（公开路由目前仅 480/720p）[已验证] | 支持（首尾帧+多参考） | prompt 级 | 1 条 10s 1080p ≈ ¥10 | 含音频不额外收费 |
| **字节 Seedance 2.5**（2026-07-31 发布） | 有（火山方舟） | 720p ≈ ¥1.51/s；1080p 30s 实测 ≈ ¥156（36氪）；**8.14-9.17 期间 1080p 刊例 72 折** [已验证] | **30s**（单次多镜头） | 原生 1080p（4K 传闻未上价目表） | 多模态参考（30 图+10 视频+10 音频） | prompt 级；主打"一镜成片"叙事 | 宣称接近实时 [社区经验] | 旗舰贵，做 ambient 循环是杀鸡用牛刀 |
| **快手可灵 Kling 2.5 Turbo Pro** | 有（官方 Units 计价：1 Unit=$0.14） | fal.ai **$0.07/s = $0.35/5s** [已验证]；官方 $0.098-0.14/s | 5/10s（fal 标到 ~14s） | 720/1080p | 2.5 系以首帧为主；**O1/O3 专做首尾帧** | 官方 app 有运镜控制；2.6 有 Motion Control（PiAPI $0.065-0.26/s）[已验证] | 5s 标准 2-3 min、10s 4-6 min（第三方实测）[社区经验] | 官网还有 Ken Burns 效果模板页 |
| **可灵 Kling 1.6** | 有 | $0.056/s（standard，官方 Units 0.4）≈ **$0.28/5s** [已验证] | 5/10s | 720/1080p | 首帧为主 | 社区评价"运动幅度小而稳"，适合 ambient [社区经验] | 快 | 老模型，某些聚合渠道仍在售 |
| **Google Veo 3.1 / 3.1 Fast**（Gemini API/Vertex/fal） | 有 | Standard $0.40/s（无声）/ $0.50/s（含音频）；**Fast $0.10/s 无声**（720/1080p）[已验证] | 4/6/8s（常见 8s） | 720/1080p、4K（$0.30-0.60/s） | **有 first/last frame 插值** [已验证] | prompt 级 + 官方提示词指南 | Fast 档社区反馈 1-2 min/8s [社区经验] | 画质天花板；需外币卡+代理 |
| **Runway Gen-4 / Gen-4 Turbo**（API） | 有 | Gen-4 i2v **10 credit/s + 1 credit/首帧 = $0.51/5s**；Turbo 5 credit/s ≈ $0.26/5s [已验证] | 5/10s | 720p（API 端） | API 端以首帧为主（keyframes 主要在 app） | app 有 Motion Brush/Camera Control；API 主要靠 prompt（运镜参数未见于 API 文档）[待验证] | 中等 | ProRes 输出 +5 credit/s [已验证] |
| **Pika（新 dev.pika.art API）** | 有（旧 pika.me/dev 已停用，2026 迁移） | 官方 per-second 价未在本次检索中拿到硬数字 [待验证] | — | 720/1080p | **Pikaframes 2-5 关键帧插值**（首尾帧可同图）[已验证] | 关键帧即运动约束 | 中等 | "API Club"聚合 20+ 模型 |
| **MiniMax 海螺 Hailuo 02 / 2.3** | 有 | 官方 **1080P 6s ¥3.5/条**；768P 6s ¥1.8/条；2.3-Fast ≈ $0.19-0.33/条 [已验证] | 6/10s | 512/768/1080p（2.3 到 2K） | 支持（平台概览明示"文生/图生/首尾帧/多模态参考"）[已验证] | prompt 级 | Fast 版主打快 | 老会员 ¥10788/年 争议可不管 |
| **生数 Vidu Q1/Q2/Q3** | 有 | **Q3-turbo 1080P $0.065/s（≈$0.33/5s）、540P $0.035/s**；Q1 任意 $0.40/条；Q2-turbo 540P $0.07/条；低谷时段半价 [已验证] | Q1 5s；Q3 1-16s | 360/540/720/1080p | **start-end2video（首尾帧）全系支持**（Q3-pro-fast 除外）[已验证] | prompt 级 | Q3-turbo 主打性价比 | 官方价页极透明，按秒计费 |
| **阿里通义万相 Wan 2.5/2.6/2.7**（百炼） | 有 | **wan2.6-i2v-flash 无声 1080P ¥0.25/s（=¥1.25/5s）、720P ¥0.15/s**；wan2.7 1080P ¥1/s；wan2.5-preview 480P ¥0.3/s [已验证] | 5s 默认（更长见文档） | 480/720/1080p | wan2.5/2.7 支持首尾帧生视频 [已验证] | prompt 级 + `audio=false` 直接出无声 | flash 版主打快 | 各模型有 50s 免费/90 天额度 [已验证] |

> 表内"已验证"价格来源见 A1.2 各小节。汇率按 ¥7.2/$ 粗算仅供横向比较。

### A1.2 分服务要点与来源

**① 字节即梦/Seedance（火山方舟 API）**——即梦 App 没有独立开放 API，批量调用统一走火山方舟（Ark）的 Seedance 系模型，异步创建任务+轮询。
- 官方定价页（JS 渲染，抓取需登录控制台）：[火山方舟·模型价格](https://docs.volcengine.com/docs/82379/1544106)；[视频生成任务 API](https://docs.volcengine.com/docs/82379/1520757)；[Seedance 入门教程](https://www.volcengine.com/docs/82379/1366799)（检索于 2026-08-30）。
- seedance-1.0-pro：**1080p ¥15/百万 token、720p ¥7.5/百万 token；官方口径一条 5s 1080p ≈ ¥3.67，比同类便宜 ~70%**；企业版赠 100 万 token。[已验证，媒体+官方文档交叉]（[证券时报报道](https://www.stcn.com/article/detail/197521) via 检索摘要，2025-06 发布会口径；2026-08-30 复核官方价目仍在售）
- Seedance 1.0 pro 已上线**首尾帧**能力（[开源中国](https://www.oschina.net/news/378944)）；第三方 AIML API 文档明确有 `keep the camera fixed`（固定镜头）参数（[AIML API Seedance 1.0 Pro i2v](https://docs.aimlapi.com/api-references/video-models/bytedance/seedance-1.0-pro-image-to-video)）——**做 subtle ambient 的关键开关**。
- Seedance 2.0：公开路由 480p/720p，Standard $0.199/s、Fast $0.161/s（720p），音频免费（[EvoLink 定价文](https://evolink.ai/zh/blog/seedance-2-0-pricing-api-cost-guide)，2026-04-15 发布/2026-08-07 更新）；国内侧"纯视频生成 ¥46/百万 token、视频编辑 ¥28/百万 token"（[apiyi 解析](https://help.apiyi.com/seedance-2-api-pricing-video-generation-guide.html)，2026-03-06）。
- Seedance 2.5：2026-07-31 正式发布，单次最长 **30s**、原生 1080p、原生音画+多语言对白、参考输入最多 30 图+10 视频+10 音频（[ByteDance Seed 官方博客](https://seed.bytedance.com/zh/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)，2026-07-31）；1080p 30s 实测成本 ≈ ¥156（36氪，via 检索摘要）；**2026-08-14~09-17 1080p 按刊例 72 折**（[火山方舟活动文档](https://docs.volcengine.com/docs/86680/2221498) 与 [创建任务文档](https://docs.volcengine.com/docs/82379/1520757)）。

**② 快手可灵 Kling**
- 官方开发者定价以 Units 计（1 Unit = $0.14 刊例），i2v 从 0.4 Unit/s（1.6 standard ≈ $0.056/s）到 1.0-1.2 Unit/s（旗舰档），带原生音频加价（[kling.ai/dev/pricing](https://kling.ai/dev/pricing)，检索于 2026-08-30；页面为 JS 渲染，数字经 fal.ai/PiAPI/Crazyrouter 交叉）。
- fal.ai 聚合价（可直接信用卡、webhook 回调、批量）：**Kling 2.5 Turbo Pro i2v $0.07/s、5s $0.35**（[fal Kling 2.5 Turbo Pro](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video)）。
- **首尾帧专用模型 O1/O3**：官方用户指南明示 Keyframe Interpolation（Start/End Frame）、3-10s（[Kling VIDEO O1 User Guide](https://kling.ai/quickstart/klingai-video-o1-user-guide)）；fal 上 O3 standard $0.084/s（无声）/$0.112/s（含音频）、最长 15s，O1 ≈ $0.112/s（[fal Kling O1](https://fal.ai/models/fal-ai/kling-video/o1/image-to-video)、[fal Kling O3 Pro](https://fal.ai/models/fal-ai/kling-video/o3/pro/image-to-video)）。
- 运动幅度：官方 app 内有运镜控制；2.6 系列有 Motion Control 专门控制主体/镜头运动（PiAPI 报价 $0.065-0.26/s）；社区普遍反馈 1.6 运动小而稳、2.x 更"电影感大动作"，做 ambient 要靠 prompt 压制。[社区经验]
- 生成速度：第三方实测 O1 标准 5s 约 2-3 分钟、10s 约 4-6 分钟；免费档排队可到 30 分钟+（Reddit）。API 并发上限随套餐，未见公开文档。[社区经验]

**③ Google Veo 3.1**
- 官方（Gemini API/Vertex）：Standard 720/1080p **$0.40/s（无声）/ $0.50/s（含音频）**，4K $0.40-0.60/s；**Fast 档 $0.10/s（无声）/ $0.15/s（含音频）**（[fal Veo 3.1 模型页](https://fal.ai/models/fal-ai/veo3.1) 与 [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)，检索于 2026-08-30）。
- **First & Last Frame 插值是 Veo 3.1 官方主打能力**（[Google 开发者博客](https://developers.googleblog.com/introducing-veo-3-1-and-new-creative-capabilities-in-the-gemini-api/)；[Vertex 文档](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-first-and-last-frames)；[官方提示词指南](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1)）。
- 做背景注意：Veo 档案味重、默认"电影运镜"，subtle ambient 需要强 prompt 约束（"static camera, no camera movement, only subtle ambient motion..."）。[社区经验]

**④ Runway**
- API 定价官方文档：credits $0.01/个；**Gen-4 i2v 10 credits/s + 1 credit 首帧**（= $0.51/5s），Gen-4 Turbo 5 credits/s，Gen-4.5 12 credits/s；ProRes/PNG 序列输出 +5 credits/s；80 credit 起步（[Runway API Pricing](https://docs.dev.runwayml.com/guides/pricing/)、[API Changelog](https://docs.dev.runwayml.com/api-details/api_changelog/)，检索于 2026-08-30）。
- 运动控制（Motion Brush/Camera Control）在 app 端；API 端 i2v 主要靠 prompt+seed，是否暴露运镜参数未在文档确认。[待验证]

**⑤ Pika**
- 新官方 API：`dev.pika.art`，`X-API-Key` 鉴权；**Pika 2.5 Keyframes 支持 2-5 张有序关键帧插值**（首=尾同图即闭环），1080p（[Pika 2.5 Keyframe 文档](https://dev.pika.art/models/pika/pikaframes/image-to-video)、[Quick Start](https://dev.pika.art/models/quick-start)）；旧 pika.me/dev API 已停用（[Pika-Skills GitHub](https://github.com/Pika-Labs/Pika-Skills)）。fal/WaveSpeed 仍有 Pika 2.2 Pikaframes。**per-second 价格本次未拿到官方硬数字，下单前自查。**[待验证]

**⑥ MiniMax 海螺**
- 官方按量计费：**Hailuo-02 1080P 6s ¥3.5/条**（发布时 ¥3.15/条、768P ¥1.8/条）；资源包"1080p 6s = 2 视频点数"；Hailuo 2.3/2.3-Fast 更新更便宜（$0.19-0.33/条）（[MiniMax 平台定价](https://platform.minimax.cn/docs/guides/pricing-paygo)、[视频资源包说明](https://platform.minimax.cn/docs/guides/pricing-video)，检索于 2026-08-30；PPIO/Together/302.AI 交叉）。平台概览明示支持**首尾帧**与多模态参考（[platform.minimaxi.com](https://platform.minimaxi.com/)）。

**⑦ 生数 Vidu**
- 官方价页（透明、按秒、低谷半价，credit $0.005）：**Q3-turbo 1080P $0.065/s、540P $0.035/s；Q1 全模式 $0.40/条（5s）；Q2-turbo 540P $0.07/条**；音频 +15 credits（[Vidu Pricing](https://platform.vidu.com/docs/pricing)，检索于 2026-08-30）。
- **首尾帧（start-end2video）覆盖 Q1/Q1-Classic/Q2/Q3-pro/turbo/Vidu 2.0 全系**，与 img2video 同价——**是"同图首尾帧做闭环"最便宜的正路之一**。[已验证]
- 国内（BigModel 智谱代理）：Vidu Q1 图生视频 5s/1080p ¥2.5/次（[BigModel 文档](https://docs.bigmodel.cn/cn/guide/models/video-generation/viduq1)）。

**⑧ 阿里通义万相 Wan（百炼/DashScope）**
- 官方价（华北2，仅按输出秒计费，失败不计费，各模型赠 50s/90 天）：**wan2.6-i2v-flash 无声 1080P ¥0.25/s、720P ¥0.15/s**（audio=false）；wan2.6 有声 1080P ¥1/s；wan2.7-i2v 1080P ¥1/s、720P ¥0.6/s；wan2.5-i2v-preview 480P ¥0.3/s（[阿里云百炼·模型调用价格](https://help.aliyun.com/zh/model-studio/model-pricing)，WebFetch 于 2026-08-30；[万相 i2v 旧版 API 参考（2.1-2.6）](https://help.aliyun.com/zh/model-studio/legacy-image-to-video-api-reference/)）。
- wan2.7 官方推荐，支持**首帧生视频、首尾帧生视频、视频续写**三大任务。[已验证]

### A1.3 批量工程化注意（API 形态）

- 全部主流服务均为**异步任务模型**（create task → poll / webhook），适合"低并发本地机"场景：渲染机只负责下载与合成，生成负载在云端。fal.ai/PiAPI/302.AI 等聚合层提供统一 REST + webhook + 队列，最适合 monorepo 里写一个 provider 抽象。[已验证]
- 国内直连付费（火山/阿里/MiniMax/Vidu 国内站）避免外币卡与网络问题；Google/Runway/Pika/fal 需外币卡+代理。[已验证/常识]
- **失败不计费**是普遍规则（阿里、MiniMax 明示），批量跑 180 条可放心重试。[已验证]

---

## A2. 用图生视频做 5-10s 无缝循环背景的实战技巧

### 路线 1（首选）：同图首尾帧闭环（true loop）

**原理**：把同一张场景图同时作为 first frame 和 last frame，模型被迫生成"从原图出发、最终回到原图"的运动。这正是 ambient 想要的：有生命感、无位移、天然无缝。[已验证：各模型首尾帧能力见 A1；社区通用工作流见 Reddit r/StableDiffusion 讨论](https://www.reddit.com/r/StableDiffusion/comments/1r72v4f/can_you_make_a_seamless_loop_with_the_first_and/)

- **支持矩阵（首尾帧，2026-08）**：Vidu Q1/Q2/Q3、Kling O1/O3、Seedance 1.0 pro 及以上、Wan 2.5/2.7（首尾帧生视频任务）、Veo 3.1（first/last frame）、Pika 2.5 Pikaframes（2 关键帧同图）、Hailuo（首尾帧）。[已验证]
- **注意**：首尾帧完全相同，部分模型会输出"几乎静止"或在中段做一次"去而复返"的运动——对 ambient 都是可接受结果；个别模型（Veo 3.1）对完全相同的首尾帧偶发忽略尾帧，建议首尾帧用"同图但极轻微差异（如亮度 +1%）"规避。[社区经验+推断]

### 路线 2：两段式"补环"（光流/二次生成闭环）

生成 N 秒后**抽取尾帧**，再生成一条"尾帧 → 原首帧"的桥接片段，concat 成闭环。Reddit 社区的标准工作流（I2V → 取尾帧 → 尾帧为首帧、原图为尾帧再生成一条）。成本 2 倍，效果是真无缝且运动可以"单向"（如雪持续下落但首尾帧吻合）。[社区经验]（来源同上 Reddit 帖；另有 [Melies AI loop 工具](https://melies.co/ai-video-loop) 自动做首尾帧间插值补环，佐证该需求已工具化）

### 路线 3（零成本兜底）：ffmpeg palindromic / boomerang 伪循环

正放 + 倒放拼接，**成本为零、绝对无缝**（转折点速度反号，位置连续）：

```bash
# 8s 生成段 → 16s 回环（去掉重复帧避免接点顿挫；先 trim 到 7.9s 再倒放）
ffmpeg -i bg.mp4 -filter_complex \
"[0:v]trim=0:7.9,setpts=PTS-STARTPTS[f];\
 [0:v]trim=0:7.9,setpts=PTS-STARTPTS,reverse[r];\
 [f][r]concat=n=2:v=1:a=0[out]" \
-map "[out]" -an -c:v h264_videotoolbox -b:v 8M -pix_fmt yuv420p loop_pal.mp4
```

- `reverse` 需要全帧缓存，8-10s 1080p 在 16GB M4 上没问题（约 250 帧 × 3MB ≈ <1GB）。[推断，工程常识]
- **质感差异（核心判断）**：
  - **适合**：云层漂移、树叶摇曳、烛光闪烁、水面微光、尘埃漂浮等**往复型/振荡型**运动——倒放后完全符合物理直觉，观众无感知。[社区经验：Dynaframe issue "Smooth Video Looping" 专门讨论倒放不怪的条件](https://github.com/Geektoolkit/Dynaframe3/issues/25)
  - **灾难**：**有方向性的连续粒子/流动——雪、雨、烟、瀑布、河流**：倒放段雪往上飘、烟往下沉，一眼假。**本项目落雪是独立叠加层（blend screen），只要背景层不含方向性粒子，palindromic 就安全**；雪花层本身另用循环粒子素材或 ffmpeg 合成（如 `noise` + 位移）即可做到持续向下。[推断+社区经验]
  - 光流插值（`minterpolate`）可在接点做平滑，但对"位置连续、速度反号"的 palindromic 接点基本不需要；minterpolate 极慢（软编、逐帧双向估计），8 分钟素材别用。[社区经验：minterpolate 性能](https://blog.programster.org/ffmpeg-create-smooth-videos-with-frame-interpolation)

### 路线 4：crossfade 伪循环（0 成本，通用性最好）

把成片**尾部与自身的头部做 0.5-1s 交叉溶解**，输出时长不变、任意内容都能循环（不依赖运动往复性）：

```bash
# 10s 素材 → 尾 0.8s 与头 0.8s 交叉淡化 → 10s 可无缝循环成品
ffmpeg -i bg10s.mp4 -filter_complex \
"[0:v]split=2[full][s];\
 [s]trim=0:0.8,setpts=PTS-STARTPTS[head];\
 [full][head]xfade=transition=fade:duration=0.8:offset=9.2,format=yuv420p[out]" \
-map "[out]" -an -c:v h264_videotoolbox -b:v 8M loop10.mp4
```

慢速 ambient 内容里 0.8s 的亮度渐变几乎不可见。[推断，但 xfade 语法为官方滤镜文档标准用法]

### Prompt 侧：如何要"subtle ambient motion"而不要大动作

社区沉淀出的稳定模式（来源：[pxz 30+ i2v prompts 指南](https://pxz.ai/blog/best-ai-image-to-video-prompts)、[awesome-seedance-2-prompts](https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts)、[HuggingFace Wan prompt 讨论](https://discuss.huggingface.co/t/how-to-get-the-most-out-of-prompts-for-wan-models/170354)、[Seedance 官方提示词指南（BytePlus）](https://docs.byteplus.com/zh-CN/docs/ModelArk/1631633)）：
- 锁镜头：`static camera, fixed lens, no zoom, no pan, no camera movement`（Seedance 另有 API 级 `camera=fixed`，见 A1.2①）
- 只要环境微动：`gentle breeze moves the leaves / candle flame flickers softly / smoke drifts slowly / subtle floating dust particles / very faint shimmer`
- 写"循环友好"的往复性动作（sway/flicker/drift），别写一次性动作（bird flies across）
- 负向提示（支持的模型）：`camera movement, zoom, pan, fast motion, people entering`

---

## A3. 成本估算：36 槽位 × 5 集

**口径**：一部书 5 集 × 36 槽 = **180 条**背景循环。每槽一条 5s 循环（槽内 ≤25s 重复铺）。按 A1 价格表计算（汇率 ¥7.2/$）：

| 方案 | 单价（5s/条） | 180 条总价 | 折人民币 | 验证级 |
|---|---|---|---|---|
| Wan 2.6-flash 无声 720P | ¥0.75 | **¥135** | ¥135 | [已验证] |
| Wan 2.6-flash 无声 1080P | ¥1.25 | **¥225** | ¥225 | [已验证] |
| Vidu Q3-turbo 540P（首尾帧） | $0.175 | $31.5 | ¥227 | [已验证] |
| Kling 1.6 standard 720/1080p | $0.28 | $50.4 | ¥363 | [已验证] |
| Vidu Q3-turbo 1080P（首尾帧） | $0.325 | $58.5 | ¥421 | [已验证] |
| Kling 2.5 Turbo Pro（fal） | $0.35 | $63 | ¥454 | [已验证] |
| Vidu Q1 1080p（首尾帧） | $0.40 | $72 | ¥518 | [已验证] |
| Veo 3.1 Fast 1080p 无声 | $0.50 | $90 | ¥648 | [已验证] |
| Runway Gen-4 Turbo | $0.26 | $46.8 | ¥337 | [已验证] |
| Runway Gen-4 | $0.51 | $91.8 | ¥661 | [已验证] |
| Seedance 1.0 pro 1080p（首尾帧+camera fixed） | ¥3.67 | **¥660** | ¥660 | [已验证] |
| Hailuo 02 1080P 6s | ¥3.5 | ¥630 | ¥630 | [已验证] |
| Seedance 2.0 1080p | ~¥5 | ¥900 | ¥900 | [已验证] |
| Veo 3.1 Standard 1080p | $2.00 | $360 | ¥2,592 | [已验证] |
| Seedance 2.5 1080p（72 折期） | ~¥18.7 | ~¥3,370 | ¥3,370 | [已验证]（旗舰，不推荐做 ambient） |

10s 循环按 2 倍计。**注意 Vidu 低谷时段半价、各厂促销常驻**（火山 2.5 的 72 折到 9-17、启售包 ¥196/700 万 token 等，[火山活动页](https://www.volcengine.com/activity/seedance2)），实际还能再压。

### 「AI 视频 hero 槽位 + Ken Burns 主体槽位」混合是否业界主流？

**结论：是社区教程层面的常见做法，但没有公开的频道级 A/B 数据支撑"主流"二字。**[社区经验]
- 台湾 GEM 频道《AI 影像課程｜12｜製作有聲書》明确教"**AI 视频点数不足时，降级为静态图 + Ken Burns + 语音**"的有声书工作流（[YouTube](https://www.youtube.com/watch?v=sKC9VBLMkJE)）——即天然的混合策略。
- **可灵官网自己挂了 Ken Burns 效果模板页**（[kling.ai/explore/ken_burns_effect](https://kling.ai/explore/ken_burns_effect)），说明"图 → 带运镜视频"和 Ken Burns 在产品层就是同一需求的两档。
- 不露脸频道教程生态（[VisionStory](https://www.visionstory.ai/zh-cn/solutions/video-creators/youtube-creators)、[ElevenLabs faceless channel 指南](https://elevenlabs.io/zh/blog/how-to-create-a-faceless-youtube-channel)、知乎 AI 赛道分析）普遍采用"关键镜头用 AI 视频、过渡用静态图运镜"的配比。
- **成本杠杆**：每集只给 6-8 个"hero 槽位"上 AI 视频（开头、章节转场、高潮画面），其余 28-30 槽保持 Ken Burns → 一部书 5 集只需 30-40 条 AI 生成，按 Kling 2.5 Turbo Pro 计 **$10.5-14/本（¥76-100）**，按 Vidu Q3-turbo 1080P 计 **$9.8-13/本**。视觉跃迁的边际收益最高的是 hero 槽。[推断，基于上述社区工作流]

---

## A4. 2.5D 视差低成本路线（深度图 + displace/网格变形）

### A4.1 深度图来源（2026-08 现状）

| 方案 | 状态 | 来源 |
|---|---|---|
| **Depth Anything V2** | 成熟；**Apple 官方 ML 模型页收录 `coreml-depth-anything-v2-small`（HuggingFace 可下载 Core ML 包）**，M4/M系列 Core ML 直接跑，零服务器成本 | [Apple ML models](https://developer.apple.com/machine-learning/models/)、检索于 2026-08-30 [已验证] |
| Apple 系统 API：Vision `VNDepthPredictionRequest` | 存在（Vision 框架预置深度请求），但为通用单目深度，质量低于 DA2；macOS 也可用 Core ML 自托管 DA2 替代 | [Vision 文档](https://developer.apple.com/documentation/vision) [已验证存在，质量为社区评价] |
| **Depth Anything 3**（ByteDance Seed，2025-11-14 发布） | 论文+代码+模型全开源，DINOv3 backbone，单模型统一单图/多视图深度+位姿，几何质量大幅超越 V2；**无官方 Core ML/移动端部署**（GitHub issue #63 讨论中），需 Python/torch（M4 MPS 可跑，batch 出图慢于 DA2-small CoreML） | [GitHub bytedance-seed/depth-anything-3](https://github.com/bytedance-seed/depth-anything-3)、[项目页](https://depth-anything-3.github.io) [已验证] |
| 在线/ComfyUI | Depth Anything V2 有 ComfyUI 节点与 web demo，社区大量用于 2.5D | [社区经验] |

**建议**：静态场景图批量出深度图用 **DA2-small Core ML（本地、秒级/张）**；对深度质量敏感的 hero 图用 DA3（Python 批处理）。[推断]

### A4.2 ffmpeg `displace` 做 3D 感缓动（自研路线，无现成权威教程）

**现状**：ffmpeg `displace` 滤镜（3 输入：主图 + X 位移图 + Y 位移图）是官方文档明确的能力（[ffmpeg-filters 文档](https://ffmpeg.org/ffmpeg-filters.html)、[displace 滤镜文档](https://ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Video/displace.html)），社区已有用 ffmpeg+DepthAnything2 做视差立体的完整先例（[Medium: 2D-to-3D Stereo using DepthAnything2 and Parallax](https://medium.com/@peterplv/part1-2d-to-3d-stereo-video-conversion-using-depthanything2-and-parallax-starwars4-as-example-bc6eba4793cf)：ffmpeg 拆帧 → DA2 出深度 → 按 (原图, 深度图) 生成偏移视图）；但"**ffmpeg displace + 时间动画深度视差**"没有单一权威教程，需按下列骨架自研。[已验证(滤镜能力)/推断(工程组装)]

```bash
# scene.png: 2560x1440 场景图；depth.png: 同尺寸灰度深度图（白=近 黑=远）
# 位移量 ∝ 深度 × 缓动函数(sin 单周期 → 天然回环无缝)，模拟镜头微平移
ffmpeg -loop 1 -t 10 -framerate 25 -i scene.png \
       -loop 1 -t 10 -framerate 25 -i depth.png \
 -filter_complex "\
[1:v]format=gray,geq=lum='128 + 10*sin(2*PI*T/10) * (lum(X,Y)-128)/127',format=gbrp[xmap];\
color=c=gray:s=2560x1440:r=25:d=10,format=gbrp[ymap];\
[0:v]format=gbrp[base];\
[base][xmap][ymap]displace=edge=smear,format=yuv420p[out]" \
 -map "[out]" -r 25 -t 10 -c:v h264_videotoolbox -b:v 8M parallax10s.mp4
```

工程要点（均 [推断]，基于滤镜语义与已知坑）：
- **`displace` 输出像素 (x,y) 取自输入 (x + mapx−128, y + mapy−128)**（8-bit 时以 128 为零位移）；把深度直接编码进 X 位移图并随 T 摆动即得视差。
- **必须 `gbrp`**：yuv420p 下 displace 的色度平面是半分辨率，会出色彩错位（[Stack Overflow 实证](https://stackoverflow.com/questions/43818912/why-are-cb-and-cr-planes-displaced-differently-from-lum-by-the-displace-complex) [已验证]）。与现有管线雪花层 `gbrp` 往返的经验一致。
- **边缘拉扯**：displace 是像素搬移不做 inpainting，大位移会在边缘露洞 → `edge=smear` + 先把原图超采样放大 5-10% 再 displace 最后裁回（和 zoompan 抗抖动的 supersample 同理）。
- sin(T/周期) 驱动 = **天然无缝循环**（起点终点速度可为零：用 `(1-cos)/2` ease-in-out 包络更佳）。
- 每 (图, 运动参数桶) 可缓存复用，与槽位缓存架构天然契合。
- 效果证据链：AE 生态同款做法（深度图 + Displacement Map + 2.5D 摄像机）是成熟教程题材（[Pond5 教程合集](https://blog.pond5.com/3570-after-effects-video-tutorials-adding-3d-depth-to-2d-pictures/)、[YouTube: AI depth map animate still](https://www.youtube.com/watch?v=-Cd3w5md4bU)），ffmpeg 版只是把 AE 渲染换成 CLI。[社区经验]

**2.5D vs I2V 的定位**：2.5D 零 API 成本、确定性 100%、无内容漂移（人物/物件绝不变形走样），但只有"镜头动"，画面内部是死的（水不流、烛不闪）；I2V 有"内容活"但带生成风险。**最优组合：2.5D 做全部 36 槽的底座运动（替代 zoompan，直接解决 wobble 与 12fps 卡顿），hero 槽再上 I2V 或 I2V+2.5D 叠加。**[推断]

---

# B. YouTube 投递与包装

## B5. 编码与「有声书/故事类」高留存包装

### B5.1 官方推荐 vs 实际接受（2026-08）

**官方推荐（[YouTube 推荐上传编码设置](https://support.google.com/youtube/answer/1722171?hl=en)，WebFetch 于 2026-08-30）[已验证]**：
- 容器 MP4、无 Edit Lists、faststart（moov 前置）
- **视频编码器：H.264（High Profile、2 B 帧、closed GOP=帧率一半、CABAC、4:2:0、VBR）**
- 音频：**AAC-LC 或 Opus 或 Eclipsa Audio**，48kHz，立体声推荐 384 kbps（单声道 128k）
- SDR 1080p 推荐 **8 Mbps**（24/25/30fps）、12 Mbps（48/50/60）；4K 35-45 Mbps；色彩空间 BT.709
- 帧率：24/25/30/48/50/60 为"常见"，其他也接受

**实际接受情况**：
- HEVC、AV1、ProRes/DNxHD 等母带格式**都能上传**（[videomaker](https://www.videomaker.com/article/c05/17034-encoding-youtube-videos-at-the-highest-quality/)、[mixcord](https://www.mixcord.co/blogs/content-creators/best-video-format-for-youtube)）[已验证]；YouTube 服务端一律重新转码分发（VP9/AV1/H.264 多档），上传母带画质收益只在"转码源质量"。
- 2026 年社区 VMAF 实测共识：有 AV1 硬编则 **AV1 ~60 Mbps 10-bit 最优**，否则 **HEVC ~60 Mbps 次优**，H.264 高码率稳妥（[Reddit r/videography 2026 VMAF 帖](https://www.reddit.com/r/videography/comments/1qawuxi/2026_update_best_upload_settings_for_youtube_vmaf/)、[Zeb Gardner 博客镜像](https://www.zebgardner.com/photo-and-video-editing/2026-update-best-upload-settings-for-youtube)）[社区经验]。
- **对本项目的判断**：内容以缓慢运动+静态为主，纹理简单，**1080p H.264 12-20 Mbps（或 HEVC 8-12 Mbps）已远超官方 8 Mbps 推荐，画质不会是瓶颈**；ProRes 母带对 15 分钟 1080p 内容纯属浪费带宽（文件 ~100GB 级）。[推断]
- **12fps 问题**：官方"常见帧率"不含 12fps（能传但转码/播放兼容性无承诺）；建议成片 **24fps**（帧复制即可，码率几乎不涨）或直接以 24fps 渲染。[推断，基于官方帧率清单]

### B5.2 有声书/故事类频道的包装共识（2025-2026）

| 维度 | 共识 | 依据与级别 |
|---|---|---|
| 冷开场 | 前 30 秒决定留存：直接进故事最强钩子段落，不做"频道 intro/求订阅"开场；48h/7d 看留存曲线找掉坑位 | [社区经验]（[2026 YouTube 算法分析](https://johnisaacson.co.uk/how-youtube-algorithm-works-2026/)、[IMPACT 结构法](https://www.impactplus.com/learn/youtube-marketing)） |
| 章节标记 | **对长篇有声书是刚需**（听众"听到哪了"回访）；首章必须 0:00、≥3 章、每章 ≥10s；章名用情节钩子而非"Part 1" | [已验证规则+社区经验]（YouTube 章节规则；[Humble&Brag 章节指南](https://humbleandbrag.com/blog/youtube-chapters)） |
| 节奏 | 背景画面 **20-30s 一换**重新抓注意力；睡眠/助眠类反向操作（画面几乎不动、极缓）；有声书正片介于两者之间：换镜不换戏 | [社区经验+推断]（[留存基准 2026](https://humbleandbrag.com/blog/youtube-audience-retention-benchmarks)） |
| 字幕：软 vs 烧录 | **双轨制**：烧录字幕利于静音自动播放场景（[Rev](https://www.rev.com/blog/benefits-of-burn-in-captions)），但会永久污染画面且压缩失真（[MD-Subs 技术文](https://www.md-subs.com/blog/burned-in-subtitles-journey-to-quality)）；**YouTube 软字幕可由观众开关、样式可调、可被翻译/检索**——长内容（15min 听书）社区主流是**软字幕为主，短内容/竖版才烧录**。中文频道常见折中：烧"关键词/诗句"大字，全量台词走软字幕 | [社区经验] |
| 关键工程事实 | **上传文件里封装的字幕轨（含 mov_text）YouTube 一律忽略**（"YouTube ignores muxed subtitle tracks entirely"），软字幕必须 Studio/captions API 单独上传 SRT/VTT | **[已验证]**（[VexaScribe 2026 指南](https://vexascribe.com) via 检索；YouTube 官方帮助只记载"文件上传字幕"这一途径；Reddit r/videography 实操帖）——**直接推翻现行管线 `-c:s mov_text` 的有效性** |

### B6. YouTube 多音轨 / 多字幕（chi）上传支持现状（2026-08）

**多音轨（Multi-Language Audio, MLA）**：
- **已对所有创作者开放**（从 MrBeast 内测扩展到"millions of creators"，单频道多语言、一套视频多个音轨）（[YouTube 官方帮助 answer/13338784](https://support.google.com/youtube/answer/13338784?hl=en)、[YouTube 官方博客](https://blog.youtube/news-and-events/multi-language-audio/)、[Slator](https://slator.com/youtube-allows-creators-add-own-multi-language-audio-tracks/)）[已验证]
- 操作路径：YouTube Studio → 内容 → 语言 → 添加语言 → 上传对应音频轨；**MLA 不自动配音**（自动 AI 配音是另一个独立功能）。[已验证]
- **关键限制：YouTube Data API 不支持多音轨管理**——没有对应 endpoint，Issue Tracker 需求仍开放；自动化投递只能 Studio UI 手动（或 UI 自动化，风险自担）。[已验证]（检索于 2026-08-30，Reddit/Fermata 讨论+官方 API 文档缺失交叉）

**多字幕**：
- **Data API `captions.insert` 支持逐语言上传多条字幕轨**（每语言一条，可多次调用），完全可编程——这是 monorepo 自动投递字幕的正路。[已验证]（[YouTube Data API captions 文档](https://developers.google.com/youtube/v3/docs/captions)）
- 语言代码：中文用 **`zh-Hans`（简体）/ `zh-Hant`（繁体）**；裸 `zh` 无效（[Stack Overflow](https://stackoverflow.com/questions/58278697/)）。MP4 里的 `chi`（ISO 639-2/B）只是容器轨道标签，YouTube 不读。`zh-CN` 是旧式区域码，`zh-Hans` 为现行 BCP-47 写法。[已验证]
- 注意：`videos.update` 的 `defaultAudioLanguage`/`defaultLanguage` 也要设成 `zh-Hans`，否则自动字幕/自动配音的语言推断会错。[社区经验]

**对本项目的落地建议**：MP4 里继续带 mov_text 轨无害（本地播放器可用），但**必须**把同一 SRT 用 `captions.insert(lang=zh-Hans)` 上传；多语言扩张（英配/粤配）时音频轨上传是无法 API 化的人工步骤，管线设计要把"上传后的 Studio 收尾"做成 checklist。[推断，基于上述已验证限制]

---

# 最终建议（结合本管线）

1. **升级分三档走**，不要一步全 AI：
   - **第 1 档（本周可做，零 API 成本）**：全部槽位 Ken Burns → **2.5D displace 视差**（DA2-small Core ML 本地出深度图 + A4.2 命令），24fps、sin 缓动天然循环，直接消灭 zoompan wobble 与 12fps 卡顿。
   - **第 2 档**：每集 6-8 个 hero 槽位上 I2V（首选 **Vidu Q3-turbo start-end2video**（$0.33/条 1080p，同图首尾帧）或 **Kling 2.5 Turbo Pro via fal**（$0.35/5s）；要极致压成本用 **Wan 2.6-flash 无声**（¥1.25/条 1080p）），prompt 按 A2 模板锁镜头。
   - **第 3 档**：确有效果数据后全量 36 槽 AI 化（¥135-660/本的量级，随时可停）。
2. **循环策略**：I2V 段优先"同图首尾帧"真循环；不理想时 palindromic 兜底（前提：该槽无方向性粒子）；雪花层保持独立、循环粒子素材持续向下。
3. **投递侧立刻修**：软字幕改 `captions.insert(zh-Hans)` 上传 SRT；成片 24fps、H.264 ≥12M 或 HEVC；章节标记 0:00 起；冷开场。

## 风险与不确定项

- **价格漂移**：AI 视频价格月更（Seedance 2.0 三个月内多次调价、Vidu 低谷半价、火山 72 折限时），表中数字有效期按"周"计。[已验证的事实是"变动频繁"本身]
- Runway API 运镜参数、Pika per-second 官方价格：[待验证]。
- 各家 API 并发/限速上限未见公开文档（Kling 按套餐），批量 180 条需实测排队。[待验证]
- 首尾帧同图在部分模型上"近静止"或被忽略：[社区经验/推断]，需小样本 A/B（每家跑 5 条再定供应商）。
- ffmpeg displace 视差路线无权威教程背书，命令骨架需在真实素材上验证边缘 artifacts 与 geq 性能。[推断]
- YouTube 自动 AI 配音与 MLA 的交互（是否会覆盖自传音轨）未在本轮验证。[待验证]

---

## 附：本次调研主要来源索引（检索日期均为 2026-08-30）

**定价/能力（官方）**：火山方舟模型价格 docs.volcengine.com/docs/82379/1544106 · Seedance 任务 API 1520757 · Seedance 2.5 发布（seed.bytedance.com，2026-07-31）· Kling dev/pricing（kling.ai）· Kling O1 指南（kling.ai/quickstart/klingai-video-o1-user-guide）· Runway API Pricing（docs.dev.runwayml.com/guides/pricing）· MiniMax 平台定价（platform.minimax.cn/docs/guides/pricing-paygo）· Vidu Pricing（platform.vidu.com/docs/pricing）· 阿里云百炼模型价格（help.aliyun.com/zh/model-studio/model-pricing）· Gemini API pricing（ai.google.dev）
**定价/能力（第三方快照）**：fal.ai（veo3.1、kling 2.5 turbo pro、kling o1/o3 模型页）· EvoLink Seedance 2.0 定价（2026-04-15/08-07）· apiyi（2026-03-06）· AIML API Seedance 文档 · PiAPI/Crazyrouter · Together AI
**循环/运镜**：Reddit r/StableDiffusion 首尾帧循环帖 · ffmpeg boomerang（superuser/bannerbear/ffmpeg-micro）· minterpolate 文档 · pxz / awesome-seedance-2-prompts / HuggingFace Wan 讨论 / BytePlus 提示词指南
**2.5D**：Apple ML models 页（coreml-depth-anything-v2-small）· GitHub bytedance-seed/depth-anything-3（2025-11-14）· ffmpeg displace 文档 + SO 色度错位帖 · Medium peterplv DA2+parallax
**YouTube**：support.google.com/youtube/answer/1722171（编码推荐，2026-08-30 抓取）· answer/13338784（MLA）· Data API captions 文档 · Reddit 2026 VMAF 实测 · Zeb Gardner · Rev/MD-Subs（烧录字幕）· Humble&Brag（章节/留存）· VexaScribe（封装字幕被忽略）
