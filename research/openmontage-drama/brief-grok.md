# 研究任务：OpenMontage 深度研究 → 衍生 AI 短剧功能可行性（grok 专属任务书，agy 地域限制挂掉的备援）

你的输出文件（唯一归属）：`/Users/reed_soul/code/novel-eval/research/openmontage-drama/agent-grok.md`
除该文件外不得写/改仓库任何其他文件。

## 背景

我们的项目 novel-eval（工作目录 /Users/reed_soul/code/novel-eval，pnpm monorepo，TypeScript）已打通"小说→有声书视频"全管线：
- packages/writer：AI 小说创作（平台化产出、蓝本/章节/校对）
- packages/audiobook：有声书视频管线（edge-tts + 火山/豆包 TTS 多角色配音、场景图、字幕烧录、ffmpeg 渲染、YouTube 发布物料）
- packages/eval：文本质量门/审计；packages/web：工作台

**痛点：有声书视频技术上全通，但 YouTube 上几乎没人看。** 观察是用户懒得"听书"，更喜欢短剧形式（竖屏、快节奏、人物对话、连续剧钩子）。正在评估：把管线衍生为 AI 短剧（每集 60-120 秒竖屏 9:16，多镜头、角色对话、剧情连续）。

已克隆候选底座：https://github.com/calesthio/OpenMontage → 本地 /Users/reed_soul/code/novel-eval/research/OpenMontage（AGPL-3.0，agent 编排式视频生产平台：YAML pipeline manifest + Markdown stage-director skills + 57 个 Python 工具 + Kling/Veo/Runway 等视频生成供应商 + Remotion/HyperFrames/FFmpeg 三合成运行时）。

## 研究问题（逐一回答，引用证据）

1. **深读 OpenMontage 源码**（研究重点，逐目录看）：
   - 架构（agent-first：无 Python 编排器，LLM agent 是控制平面）对我们的适配度——我们本来就重度使用 coding agent，这是否是最适合我们的底座形态？
   - 与短剧直接相关的能力实测评估：`tools/video/` 的 Kling（注意 kling_official_video 的 Elements 特性——角色一致性参考）、lip_sync/avatar 工具（tools/avatar/）、竖屏 media_profiles（lib/media_profiles.py）、CJK 字幕（最近合并的 PR）、character-animation 管线、cinematic/hybrid 管线
   - 哪些能直接用、哪些要新建（比如一个新的 short-drama pipeline manifest + stage skills）
2. **License 约束**：AGPL-3.0 对我们三种用法的边界——(a) 内部使用产视频发自己频道；(b) 借架构思想自己重写；(c) 在 novel-eval（私有仓库）里直接引入其代码。逐一判定风险。
3. **联网调研 2026-09 当下的 AI 短剧生态**（必须当天查证，标注来源 URL 和日期，拒绝训练记忆里的过时结论）：
   - 国内外 AI 短剧生产工具/竞品现状（如即梦、可灵、SkyReels、ReelKeeper 类产品、YouTube Shorts 上的 AI 短剧频道实例）
   - 成本模型：Kling/Veo/即梦/海螺 等生成 1 分钟竖屏短剧视频（含多镜头、角色一致性、口型）大约多少钱？一季 30 集的成本量级？
   - 分发与收益：YouTube Shorts 短剧 vs 抖音/红果短剧平台的分成/流量逻辑，AI 生成内容的平台政策（YouTube 对 AI 短剧的变现资格）
4. **结合我们现状给衍生方案**：哪些现有资产可复用（writer 的小说/剧本能力、多角色 TTS、质量门）、OpenMontage 借鉴什么 vs 直接跑什么 vs 自建什么；给出最小可行路径（MVP：一部剧 × 3 集样片）和大致工作量/成本估算。
5. **明确结论**：Go / No-Go / 有条件 Go，附依据。

## 输出要求

- Markdown，中文，写到你的输出文件
- 关键论断附证据（OpenMontage 文件路径:行号 / 联网来源 URL+日期）
- 成本和生态数据必须来自当天联网查证
- 结论先行，细节在后；给出可执行的下一步
