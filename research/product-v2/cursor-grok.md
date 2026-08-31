# NovelEval Web 2.0 产品会诊：从「功能平铺」到「IP 衍生创作台」

> 作者：Cursor Grok（资深产品架构顾问）  
> 性质：只读调研 + 可拍板方案（不改业务代码）  
> 仓库：`/Users/reed_soul/code/novel-eval`  
> 对标日期：2026-08-30

---

## 0. 一句话判决

**现状不是缺功能，是缺产品对象。**  
顶部五个平级入口（项目 / 评估 / 有声书 / 审计 / 设置）把同一本小说撕成五条互不认亲的工具链；有声书页把 `dist/audiobook-v3` 这种**构建缓存目录**当成用户心智里的「制作版本」——这是工程视角泄漏，不是产品视角。

**2.0 拍板定位：个人作者的 IP 衍生创作台。**  
一本书是宇宙中心；小说正文是母本；有声书 / 精简短篇 / 剧本 / 漫剧 / 短剧是挂在这本书下的**衍生作品（Work）**。评估、审计不是导航一级公民，是母本或作品上的**质量门禁动作**。

不做「影视行业全平台」幻觉。你是一个人 + 一套本地管线。对标的是 **ElevenLabs Projects + 喜马拉雅音剪的「书→集」心智**，再借 **StudioBinder 的阶段命名**，不是剪映时间线编辑器，更不是 YouTube 创作者中心。

---

## 1. 现状尸检（事实，带路径）

### 1.1 导航：工具平铺，没有「书」这个容器

`packages/web/src/components/Layout.tsx` 顶部平铺：

| 入口 | 路由 | 产品对象 |
|------|------|----------|
| 项目列表 | `/` | writer.db 的 novel project |
| 模型配置 | `/settings` | 引擎凭据 |
| 质量评估 | `/eval` | 独立 task 文件 |
| 有声书 | `/audiobook` | `dist/audiobook*` 目录 |
| 逻辑审计 | `/audit` | 独立 task 文件 |

五条线共享的唯一「项目」概念停在写作侧。有声书、评估、审计都是旁路。

路由表见 `packages/web/src/main.tsx`：写作深度路由（`/projects/:id/...`）完整；有声书只有 `/audiobook` 与 `/audiobook/:run/:ep`——**run 是目录名，不是书**。

### 1.2 「制作版本 v3/v4」到底是什么

`packages/web/server/routes/audiobook.ts`：

```
扫描 dist/ 下 /^audiobook/ 的目录
id = 目录名（audiobook-v4）
label = 去掉 audiobook- 前缀 → 「v4」
```

UI（`packages/web/src/pages/Audiobook.tsx`）原文：

> 《书名》· 制作版本 **v4** · N 集  
> 药丸切换器在 `runs.length > 1` 时露出

**判决：v3/v4 不是产品版本，是你某次改管线时换了输出根目录。**  
CLI 默认 `--out dist/audiobook`，帮助文档举例 `dist/audiobook-v4`。管线代码里**没有** `if (v4)` 分支。把目录名暴露成「制作版本」等于让用户管理你的 `dist/`——这是把运维面板当成产品。

用户说「v3 是旧流程应该废弃」——正确。UI 里它们不该作为一等公民出现；最多作为调试里的「产物根路径」。

### 1.3 构建表单：七个工程师旋钮，零个作者动作

`BuildForm`（同文件）字段：

| UI | 默认/形态 | 本质 |
|----|-----------|------|
| 项目 | 硬编码 `'最后一班森铁'` | 字符串碰 writer.db，不是项目选择器 |
| 章节 | 文本 `1` / `1-15` | 应自动接「下一未做章节」 |
| 并章/集 | 1–5 | 作品级预设，不是每次构建问 |
| 引擎 | edge / volcengine | 作品级预设 |
| 试产字数 | 可选 | 调试用，默认隐藏 |
| 起始集号 | 文本 | 应从已有集数 +1 推断 |
| 场景图 coverRun | 选另一个 run 的 scenes | 跨目录借图——再次证明 run≠产品对象 |
| 跳过视频 | checkbox | 专家项 |

触发方式：点幽灵卡片或打开表单。**没有「构建下一集」主 CTA。** 用户说「不懂怎么触发」——因为主路径不存在，只有参数墙。

审听条更糟：`fix` / `srt` 勾选了但**没传给** `startJob`（状态有、请求无）。这是「看起来能用、实际半残」的品质杀手。

### 1.4 数据孤岛

```
writer.db project ──export TXT──► eval（可选 projectId → revision_task）
writer.db project ──export TXT──► audit（只有 title，无 projectId）
audiobook CLI ──只读──► writer.db chapters
audiobook jobs ──内存 Map──► 与 writer job 无关
产物 ──文件系统──► dist/audiobook*
```

没有：Book → AudiobookWork 外键；没有 Episode 表；没有 Asset 索引。多书 = 项目列表平铺 + 有声书页假定你记得当前在做哪本。

### 1.5 UI 栈

`packages/web/package.json`：React + react-router + Hono。**无** shadcn / Radix / Ant / MUI / Tailwind。  
样式：`packages/web/src/styles.css` ~1900 行手写 + 原生 `<select>` / `<input>` / checkbox。有声书有一层 `.ab-*` 皮肤，但仍是原生控件。用户说「简陋、无品质感」——属实，不是审美吹毛求疵。

### 1.6 用户痛点 → 根因映射

| # | 用户原话 | 根因（不是表象） |
|---|----------|------------------|
| 1 | 原生表单简陋 | 无设计系统；控件与信息层级同级 |
| 2 | 缺产品思维，难猜用法 | 导航按「包名」切，不按「作者任务」切 |
| 3 | v3/v4 看不懂 | 工程产物目录泄漏为产品概念 |
| 4 | 该有项目概念；多书多集找不到 | 有声书脱离 Project；无 Book 壳 |
| 5 | 不会触发构建 | 无「下一集」意图路径，只有 CLI 表单壳 |
| 6 | 影视衍生愿景 | 缺 Work 层；所有衍生都是平行工具 |

**不要先美化 CSS。美化无法治 IA。**

---

## 2. Q1 信息架构（拍板）

### 2.1 核心对象模型

采用五层，命名刻意避开工程词（run / dist / vN）：

```
Workspace（本机创作台，一人一份）
 └── Book / IP（一本小说宇宙）          ← 用户心智：「我在做《最后一班森铁》」
      ├── Canon（母本）                  ← 大纲 / 章 / 修订 / 故事状态
      │     └── Chapter Unit
      ├── Quality Gates（动作，非导航）  ← 评估 / 审计 / 章级质检
      └── Work（衍生作品）               ← 「这本书的有声书 / 短剧 / …」
            └── Episode / Cut Unit       ← 集 / 短篇切片 / 剧本集
                  └── Job（制作任务）    ← build / listen / render
                        └── Asset（产物）← mp3/mp4/srt/封面/台本/上传包
```

#### 每一层用户心智（必须能一句话说清）

| 层 | 用户怎么想 | 系统职责 | 禁止泄漏 |
|----|------------|----------|----------|
| **Book** | 「我的这本书」 | 身份、封面、类型、进度、衍生入口 | DB 路径、多 db 文件名 |
| **Canon** | 「故事写到哪了」 | Bible → Outline → Chapter → Revision | job lease、migration 号 |
| **Quality Gate** | 「这本书过不过关」 | 跑评估/审计，结果回流修订任务 | taskId 文件目录 |
| **Work** | 「这本书的有声书这条线」 | 形态、预设（引擎/并章/音色）、集清单 | `dist/audiobook-v4` |
| **Unit** | 「第 3 集好不好」 | 播放、台本、场景、审听、导出 | ep01 文件夹名（可显示为 EP03） |
| **Job** | 「正在生成 / 审听」 | 进度、日志、取消 | spawn 参数数组（高级可展开） |
| **Asset** | 「成品在哪、能不能发」 | 文件角色（成片/字幕/上传 JSON） | 绝对路径 |

### 2.2 推荐 IA 树（2.0 导航）

```
/                           → 我的书（Book 卡片墙）
/books/:bookId              → 书工作台（默认落在「写作」Tab）
  ├─ /writing               → Canon：Bible / 大纲 / 章网格 / 导出
  ├─ /quality               → 评估报告 + 审计报告 + 修订收件箱（合并现 eval/audit）
  ├─ /works                 → 衍生作品列表（有声书、未来剧本…）
  └─ /works/:workId         → 某条衍生线工作台
        ├─ /                → 集卡片墙 +「制作下一集」主 CTA
        ├─ /episodes/:ep    → 集详情（播放/台本/审听/物料）
        └─ /settings        → 作品预设（引擎、并章、音色、视频开关）

/settings                   → 全局模型与引擎（保留）
/jobs                       → 可选：全局任务抽屉（现 ActiveJobsBanner 升级）
```

**顶部导航砍成三格：**

```
[ 我的书 ]   [ 全局任务 ]   [ 设置 ]
```

评估、审计、有声书**全部降级为书内能力**。  
现路由 `/eval`、`/audit`、`/audiobook` 做 301 式重定向到最近使用的书或书选择器——过渡期可留，但新 UI 不再把它们当一级。

### 2.3 为什么不是「Project → Work」直接沿用现名

现有 `project`（writer.db）语义 = **写作工程**。  
用户说的「项目」混了两件事：书，和衍生制作线。  
2.0 对外文案用 **「书」**；对内可继续叫 `project` 行，加 `works` 表或等价目录约定。  
**对外绝不出现 projectId / runId / v4。**

### 2.4 Work 类型枚举（愿景落位，但分期实现）

| WorkType | 用户话 | M0 | M1 | M2+ |
|----------|--------|----|----|-----|
| `audiobook` | 有声书 / 视频有声书 | ✅ | 打磨 | — |
| `digest` | 精简短篇 | — | 占位 | 生成 |
| `screenplay` | 剧本分发 | — | — | 大纲→场次 |
| `comic_drama` | 漫剧 | — | — | 分镜资产 |
| `ai_short` | AI 短剧 | — | — | 与视频管线合流 |

M0 只做 `audiobook`，但 **Works 列表 UI 要先把壳搭好**（灰掉的卡片 +「即将推出」），否则永远长不成「衍生台」，只会再平铺一个工具。

### 2.5 ASCII 总览

```
┌─────────────────────────────────────────────────────────────┐
│  NovelEval 创作台                    [任务●]  [设置]         │
├─────────────────────────────────────────────────────────────┤
│  我的书                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│  │《森铁》  │  │《幽居》  │  │  + 新书  │                    │
│  │写作 82% │  │写作 12% │  │          │                    │
│  │有声 5集 │  │无衍生   │  │          │                    │
│  └──────────┘  └──────────┘  └──────────┘                    │
└─────────────────────────────────────────────────────────────┘
                         │ 点开《森铁》
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  《最后一班森铁》   [写作] [质量] [衍生作品]                   │
├─────────────────────────────────────────────────────────────┤
│  衍生作品                                                     │
│  ┌─────────────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ 🎧 有声书（视频）    │  │ 📄 精简短篇 │  │ 🎬 短剧     │ │
│  │ 5/15 集 · QA 良好   │  │ 即将推出    │  │ 即将推出    │ │
│  └─────────────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │ 点开有声书
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  《森铁》· 有声书          [作品设置]                         │
│  ┌──────────────────────────────────────────────┐           │
│  │  ▶ 制作下一集（第 6 集 · 第 16–18 章）        │ ← 唯一主 CTA │
│  └──────────────────────────────────────────────┘           │
│  EP01 ✓  EP02 ✓  EP03 ⚠  EP04 ✓  EP05 ✓  [+空位]           │
│  ───────────────────────────────────────────────             │
│  ▸ 高级：试产字数 / 强制集号 / 跳过视频 / CLI 日志            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Q2 有声书模块重构（拍板）

### 3.1 消灭「制作版本」——内部化策略

**原则：用户只看见「这本书的有声书作品」+「集」；永远不看见 v3/v4。**

#### 存储映射（无需一次改完管线）

```
产品：Book《森铁》 → Work audiobook-primary
工程：data/audiobook/projects/最后一班森铁.json   （音色配置，已有）
工程：dist/books/{bookSlug}/audiobook/           （新约定产物根）
      或过渡期：选定一个「权威 run」，其余 archive
```

**M0 过渡（最小改动、立刻可感知）：**

1. API `GET /runs` 对前端改为按 `bookTitle` 聚合，不返回多 pill。  
2. 每个 Book 只暴露一个 **Active Work Root**（取最新有完整 ep 的目录，或显式配置）。  
3. `dist/audiobook-v3` 若仅含 scenes：把 scenes **逻辑挂到** Active Work（你们路由里已有「跨 run 借 scenes」注释——把它变成默认合并，而不是让用户选 coverRun）。  
4. 旧目录进「归档」：设置页或 `~/.` 开发者模式才可见「产物根路径」。  
5. UI 文案：**删除「制作版本」四字**；标题改为 `《书名》· 有声书`。

**M1 清理：**  
统一 `--out dist/books/{slug}/audiobook`；废弃多根扫描；CLI 仍可接受任意 `--out`（给自己用），Web 永不列目录名。

### 3.2 多书多集导航

```
入口 A（主）：我的书 → 某书 → 衍生作品 → 有声书 → 集墙
入口 B（深链）：全局任务横幅点「有声书 EP03 完成」→ 直达该集
入口 C（禁止）：顶部独立「有声书」进 orphan 总览（可留只读「全部有声书」聚合页，但必须带书名分组）

集墙排序：EP 升序；缺件/QA 红点；搜索框过滤标题（书多到 10 本后才需要，M0 可省略）
```

**找书靠书墙，找集靠书内集墙。** 一百个 item 平铺是现在 audiobook 顶层把「所有 run 的所有集」当宇宙——2.0 禁止跨书平铺集。

### 3.3 「构建下一集」——正确触发位置与交互

#### 错误现状

表单里塞 project / chapters / group / engine / chars / epStart / coverRun / noVideo —— **把 Job 参数当成了产品交互。**

#### 正确心智

作者意图只有一句话：

> 「按我设好的规矩，把下一集做出来。」

#### 交互规格（拍板）

**位置：** Work 工作台顶部，固定主 CTA，不在折叠表单里。

**默认计算（系统做，人确认）：**

```
group     ← Work.settings.chaptersPerEpisode（默认 3）
engine    ← Work.settings.ttsEngine
nextEp    ← max(existingEp)+1
nextCh    ← lastConsumedChapter+1 … +group
project   ← Book.title / id（从路由注入，禁止手填）
cover     ← Work 内 scenes/；无则自动生成或提示「先出场景图」
out       ← Work.root（隐式）
```

**主路径点击后：**

```
┌────────────────────────────────────────────┐
│ 制作第 6 集                                 │
│ 将使用第 16–18 章 · 引擎 Volcengine · 含视频 │
│                                            │
│ [ 开始制作 ]          [ 改范围… ]            │
└────────────────────────────────────────────┘
```

「改范围」展开二级：章节范围、是否试产（chars）、是否跳过视频。  
**group / engine / 音色** 去「作品设置」，不在每次构建问。

**幽灵空卡片：** 保留，但文案改成「制作下一集」，点击 = 同上 CTA，不是打开七字段表单。

**试产：** 仅在「高级」或按住 Alt 点 CTA 时出现「试产 600 字」——这是开发者自己的需求，别污染主路径。

### 3.4 审听交互一并修

- 集详情页主按钮：「审听本集」  
- 集墙批量：「审听未检集」  
- `fix` / `srt` 必须真正进 API；默认关，高级开  
- Whisper model / CER：作品设置默认值，不在每次条上露

### 3.5 与现有代码复用点

| 保留 | 改壳 |
|------|------|
| `packages/audiobook` CLI build/listen/attribute | Web 参数组装层 |
| `routes/audiobook.ts` job 白名单 + SSE | runs 聚合 API、按 book 过滤 |
| `AudiobookEpisode.tsx` 四 Tab（图库/台本/审听/上传） | 路由挂到 `/books/:id/works/...` |
| `data/audiobook/projects/*.json` | 升级为 Work.settings 的真相源 |
| JobConsole | 视觉升级；命令行默认折叠 |

---

## 4. Q3 创作流重组（Journey）

映射影视流水线，但**压缩成一人本地台**能消化的阶段名。

### 4.1 阶段映射

| 影视 | 本产品阶段 | 用户动作 | 系统减少参数的方式 |
|------|------------|----------|-------------------|
| Development | 立意开书 | 新书：题/类型/受众/premise | 三模式保留（全自动/Bible/空壳），但文案改人话 |
| Pre-production | 规划 | 批 Bible、批大纲 | PlanningApproval 已有——留在书内「写作」 |
| Production | 写作生产 | 生成章、改写、读章 | 字数/门槛进书级写作预设 |
| Coverage | 质量门禁 | 跑评估、跑审计 | 一书一键；结果进修订收件箱 |
| Production (派生) | 衍生制作 | 建 Work、做集 | 预设驱动「下一集」 |
| Post | 审听/修订 | 听、修 TTS、重出 | 问题段一键重生成（CLI listen --fix） |
| Distribution | 分发 | 下上传包、拷元数据 | 上传物料 Tab 已有雏形 |

### 4.2 端到端旅程（Happy Path）

```
[1] 我的书 →「新书」
     页面：/books/new（现 NewProject）
     点：选「全自动」或「生成 Bible」
     系统：不暴露 generate flag 技术名

[2] 书工作台 · 写作
     批 Bible → 批大纲 →「写第 1–N 章」
     系统：章数/字数用书级预设；高级才改门槛

[3] 书工作台 · 质量
     「全书评估」→ 看雷达 →「导入修订任务」
     「逻辑审计」→ P0 列表 →（未来）链回章
     系统：自动 export TXT，用户不选文件

[4] 书工作台 · 衍生作品 →「创建有声书」
     向导 3 步：
       a. 形态：纯音频 / 视频有声书
       b. 并章（1/2/3 章一集）+ TTS 引擎（带推荐）
       c. 确认角色音色（读 projects/*.json 或引导 attribute）
     系统：创建 Work + 写 settings；不出现 --out

[5] 有声书工作台
     点「制作下一集」→ 确认条 → Job 抽屉直播
     系统：自动章节与集号

[6] 集详情
     听 → 看审听报告 → 坏段修复 → 下 MP4/SRT/上传 JSON
     系统：分发checklist（标题/封面/字幕）打勾即可

[7] 循环 [5][6] 直到章耗尽
     空态：「正文尚未写到第 X 章——回写作台」深链
```

### 4.3 参数暴露策略（渐进披露三级）

```
L0 意图层（默认可见）
   - 制作下一集 / 审听本集 / 全书评估
L1 作品预设（设置页，改一次管一路）
   - 引擎、并章、是否视频、默认 CER、旁白音色
L2 专家/调试（折叠「高级」或 ?debug=1）
   - chars 试产、强制 ep-start、cover-dir、原始 CLI、多产物根
```

**规则：任何需要用户读 CLI help 才能懂的字段，禁止出现在 L0。**

### 4.4 Journey ASCII

```
立意 ──► 规划 ──► 写作 ──► 质检 ──► 衍生 ──► 制作集 ──► 审听 ──► 分发
 │        │        │        │        │        │         │        │
新书    Bible    章网格   评估/审计  建Work   下一集CTA  集详情   上传包
        大纲     修订收件  回流写作   预设     Job抽屉   修坏段
```

断点（现状）：质检与衍生不在书内；制作集参数墙；分发物料只读尚可。

---

## 5. Q4 对标研究（模式抽取 + 来源）

### 5.1 对照总表

| 产品 | IA 核心 | 参数收集 | 多项目 | 对本产品启示 |
|------|---------|----------|--------|--------------|
| 剪映 / CapCut | **草稿/时间线** 为原子；材料池与轨道分离 | 模板开箱 + 时间线直接改；专家在效果面板 | 草稿列表；一草稿一成片 | 学「材料 vs 时间线」解耦；**不学**把创作台做成剪辑器——你不是后期工具 |
| Descript | **Project = 活页夹，Composition = 页** | 文本即时间线；少表单 | 一大制作一个 Project；多 Composition 做版本/切片 | **强对齐**：Book≈Project，Work/Episode≈Composition |
| ElevenLabs Studio / Projects | 文稿→章/节；音色全局+段落覆盖 | 建项向导 + 模板卡；Override 才进专家参数 | Project 管长文；Studio 管多轨短制作 | **有声书主对标**：章结构、锁段、批量改音色 |
| 喜马拉雅「音剪」 | 创作类型入口（有声小说/文章转语音…） | 上传文本→拆章→认角→配音；一键生成 | 以作品/书为容器 | **中文用户心智最近**：书→拆章→多角色→成片 |
| YouTube Studio | 渠道内容库；上传后运营 | 上传向导；分析事后 | 频道级多视频 | 只对标**分发与元数据**，不对标创作 |
| StudioBinder | Write→Breakdown→Visualize→Plan→Shoot | 阶段工具箱；模板单据 | 一制片项目管全流程 | **借阶段命名与「剧本中心」**；不做片场 call sheet |

### 5.2 分产品要点与 URL

#### 剪映 / CapCut

- 模式：Draft 目录 + `draft_content.json`（tracks + materials）——项目=一条时间线成片。  
- 参数：用户几乎不填「引擎表单」，而是拖素材；模板解决冷启动。  
- 来源：  
  - https://www.capcut.com/  
  - Draft schema 概述（第三方梳理）：https://unpkg.com/capcut-cli@0.19.1/docs/draft-schema/00-overview.md  

**启示：** 你们的「场景图 / 台本 / 音轨」已接近 materials；缺的是 **Work 容器**，不是时间线编辑器。别做小剪映。

#### Descript

- 模式：Project 装所有素材；Composition 是可编辑成品页；多 Composition = 版本或短切片。  
- 明确建议：大制作分开 Project；同材料多版本用 Composition。  
- 来源：https://help.descript.com/hc/en-us/articles/13535123897485-Projects-and-compositions-overview  

**启示：** 一书一个 Book；一书下多 Work；一 Work 下多 Episode。版本用「重新制作第 N 集」或内部 generation id，**不要**用 v3/v4 顶层切换。

#### ElevenLabs Studio / Projects

- 模式：长文用 Projects（章/节）；Studio 偏多轨与模板向导（Get started 卡片）。  
- 参数：默认音色 + 段落 Override；Lock 满意段；全局 Replace voice。  
- 来源：  
  - https://elevenlabs.io/docs/eleven-creative/products/studio  
  - 音色段落设置：https://help.elevenlabs.io/hc/en-us/articles/23370957112721-How-can-I-change-the-voice-and-settings-across-multiple-paragraphs-in-Studio  
  - 有声书向导评述：https://aiproductivity.ai/guides/elevenlabs-projects-audiobook-guide/  

**启示：** 「作品设置 = 默认音色/引擎」；「台本段上改角色」已有雏形（attribute）；建 Work 用向导，不要七字段平铺。

#### 喜马拉雅音剪

- 模式：先选创作类型 → 有声小说上传 → 智能拆章 / 角色识别 / AI 音色 → 生成与后期。  
- 参数：类型选择消化复杂度；细节在生成后调。  
- 来源：https://audioeditor.ximalaya.com/  

**启示：** 中文作者要的是「上传/选定小说 → 出有声」，不是「配置 --group --ep-start」。你们已有正文在 DB，比音剪更应「零上传」。

#### YouTube Studio

- 模式：内容库 + 上传向导 + 分析；不负责剧本写作。  
- 来源：https://studio.youtube.com/ （产品本身）；职责边界参见行业综述对「native publishing layer」的描述。  

**启示：** `youtube-upload.json` + 上传物料 Tab 应对齐「发布清单」，不是创作 IA 中心。

#### StudioBinder

- 模式：Write / Breakdown / Visualize / Plan / Shoot 五段；一切挂在 Production Project。  
- 来源：https://www.studiobinder.com/  
  - 评述：https://contentcreators.com/tools/studiobinder-review  

**启示：** 用阶段组织书工作台 Tab（写作 / 质量 / 衍生），**不要**上 call sheet / 片场通讯——那是团队制片软件，你是个人作者。

### 5.3 竞品模式 → 本产品硬规则

1. **容器优先于工具**（Descript / 音剪 / StudioBinder）  
2. **模板/预设优先于专家表单**（ElevenLabs / 音剪）  
3. **版本是 Composition/Generation，不是顶层 pill**（反 v3/v4）  
4. **分发层后置**（YouTube Studio）  
5. **不做时间线编辑器**（反剪映崇拜）

---

## 6. Q5 2.0 路线图（可执行分期）

定位锚点：**个人作者的 IP 衍生创作台**——先让「一书多形态」在有声书上成立，再扩形态。

### M0 — 修 IA + 有声书可用性（2–3 周体感）

**用户价值：** 打开产品就知道「我在哪本书」；有声书能「一键做下一集」，再也看不到 v3/v4。

| 交付 | 复用 |
|------|------|
| 顶栏改为「我的书 / 任务 / 设置」 | `Layout.tsx` |
| 书工作台三 Tab：写作 / 质量 / 衍生 | `ProjectDetail` 为写作 Tab 母体 |
| 有声书挂到书下；藏 run pills | `Audiobook.tsx` + `audiobook.ts` 聚合 |
| 「制作下一集」智能 CTA | CLI `build` 参数自动推断 |
| 修听条 fix/srt 真传参 | 现 API 已支持 |
| 构建表单七字段拆到 L1/L2 | UI only |
| 质量 Tab 内嵌评估+审计入口（深链可暂用旧页） | `Evaluation.tsx` / `Audit.tsx` |

**不做：** 新 Work 类型、设计系统大换血、DB 大迁徙。

### M1 — 书为中心的质量闭环 + Work 预设（3–4 周）

**用户价值：** 质检结果回到章修订；有声书设置一次，后面只点下一集。

| 交付 | 复用 |
|------|------|
| 评估/审计强制绑定 bookId；审计补 projectId | eval 已有 from-eval → `revision_task` |
| Work.settings CRUD（引擎/并章/视频/CER） | `data/audiobook/projects/*.json` |
| 建有声书 3 步向导 | 新 UI；CLI 不变 |
| 统一产物根约定（可仍兼容旧 dist） | audiobook `--out` |
| 集详情「坏段一键重制」 | `listen --fix` |
| 组件层：Button/Select/Dialog 换 Radix 薄封装 | 见 Q6 |

### M2 — 衍生台扩容：精简短篇 + 分发清单（4–6 周）

**用户价值：** 同一母本可出「精简短篇」第二条线；成片有发布检查单。

| 交付 | 复用 |
|------|------|
| WorkType `digest`：选章或自动缩写管线 | writer 章导出 + LLM（shared engines） |
| 发布清单：标题/封面/字幕/平台字段勾选 | `youtube-upload.json` |
| Works 壳上线剧本/短剧灰卡 | 纯 IA |
| 全局「按书分组的衍生进度」仪表 | Dashboard 思路 |

### M3 — 影视向衍生（剧本 / 漫剧 / AI 短剧）（季度级）

**用户价值：** 小说 IP 真正「一源多形态」；仍保持个人可运营，不做协作片场。

| 交付 | 复用 / 缺口 |
|------|-------------|
| `screenplay`：章→场次/对白表 | 需新管线；可吃 outline beats |
| `comic_drama`：分镜图 + 旁白轨 | 场景图管线扩展 |
| `ai_short`：短剧分集视频 | audiobook video 路径演进 |
| 资产库（Book 级 materials） | dist 扫描升级为 Asset index |

**明确不做（至少 2.0 内）：** 多人协作、云同步、市场、剪映级时间线、call sheet。

### 路线图 ASCII

```
M0  IA 归位 + 下一集 CTA + 杀死 v  pill
 │
M1  质检回流 + Work 预设 + 薄设计系统
 │
M2  精简短篇 + 分发清单 + 衍生壳
 │
M3  剧本 / 漫剧 / 短剧 管线
```

### 代码资产总账

| 包/模块 | 2.0 命运 |
|---------|----------|
| `packages/writer` + writer.db | Canon 真相源，保留 |
| `packages/audiobook` CLI | Production 引擎，保留；Web 不再裸陈参数 |
| `packages/eval` | Quality Gate，收进书内 |
| audit（eval 包或独立） | 同上 |
| `packages/web` 页面 | 按 Book/Work 重挂路由 |
| `ActiveJobsBanner` | 升级为跨 writing/audiobook 的任务面 |
| 多套 `novel-*.db` | 运维遗物；产品层只认「书」列表 API |

---

## 7. Q6 组件品质（取舍拍板）

### 7.1 约束

- 本地单人工具，不是 SaaS  
- 现有 `styles.css` 已有 token（亮暗色）  
- 禁止为「品质感」上 Design System 宗教

### 7.2 拍板：Radix 原语 + 薄封装（准 shadcn），不上全量 shadcn 脚手架

| 方案 | 结论 |
|------|------|
| 继续纯原生 | **否决**——select/checkbox 观感与无障碍是硬伤 |
| Ant Design / MUI | **否决**——重、气质工业后台，和写作台冲突 |
| 全量 shadcn + Tailwind 迁移 | **过重**——1900 行 CSS 重写，M0 不可承受 |
| **@radix-ui/react-{select,dialog,checkbox,switch,tabs,dropdown} + 现有 CSS 变量皮肤** | **采纳** |
| 仅美化原生 appearance | 不够；自定义下拉仍要用 Portal |

### 7.3 落地范围（克制）

**M0–M1 只换高频交互控件：**

- Select（引擎、并章、书选择）  
- Dialog / Sheet（确认制作、任务日志）  
- Checkbox / Switch（跳过视频、fix、srt）  
- Tabs（集详情已有，可统一）  
- Button 三级：primary / ghost / danger（统一现 `.btn` / `.ab-btn`）

**不做：** DataTable 库、Formik/RHF 全家桶、图标库替换（Material Symbols 已够）、动画库。

### 7.4 品质感真正来自哪里（比组件库更重要）

1. **一个主 CTA**（不是一排同等按钮）  
2. **空态会说话**（「下一集将用第 16–18 章」vs「请填写 chapters」）  
3. **把 CLI 日志降为高级面板**（作者先看「制作中 62%·第 2/3 章 TTS」）  
4. **杀掉无意义的版本 pill**  

控件升级是必要但不充分条件；**IA 正确后，普通 Radix Select 也比错误架构上的精致原生表单更像产品。**

---

## 8. 反模式清单（做 2.0 时禁止）

1. 再在顶栏加「剧本」「短剧」「漫剧」平级入口  
2. 让用户选择 `dist/` 目录或 v3/v4  
3. 把 `--chars` / `--ep-start` 放在主路径  
4. 有声书页硬编码书名字符串  
5. 评估继续鼓励「上传任意 TXT」作为主路径（应是书内一键）  
6. 为愿景先写短剧时间线编辑器  
7. 「大重构 writer.db」作为 M0 前置——M0 用路由与聚合 API 即可假戏真做  

---

## 9. 决策摘要（给拍板用）

| 议题 | 决策 |
|------|------|
| 产品定位 | 个人作者 IP 衍生创作台，不是工具抽屉，不是影视 SaaS |
| IA | Book → Canon/Quality/Works → Unit → Job → Asset |
| 顶栏 | 我的书 / 任务 / 设置 |
| v3/v4 | 内部产物根；UI 永不展示；Active Work 唯一 |
| 构建 | 「制作下一集」+ 作品预设；专家参数折叠 |
| 旅程 | 开书→写→质检→建衍生→做集→审听→分发 |
| 主对标 | Descript 容器 + ElevenLabs/音剪有声流程 + StudioBinder 阶段名 |
| 路线 | M0 IA/有声可用性 → M1 预设与质检回流 → M2 短篇与分发 → M3 剧本/漫剧/短剧 |
| UI | Radix 薄封装，不引入重型组件库，不全量 Tailwind 化 |

---

## 10. 建议的立即验收标准（M0 Done）

用这五条验收，不要用「感觉好看了」：

1. 新用户从顶栏**找不到**独立「有声书」「质量评估」「逻辑审计」入口（或点进去被引导选书）。  
2. 进入任一本书，三步内能到达「制作下一集」，且**无需手打书名**。  
3. 全站 UI **零处**出现 `v3` / `v4` / `制作版本` / `audiobook-v` 字样。  
4. 构建确认条展示人话：「第 N 集 · 第 A–B 章 · 引擎 X」，而不是七字段表单。  
5. 有声书审听的 fix/srt 勾选后，实际 CLI 参数发生变化（修现有 bug）。

---

## 附录 A — 关键路径索引

| 主题 | 路径 |
|------|------|
| 顶栏导航 | `packages/web/src/components/Layout.tsx` |
| 路由 | `packages/web/src/main.tsx` |
| 有声书总览/构建表单 | `packages/web/src/pages/Audiobook.tsx` |
| 集详情 | `packages/web/src/pages/AudiobookEpisode.tsx` |
| 有声书 API / run 扫描 | `packages/web/server/routes/audiobook.ts` |
| 写作项目详情 | `packages/web/src/pages/ProjectDetail.tsx` |
| 评估 / 审计页 | `packages/web/src/pages/Evaluation.tsx`, `Audit.tsx` |
| Web 依赖 | `packages/web/package.json` |
| 样式 | `packages/web/src/styles.css` |
| audiobook CLI | `packages/audiobook/src/cli.ts` |
| writer schema | `packages/writer/src/migrations/001_initial.sql` |
| 音色配置 | `data/audiobook/projects/*.json` |

## 附录 B — 对标 URL 汇总

- CapCut：https://www.capcut.com/  
- CapCut draft schema（第三方）：https://unpkg.com/capcut-cli@0.19.1/docs/draft-schema/00-overview.md  
- Descript Projects & Compositions：https://help.descript.com/hc/en-us/articles/13535123897485-Projects-and-compositions-overview  
- ElevenLabs Studio：https://elevenlabs.io/docs/eleven-creative/products/studio  
- ElevenLabs 段落音色：https://help.elevenlabs.io/hc/en-us/articles/23370957112721-How-can-I-change-the-voice-and-settings-across-multiple-paragraphs-in-Studio  
- 喜马拉雅音剪：https://audioeditor.ximalaya.com/  
- YouTube Studio：https://studio.youtube.com/  
- StudioBinder：https://www.studiobinder.com/  
- StudioBinder 评述：https://contentcreators.com/tools/studiobinder-review  

## 附录 C — 可选数据模型草图（M1+，非 M0 必做）

```sql
-- 概念草图，不必照搬；可用 JSON/目录约定先仿真

CREATE TABLE work (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,          -- Book = 现 writer project
  type TEXT NOT NULL,                -- audiobook | digest | screenplay | ...
  title TEXT NOT NULL,
  status TEXT NOT NULL,              -- active | archived
  settings_json TEXT NOT NULL,       -- engine, group, video, cer, ...
  asset_root TEXT NOT NULL,          -- 相对仓库的产物根
  created_at TEXT NOT NULL
);

CREATE TABLE work_unit (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  position INTEGER NOT NULL,         -- EP 号
  source_chapter_from INTEGER,
  source_chapter_to INTEGER,
  status TEXT NOT NULL,              -- pending | building | ready | failed
  qa_json TEXT,
  UNIQUE(work_id, position)
);

CREATE TABLE job (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,               -- writer | audiobook | eval | audit
  work_id TEXT,
  project_id TEXT,
  kind TEXT NOT NULL,                -- build | listen | write_chapters | ...
  state TEXT NOT NULL,
  params_json TEXT,
  created_at TEXT NOT NULL
);
```

M0 可以用「路由 + 文件系统约定 + 内存 job」仿真 Work，不急着建表。

## 附录 D — 「制作下一集」伪算法

```
function planNextEpisode(book, work):
  settings = work.settings
  consumed = max chapter covered by existing episodes, else 0
  from = consumed + 1
  to = from + settings.group - 1
  if to > book.lastWrittenChapter:
    return Blocked("正文只到第 {last} 章，去写作台继续")
  return Confirm({
    ep: max(work.episodes.position)+1,
    chapters: [from, to],
    engine: settings.engine,
    video: settings.video,
    out: work.assetRoot
  })
```

前端只渲染 `Confirm`；点开始 → `POST /api/audiobook/jobs` 拼白名单参数（现有安全模型保留）。

## 附录 E — 文案对照（工程师话 → 作者话）

| 现文案/概念 | 2.0 文案 |
|-------------|----------|
| 项目列表 | 我的书 |
| 制作版本 v4 | （删除） |
| 构建新集 | 制作下一集 |
| 并章/集 | 每集含几章（作品设置） |
| 试产字数 | 高级 · 试产截断 |
| 场景图 coverRun | （自动使用本书场景图） |
| pnpm audiobook build … | 高级 · 查看原始命令 |
| 质量评估（顶栏） | 书内 · 质量 · 全书评估 |
| 逻辑审计（顶栏） | 书内 · 质量 · 剧情审计 |

## 附录 F — 风险与故意延期

| 风险 | 处理 |
|------|------|
| 多 dist 根历史数据 | M0 选权威根 + 借 scenes；M1 迁移脚本 |
| writing job 与 audiobook job 两套 | M1 统一任务抽屉外观，后端可仍分治 |
| 用户仍想 CLI | 保留 CLI；Web 是作者面，CLI 是作者兼开发者面 |
| 愿景膨胀 | Works 灰卡满足「看得到未来」；管线按 M2/M3 排队 |

## 附录 G — 边界场景（产品必须答得上来）

| 场景 | 正确行为 |
|------|----------|
| 书写到第 10 章，有声已做到第 9 章（group=3） | CTA 变灰：「还需写到第 12 章」+ 深链写作台 |
| 中间缺 EP02，已有 EP01/EP03 | 「补做第 2 集」出现在缺位卡片，不盲目 +1 |
| 同一章改过 active_revision | 集上标「正文已更新 · 建议重制」；不自动重跑 |
| 两本书同名 | Book 用 project id；展示层加副标题/创建日 |
| 仅有 scenes 的旧 v3 + 有成片的 v4 | 合并视图：成片来自权威根，图来自 scenes 根；用户无感 |
| 串行 job 占用中 | CTA 变「排队中」；点开看全局任务 |
| 试产 chars=600 的集 | 卡片角标「试产」；不计入「全书进度」分母时可配置 |
| 用户坚持要看 CLI | Work 设置 → 开发者选项 →「显示原始命令」 |

## 附录 H — M0 文件级改造清单（仍属方案，不在本次执行）

```
改（UI/路由壳）
  packages/web/src/components/Layout.tsx          顶栏三格
  packages/web/src/main.tsx                       嵌套 /books/:id/...
  packages/web/src/pages/ProjectList.tsx          文案→我的书；卡上衍生摘要
  packages/web/src/pages/ProjectDetail.tsx        拆为 WritingTab 宿主
  packages/web/src/pages/Audiobook.tsx            去 pill；下一集 CTA；藏表单
  packages/web/src/pages/AudiobookEpisode.tsx     路由参数改 book/work/ep
  packages/web/src/pages/Evaluation.tsx           可暂留；入口改书内
  packages/web/src/pages/Audit.tsx                同上

改（API 聚合，尽量薄）
  packages/web/server/routes/audiobook.ts
    - listRuns 按 bookTitle 聚合 / 或新增 GET /books/:id/audiobook
    - 权威根选择逻辑
    - scenes 自动合并（已有跨 run 回退，升为默认）

不动（M0）
  packages/audiobook/**                           CLI 参数面保留
  packages/writer/**                              schema 不动
  packages/eval/**                                算法不动
```

## 附录 I — 与「影视创作台」愿景的诚实距离

用户原话要的是：自动化小说 → 剧本 / 短篇 / 有声 / 视频有声 / 漫剧 / AI 短剧。

| 能力 | 现状成熟度 | 2.0 落点 |
|------|------------|----------|
| 自动化小说 | 高（writer 管线） | Canon Tab |
| 质量把关 | 中高（eval/audit） | Quality Tab |
| 有声 / 视频有声 | 中（CLI+半残 Web） | Work audiobook M0–M1 |
| 精简短篇 | 低（无专用管线） | Work digest M2 |
| 剧本分发 | 低 | Work screenplay M3 |
| 漫剧 | 低（仅有场景图资产可借） | M3 |
| AI 短剧 | 低（视频有声是弱替代） | M3 演进 |

**不要在 M0 用导航假装这些已存在。** 用 Works 灰卡承认路线图，比假入口更专业。

## 附录 J — 信息架构状态机（Book）

```
                  ┌──────────┐
                  │  draft   │ 新书仅 premise
                  └────┬─────┘
                       │ 生成/批准 Bible
                  ┌────▼─────┐
                  │ planning │ 大纲待批
                  └────┬─────┘
                       │ 批准大纲并开写
                  ┌────▼─────┐
                  │ writing  │ 章生产中 ←── 质检回流修订
                  └────┬─────┘
                       │ 末章完成
                  ┌────▼─────┐
                  │completed │ 可全力衍生
                  └────┬─────┘
                       │ 归档
                  ┌────▼─────┐
                  │ archived │ 只读
                  └──────────┘
```

Work 状态与 Book 解耦：Book 仍在 writing 时即可开 audiobook（边写边更），但 CTA 受「已写章」约束（附录 G）。

## 附录 K — 竞品参数哲学对照（加深）

```
剪映：     先给画布 → 参数藏在选中片段的检视器
Descript： 先给文本时间线 → 很少模态表单
ElevenLabs：先选模板/默认音色 → Override 才进专家
音剪：     先选类型向导 → 生成后精修
StudioBinder：先选生产阶段工具 → 单据模板
YouTube：  先上传文件 → 元数据向导

NovelEval 现状：先给 CLI 旗标表单 → 生成
NovelEval 2.0：先给意图 CTA → 预设 → 高级旗标
```

你现在的参数哲学最接近「把 CLI help 画成 HTML」，这是工具站，不是创作台。

---

**终局判断：**  
你已经有了写作引擎、评估器、审计器、有声书 CLI——**零件够做创作台，拼法却像把四个 CLI 包钉在同一个 header 上。** 2.0 的工作不是加第五个钉，而是承认：**书才是产品，工具是书的器官。**

先杀 v3/v4，先做「制作下一集」，先把评估/审计/有声书收回书内。那才是产品思维；其余是工期。
