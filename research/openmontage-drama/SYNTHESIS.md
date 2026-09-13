# OpenMontage 深度研究 → AI 短剧衍生可行性合成报告

> 合成日期：2026-09-13
> 研究来源：本地深读（我）+ cursor-agent 报告（agent-cursor.md，33KB）+ 两路联网调研（YouTube 生态 / 国内分发）
> 派单备注：agy 因 Gemini API 地域限制挂掉（FAILED_PRECONDITION: User location is not supported）；grok 撞免费额度墙半途而死无产出。多路覆盖由 cursor-agent + 我 + 两个内部子代理补齐。
> 仓库位置：research/OpenMontage（AGPL-3.0，克隆于 2026-09-13）

---

## 一、总结论：【有条件 Go】——方向对，底座选型分两步走

**"做短剧"这个方向判断成立**：有声书视频没人看的根因不是内容，是形态——静态图+慢推镜头+旁白，正中 YouTube 2025-07 "inauthentic content" 政策清洗靶心（2025-11 起已真删 16+ 头部 AI 频道，[The Verge](https://www.theverge.com/news/869684/youtube-top-ai-channels-removed-kapwing)）。短剧（多镜头、人物、对话、钩子）是 2026 年被验证的形态：AI 真人剧条均播放 41,956 vs AI 漫剧 5,815（差 7 倍），80 集《霍去病》成本约 3000 元、Shorts 播放破 5 亿。

**但收益模型必须纠正一个直觉**：YouTube Shorts RPM 只有 $0.03-0.10，短剧频道 92-93% 的发布量其实是横屏——**主流打法是"竖屏 Shorts 引流 + 横屏合辑变现"**（中文长视频 RPM 是 Shorts 的 20 倍+）。国内侧红果/抖音/快手有真金白银（抖音漫剧 S+ 保底 5000 元/分钟、快手 2026 投 8 亿分账、B站觉醒计划最高 80% 分成），但代价是备案制（2026-04 起未备案 AI 漫剧全网下架）+ AI 强制标注 + 爆款率仅 0.5% 的供给过剩市场。

---

## 二、OpenMontage 深读结论

### 2.1 它是什么

Agent 编排的视频生产平台：**无 Python 编排器，coding agent（我/cursor）就是控制平面**。管线状态机 `research → proposal → script → scene_plan → assets → edit → compose → publish` 由 YAML manifest 声明，每个阶段有 Markdown "stage director" skill 注入导演级知识，57+ Python 工具只管干活，checkpoint JSON 持久化，CostTracker 管预算（estimate → reserve → reconcile）。

**对我们的适配度：极高。** 这个项目就是设计成"由我们的 coding agent 驱动"的——README 甚至有专门给 agent 的操作指引。用户重度 agent 工作流 + 已有小说/TTS/质量门资产，是它的理想宿主。

### 2.2 短剧相关能力盘点（实测源码确认）

| 能力 | 位置 | 状态 | 短剧价值 |
|---|---|---|---|
| Kling 官方视频生成 | `tools/video/kling_official_video.py` | 可用 | 支持 `element_list` 传入 element_id 锁角色形象（`tools/_kling/elements.py` 封装 `/v1/general/advanced-custom-elements`），跨镜头人物一致性 |
| Kling 唇形同步 | `tools/avatar/kling_lip_sync.py` | 可用 | `identify_face`/`face_choose`/`advanced_lip_sync`，双人对话镜头贴台词 |
| Kling 数字人 | `tools/avatar/kling_avatar.py` | 可用 | 定妆照+音频驱动说话 |
| 即梦视频 | `tools/video/jimeng_video.py` | 可用 | **火山引擎直连——我们已有账号**；720P 0.28 元/秒全场最低价 |
| Seedance 2.0/2.5 | `tools/video/seedance_{video,ark,replicate}.py` | 可用 | 字节系，多图参考+原生音画+台词引号引导唇形；ARK_KEY 走火山（同账号） |
| 豆包 TTS | `tools/audio/doubao_tts.py` | 可用 | 与我们实测 schema 经验对口（连"新版 console API key 流程"都写好了） |
| 竖屏 profile | `lib/media_profiles.py` | 可用 | youtube_shorts/reels/tiktok 1080x1920。⚠️ Shorts 上限硬编码 60s 已过时，现支持 3 分钟 |
| CJK 字幕 | Remotion `CaptionOverlay.tsx`（PR #507，2026-08 合并） | 可用 | 中文按句换行词级高亮字幕，决定静音刷剧完播率 |
| auto_reframe | `tools/video/auto_reframe.py` | 可用 | 16:9→9:16 人脸跟踪重构（横竖双发的桥梁） |
| 本地 SadTalker/Wav2Lip | `tools/avatar/{talking_head,lip_sync}.py` | **弃用** | 画质达不到 2026 商业短剧及格线，直接走云端 |

### 2.3 缺口（衍生的真实工作量）

1. **没有短剧管线**：最接近的 `cinematic` 是预告片/情绪蒙太奇定位。需新建 `short-drama.yaml` + 8 个 stage director skills（照它的"新建管线配方"文档做，是配置文件不是代码）。
2. **script artifact 是旁白形状**：`schemas/artifacts/script.schema.json` = 时间轴段落+配音表演指令，不是"角色/台词/分镜"形状。需扩展 dialogue+shot 结构。
3. **无连续剧概念**：没有角色资产库跨集持久化、没有 cliffhanger/钩子的叙事约束。这些要写进 stage skills 和 artifact schema。

### 2.4 AGPL-3.0 边界（三种用法判定）

- **(a) 内部跑它产视频发频道：零风险。** MP4 是数据产出物不是派生作品，AGPL 不管产出。
- **(b) 借架构思想用 TS 洁净重写：零风险。** 思想-表达二分法，架构模式/YAML 字段语义不受版权保护。
- **(c) 把它的 Python 源码拷进 novel-eval：禁止。** `packages/web` 是网络服务，触发 AGPL 第 13 条远程网络交互条款——访问者依法可索取整个工程源码（含 writer 核心算法）。且会造成 TS/Python 双栈裂化。

---

## 三、成本模型（2026-09-13 当天查证，多源交叉）

**API 单价**（官方牌价）：
- 即梦 3.0 720P：0.28 元/秒（[火山官方](https://www.volcengine.com/docs/85621/1544715)，秒数包 250 秒 70 元）
- Seedance 2.0：约 1 元/秒 1080P（[IT之家](https://www.ithome.com/0/925/937.htm)）；Mini 版约 0.5 元/秒
- Kling 官方：$0.24-0.28/秒（[kling.ai/dev/pricing](https://kling.ai/dev/pricing)）；第三方托管（Atlas）约 $0.07-0.11/秒
- 豆包 TTS：每千字 0.015-0.03 元，忽略不计

**单集 60-90 秒账**（16-18 镜头 × 3-4 秒，含 1.8-3 倍废片重抽）：
- 纯 API：**¥60-200/集**（即梦路线）～ **$9-13/集**（Kling 托管路线）
- 算力 + 组装全成本：行业口径约 ¥1000/分钟、单集 ¥2000-3000（[钛媒体](https://www.tmtpost.com/7999440.html)）——**我们的自动化优势正是把这块压到 API 成本线附近**
- MVP（一部剧 × 3 集样片）：**≤ ¥1000**，走火山即梦/Seedance + 既有豆包 TTS，不新增账号
- 一季 30 集：约 ¥2,000-6,000（即梦路线）——这是 MVP 验证后的决策点再花的钱

---

## 四、衍生方案：两步走（对 cursor 报告的修正）

cursor-agent 建议"一步到位 TS 洁净重写 packages/drama（3 周）"。**修正为两步走**——先验证需求再投入工程，符合"先样品再批量"的质量门铁律：

### 第一步（约 1 周，零工程投入）：黑盒驱动 OpenMontage 产 3 集样片

OpenMontage 就是设计成由 agent 驱动的，**不需要改它一行 Python**：
1. `make setup` 装好克隆副本，配 ARK_API_KEY/即梦 key（火山账号已有）
2. 在克隆副本里写 `pipeline_defs/short-drama.yaml` + stage director skills（YAML/MD 配置，非代码——含黄金 3 秒钩子/30 秒反转/结尾悬念约束、角色 element_id 注册与复用、废片重抽上限）
3. 从 writer 现有悬疑小说选一部，改写成 3 集 × 60-90 秒分镜剧本
4. 跑管线出 EP01-03 样片，验收：角色跨镜头一致性、唇形、CJK 字幕、钩子节奏
5. 发布渠道实验：竖屏 Shorts + 横屏合辑双轨；国内走红果/抖音需先过备案决策

### 第二步（样片数据说话后）：TS 化 packages/drama

只有当 3 集样片 + 首发 8-12 集数据证明形态成立，才启动洁净重写：
- 借 OpenMontage 的 manifest+skills+checkpoint+cost-governance 架构，不拷一行代码
- 复用：writer（剧本改编/ContextCompiler）、audiobook（annotate 说话人归属、多角色 TTS、youtube 发布物料）、eval（短剧质量门：钩子结构/节奏/连贯性审计）
- 新建四大件（cursor 报告 §5.3 的定义可直接用）：ShortDramaScriptCompiler / CharacterAssetRegistry（Kling Elements 封装）/ ShotPromptBuilder / short-drama 管线

### 风险与红线

- **YouTube**：上传必勾 AI 披露标签（官方明确不影响流量变现）；绝不模板量产（2025-11 起真封号）；机械感配音是英语区差评首因
- **国内**：备案制（未备案=下架）、AI 强制标注、悬疑题材走"奇幻探案"而非凶杀灵异（参考《兴安岭诡事》过审路径）；红果 AI 保底 2026-08 已大幅缩水，别把保底当商业模式
- **排期冲突**：product 2.0 M0（8-12 天）仍在等开工令，短剧是新赛道——两条线的优先级需要用户拍板，本报告只给建议不动工

---

## 五、附：原始研究材料

- cursor-agent 全量报告：`research/openmontage-drama/agent-cursor.md`（含 AGPL 判定细节、成本表、TS 化蓝图、三周排期——其"Youkraine 2026-07 政策"日期有误，实为 2025-07-15，已在本报告修正）
- YouTube 生态调研：见本报告 §一/§四，来源含 jollytoday 两份行业报告、The Verge、Tubefilter、YouTube 官方 blog/support
- 国内分发调研：红果/抖音/快手/视频号/B站/番茄六渠道政策与分账，来源含国家广电总局、网信办、21 经济、钛媒体
- OpenMontage 本地克隆：`research/OpenMontage`（可 `make setup` 直接试跑）
