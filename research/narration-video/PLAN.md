# 解说视频管线（narration-video）开发计划 v2 · 定稿

日期：2026-09-16；状态：**已通过三路外部 AI 评审并合并意见**（工程/产品/内容，见 `reviews/`；v1 被 v2 取代）
上游：`packages/audiobook`（有声书）、`packages/digest`（精简短篇）；本目录另含 `spike/`（技术探针实证）

## 0. 一句话

novel-eval 新增与有声书并列的「解说视频」衍生线：小说 → **三层架构解说脚本**（幕-序列-拍）→ 火山豆包多轨配音 → Seedream 参考图配图（物证/环境优先）→ beat 精确时长渲染 → 横版长解说 mp4 + 3 条 Shorts + 封面物料，Web 一键触发。

## 1. 评审采纳记录（v1 → v2 变更）

| 评审方 | 关键意见 | v2 处置 |
|---|---|---|
| 工程(cursor) P0 | video.ts `planSlots` 是 25s 槽位量化，beat 对齐必翻车 | ✅ 新写 beat 真实时长切片渲染器，不用 planSlots |
| 工程 P0 | 跨包 import 违反 ESM exports | ✅ audiobook `package.json` 增加显式 subpath exports（`./tts`、`./srt`、`./ffmpeg`），零代码搬迁零回归；media-kit 抽层降为 M3+ 可选重构 |
| 工程 P0 | beat 结构残缺（无 id/角色绑定/句粒度） | ✅ DTO 升级三层：Script→Sequence→Beat→Sentence（15–30 字句级，字幕与缓存的最小单元） |
| 工程 P0 | 参考图 API 未验证/缓存级联失效/定妆照状态 | ✅ **M0 已实测**（spike/：`image:[url]` 数组 200 OK，7 项特征一致）；缓存键含参考图 SHA-256；角色册加 `approved` 状态门 |
| 工程 P0 | Web 串行锁是路由内局部变量，跨管线并压主机 | ✅ 渲染阶段全局互斥（`server/lib` 全局锁 + jobId 唯一 args 文件） |
| 工程 P1 | BGM 侧链避让已有现成实现但方案漏了 | ✅ S4 采用 `mixBgmWithSidechainDucking`（悬疑氛围 BGM 预设） |
| 工程 P1 | 事实 probe 全文硬比会误报 | ✅ probe 对比「Phase 0 章节事实表」，豁免叙事顺序重排 |
| 工程 P1 | 生图串行太长+缺图即崩 | ✅ 2 路微并发+指数退避；缺图 fallback（沿用上一帧/定妆照）不中断 |
| 产品(cursor) P0 | 纯干音单轨 30 分钟=催眠，完播必崩 | ✅ 多轨音频：解说主轨+证物引语轨（老年女声+录音机/电话 EQ）+turn/peak 处 SFX 音效钩+BGM 侧链 |
| 产品 P0 | 「每10-15秒一个转折」是伪需求 | ✅ 节奏模型改为：三幕宏观 / **4–5 个解谜闭环**（每 4–6 分钟解开一疑点引出更深疑点）/ 15–20 秒**视听刺激重置**（切景/音效/道具特写，非剧情硬转） |
| 产品 P0 | Shorts 放 M4 = 冷启动自杀 | ✅ Shorts 切条（3×50s）进 M2 核心交付 |
| 产品 P0 | 封面与前 3 秒履约缺位 | ✅ 封面生成进 S7；冷开场=In Media Res（物证特写+高潮倒叙前置 10 秒） |
| 产品 P1 | 视觉核心是证据链不是人脸 | ✅ 生图策略改为**物证/环境/背影/手部特写优先**；角色一致性保留为能力（用户需求+已实测），仅关键情感帧出正脸 |
| 产品 P1 | 悬疑进度锚点 | ✅ 序列级「疑点 n/N」进度条（drawtext，零成本） |
| 内容(cursor) P0 | 孤立 map 必砍暗线伏笔（冰箱茶杯例） | ✅ **Phase 0 全书物证-反转图谱**先行，注入 map prompt「严禁删除物证锚点」 |
| 内容 P0 | 扁平 60+ beat 注意力塌陷 | ✅ 三层生成：幕→7 序列（每序列 1000–1200 字，独立生成调用）→序列内 beat |
| 内容 P0 | 字数均摊压扁高潮 | ✅ 张力预算制：高潮序列（家宴）留 800–1000 字，日常序列收紧；禁机械均摊 |
| 内容 P0 | 因果倒置毁立意（弟弟被误写同谋） | ✅ S3 因果三元组稽核 + 人物复杂度锁（prompt 硬约束） |
| 内容 P1 | 声画对位（画面禁图解文字） | ✅ beat 生成 prompt 强制 text/scenePrompt 分工契约 |
| 内容 清单 | 9 条 prompt 规范（物证落差冷开场/负向词库/物证锚定/人物锁/句长节奏律/声画契约/因果锚/余音结尾/反诈落版） | ✅ 全部落入 S2/S3 prompt 与质量门（见 §3 附表） |
| 内容 P2 | 引语打 voice 标签 | ✅ 文案层 `<quote voice="elderly_warm">…</quote>`，S4 换轨合成 |

## 2. 定稿架构

```
writer.db 章节 ─► S1 切片
   └► S2 文案四阶段（shared：LLM 工厂）
        P0 全书物证-反转图谱（clue-graph）
        P1 带物证锁的逐章 map（事实表+爆点权重）
        P2 序列规划（7 序列×张力预算×三幕分配）
        P3 序列内 beat 生成（口播句+scenePrompt+kind+<quote>标签）
   └► S3 双门：结构门（程序化）+ 因果稽核门（LLM 三元组）
   ┌► S4 多轨音频（audiobook/tts exports：解说主轨+引语轨+EQ+SFX+BGM 侧链，句级指纹缓存）
   └► S5 配图（角色定妆照册[approved 门]→Seedream 参考图；物证/环境优先；2 路并发+fallback）
   └► S6 渲染（新 beat-时长切片器：每 beat 真实 durationMs；1440p24；进度锚点 drawtext；SRT 句级）
   └► S7 物料（封面/标题/营销化章节/上传包含 AI 披露/registry/多维成本台账/3×Shorts 切条）
```

### 数据契约（`packages/shared/src/dto/narration.ts` 新建）

```ts
NarrationScript { bookId, targetMinutes, characters: CharacterRef[], acts, sequences }
Act { id, name }                                    // 三幕（悬念建构/破局博弈/情感清算）
Sequence { id, actId, title, 疑点标签, tensionBudgetChars, beats[] }
Beat { id, kind: 'hook'|'turn'|'peak'|'close'|'coda',
       sentences: [{ id, text(15-30字), quote?: {voice, eq} }],
       visual: { prompt, characterIds[], shot: 'prop'|'env'|'back'|'hands'|'face' },
       sfxHint?: 'stinger'|'heartbeat'|'tick'|'none' }
Sentence.durationMs / Beat.startMs —— S4 后回填，S6 的唯一时钟源
CharacterRef { id, name, sheetFile?, status: 'draft'|'approved', promptDesc }
```

### 工程落位（定稿）

- 新包 `packages/narration`；依赖 `audiobook`（**通过新增显式 subpath exports**：`./tts`、`./srt`、`./ffmpeg`、`./audio`，零搬迁）、`shared`、`writer`。M3 后视分化情况再议 media-kit 抽层。
- Web：`routes/narration.ts` + `pages/BookNarration.tsx`；**渲染阶段全局互斥锁**（与 audiobook 路由共享 `server/lib/render-lock.ts`）；job args 文件带 jobId 原子消费。
- registry：`data/narration/registry.json`（DerivativeKind 增 `'narration_video'`）；成本台账多维 schema：`{ llmTokens, ttsChars, images, cost: {llm,tts,image} }`。

## 3. S2/S3 Prompt 规范表（内容评审 9 条，全部硬约束进 prompt/门）

1. 冷开场=物证落差法：首句【精确事实数据】+【反常物理动作】；禁悬念反问/「你敢相信吗」。
2. 负向词库硬禁（门判 FAILED 即重试）：注意看/不得不说/细思极恐/屏幕前的/大快人心/然而事情并没有那么简单/殊不知/这为后来埋下伏笔。
3. 物证锚定：每个关键反转必须挂至少一件可视觉化实物道具；禁「她感到疑惑」类抽象情绪词。
4. 人物复杂度锁：林超=被诱骗的棋子非弑母者；王艳=市侩非同伙；周慧兰=疲惫的设防母亲非复仇爽文女主；口吻克制禁煽动网暴。
5. 句长节奏律：推演段 15–25 字/句多逗号；高潮序列切 8–14 字短句高频句号。
6. 声画分工契约：text=事件/潜台词/时间压力；scenePrompt=16:9 电影质感物证/氛围特写，**严禁图解文字**；shot 标注 prop/env/back/hands/face（face≤10% 帧）。
7. 因果锚（S3 稽核）：主体→动作→受体 三元组抽取比对（如「孙小雅→换药→周慧兰」不得归因林超；「周慧兰→假意入局→留证」不得写成被骗）。
8. 余音结尾：最后 40 秒定格物理画面（黑板菜谱「先关火，再放糖」），禁道德升华。
9. 反诈落版：片尾独立 120 字【刑侦与法律备忘】公文体播报（正片情绪落幕后）。

节奏模型（产品评审定稿）：三幕（0–8 悬念建构 / 8–22 破局博弈 / 22–30 情感清算）；4–5 个解谜闭环；15–20 秒视听重置（切景/SFX/道具变焦/字幕重音，由 beat kind+sfxHint 驱动）；序列级进度锚点「疑点 n/N」。

## 4. M0 探针结论（已完成，2026-09-16）

- Seedream 5.0-lite 参考图：plan 端点 `POST /api/plan/v3/images/generations`，`image: [url]` 数组形态 **HTTP 200**；定妆照→场景图 7 项特征一致（年龄/发色/盘发/玉簪/枣红外套/写实风/身份），连「蝴蝶牌缝纫机」场景细节都对。证据：`spike/01-sheet.jpg`、`spike/02-ref-array-url.jpg`、`spike-seedream-ref.mjs`。
- TTS：`tts/volcengine.ts` 已实测（`req_params.speaker`+seed-tts-2.0+plan 端点+降级链）。
- 待 M1 内验证：30 秒微原型（beat 时长切片音画对齐 <0.5s）。

## 5. 里程碑（定稿；验收状态 2026-09-16 更新）

- **M0 ✅ 技术探针**：Seedream 参考图 `image:[url]` 实测 200 OK，定妆照→场景 7 项特征一致（spike/）。
- **M1 ✅ 文案+音频闭环**（《物业管家不想破案》10 章 12 分钟版实测）：
  - 四阶段生成 17 次 LLM 调用 → 5 序列 45 拍；结构门绿（3632 字/45 拍/peak 9/正脸 0%/最长无转折 41s）；因果门抓到 1 处真实张冠李戴（b027 录音原话 vs 推演结论）修复后绿；
  - >42 字长句以确定性切句器兜底（prompt 修复→后处理）；语速校准 **3.8 字/秒**；
  - TTS 163 句**缺段 0**，15.9 分钟音轨+句级 SRT；微原型对齐 **28ms**（门槛 500ms）。
- **M2 ✅ 成片+Shorts+封面**：
  - 定妆照 7 张（approved 门实测拦截过未批准批次）；分镜 45/45 全成、fallback 0（2 路并发+12s 节流+级联指纹缓存）；
  - 全片 narration-video.mp4 **931s、漂移 31ms**（beat 精确切片，非槽位）；字幕烧录（PingFang）+进度锚点「疑点 n/N」视觉验收通过；SFX 程序化音效钩（adelay 拍点对位）；BGM 侧链混音待放 bgm.mp3 即启用；
  - Shorts 3×50s 竖屏（锚点 b001/b003/b013）+ 封面 thumbnail.jpg。
  - 已知打磨项（→M3+）：进度锚点字号/对比度；Seedream「AI生成」水印（试 watermark:false 参数）；BGM 素材接入。
- **M3 ✅ Web 自助**（《物业管家不想破案》线上验收 2026-09-16）：
  - 全局渲染锁 `render-lock.ts` 单例跨路由共享（有声书+解说+场景图重跑三入口全收口）；**跨路由 409 实证**：解说渲染中有声书构建被拒并提示任务类型；锁语义单测（双占拒/非持锁释放无效/正常释放复占）；
  - `/api/narration/*`：建线（registry data/narration/registry.json）、五动作任务（jobId 唯一参数文件+白名单 spawn）、定妆照批准、发布检查单（11 项持久化）、多维成本台账（CLI 各阶段写 usage.json → 路由按 ffprobe/用量落账，¥ 口径 llm 0.1/次·tts 2/万字·图 0.15/张）；
  - 解说 tab 五步向导（文案→配音→定妆→分镜→成片，状态全由产物派生）+ 任务台 + 成品页（播放器/Shorts 卡/复制即用的标题简介标签/检查单/成本带）；无头 DOM 断言：5 步全渲染、8 定妆照、4 视频、检查单齐全；
  - 发布物料含悬疑时间轴（timed 脚本序列锚点 0:00/2:46/6:09/9:00/12:43 自动进简介）+ Day3/Day4-6 Shorts 计划；
  - **顺手修复既有 bug**：`/media` 静态服务 dev/prod 两态恒 404（Hono serveStatic 不剥挂载前缀）——`rewriteRequestPath` 剥前缀 + vite 代理补 `/media`；此前 DOM 断言验收从未加载真实字节故未暴露。字节级验证：定妆照 200/291KB、正片与 Shorts 206 Range、路径穿越变体无泄露；
  - 全仓 typecheck 0 错、单测 354/354。
- **M3.1 代码评审轮（2026-09-16，agy + cursor-agent 双路）**：报告在 reviews/m3-code-review-{agy,cursor}.md。结论「方案正确但带伤不可上线」→ **当日全部 P0/P1 修完并线上复验**：
  - P0：cancel 只杀不放锁（放锁只在 close，杜绝取消→立刻重跑的双 ffmpeg 窗口，实测 cancel 后立即重拉得 409）；先占锁后 spawn（含 audiobook startJob 与 scene-regen 重排「校验→占锁→删图/spawn」）；前端五步卡 running 态优先（重跑已完成步骤不再恒显「已完成」）。
  - P1：checklist 合并写（单键 PUT 不再抹掉其他勾选，narration+audiobook 同修）；前端弃轮询改复用 JobConsole（SSE，basePath 参数化），load 解绑 job、切书复位；TTS/定妆按**本跑实耗**记账（mtime 快照计合成字数、生图只计真实生成）；因果门那次 LLM 计入用量、门禁失败（退出码 2）也落账；outRoot maxLen 64→128/96（长书名不再建线后全任务 422）。
  - **锁粒度拆分**（agy P1/cursor P2 分歧，取 agy 方向最小实现）：解说线内自串行（一次一个任务），**仅 render 占全局渲染锁**——纯 LLM/TTS/生图不再锁死有声书；实测 render 运行中 audiobook build 409、narration audio 409（线内）、cancel 后 409（窗口）、close 后 201。
  - 散件：ffprobe 2s 超时（半成品 mp4 不再可能卡死单线程服务）、scanOutRoot 半成品 JSON 防空、shorts 数字序、approve 非数组 422、CLI 与 Web slugify 统一、regen 补 error 监听、registry 原子写、空角色表不再卡死分镜门。
  - 分歧裁决记录：**job-runner 抽取暂缓**（agy 建议抽、cursor 建议锁协议稳一版再抽——取 cursor）。
- **M3.2 遗留项收口（2026-09-16 同日）**：
  - **孤儿进程清理**：pipeline-spawn/scene-regen 改 `detached` 独立进程组 + `child-registry.ts` 登记；server SIGINT/SIGTERM 先按组 SIGTERM→宽限→SIGKILL 整树（pnpm→tsx→ffmpeg），再关库退出。**线上实测**：渲染中 SIGINT 杀服务，四层进程树（pnpm/tsx/node/ffmpeg）全灭零残留，日志「清理 1 个管线子进程」；单测 2 条（组杀含孙进程+幂等）。
  - **jobs Map LRU**：两路由已结束任务保留上限 60（插入序淘汰，运行中/持锁任务永不淘汰）；durCache 同步加 200 条上限。
  - 修后全仓 typecheck 0 错、单测 **356/356**；成品重渲恢复（930667ms 原样）。
  - 残余已知项（低危，留观）：killTrackedChildren 宽限 1.5s 内强杀可能截断输出文件（渲染层有缓存段兜底，重跑即恢复）；job-runner 抽取仍暂缓。
- M4+：media-kit 抽层、2.5D 视差、关键词花字动效、批量排期、A/B 音色。

## 6. 发布策略（产品评审定稿，进 M3 物料）

解说立骨拉新、有声书立肉承接：Day0 有声书全量 playlist 悄悄上线 → Day3 25–30 分钟解说发布（主打推理主线，情感核弹段留白点睛，85% 处口播导流有声书 EP + 置顶评论/End Screen 挂 playlist）→ Day4–7 三条 Shorts（数药诡计/棉线封条/57 分钟死亡线）挂长解说相关链接。

## 7. 风险登记（残余）

- 序列规划 LLM 输出不稳 → Schema 校验+三重重试（callWithValidation）+ cassette 测试样本。
- 多轨 EQ/SFX 滤镜链复杂 → 先 30 秒微原型锁定滤镜参数，再全量。
- 生图配额与违禁词报错 → 样品先行、2 路并发+退避、缺图 fallback；违禁词在 scenePrompt 层加白名单改写重试一次。
- 红线：解说词继承原著内容红线；YouTube 物料带 AI 披露；冒烟 --out 必须隔离目录（历史事故）。
