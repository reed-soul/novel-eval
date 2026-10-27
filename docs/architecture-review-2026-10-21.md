# novel-eval 架构评审：能否稳定产出优质悬疑长篇

评审日期：2026-10-21 ｜ 范围：全仓库（8 包 / 约 6.2 万行 TS）+ 43 部实际交付物 + 视频衍生线
方法：代码逐路径核对 + 交付物统计 + 门禁实测（typecheck / 单测）+ 工业流程对标
结论性质：**只读评审，未修改任何代码**

---

## 0. 一句话裁决

**生成侧是工业级的，质量侧是仪式性的，交付侧是人肉缝合的；而视频侧根本没有接上。**

三句话展开：

1. **写作内核**（revision 不可变追加、租约心跳、state 版本化、迁移体系、类型化 DTO）达到同规模个人项目上游水平，18 章 / 4.3 万字能稳定跑通 40+ 次，这不是 demo，是真产线。
2. **但决定"能否交付"的三道门全部不阻断**：导出自检只 print、eval 不设退出码、audit 的 P0 由 LLM 自定义语义再由人肉 grep 判定。门是存在的，裁决权在人手里，且人每晚都在疲劳决策。
3. **评分仪器已经饱和到失去分辨力**（19 部有记录作品：均值 86.1、标准差 2.3、区间 80–89、15 部 ≥85），而门槛是 75 分。这个门不是筛选器，是仪式。

**对"能否稳定产出优质悬疑长篇"的直接回答：**

- 稳定产出**可投递的商业短篇** —— 能，已被 43 部验证。
- 稳定产出**优质**短篇 —— **不能判定**。仪器分辨不出优劣，而唯一的外部真值（盐选拒稿）与内部 88/A 直接矛盾过。
- 稳定产出**悬疑长篇**（60 章 / 30 万字）—— **不能**。三条硬缺口：长程状态预算按短篇设计、伏笔只有后验抽取没有前验埋点表、章级门无全书视野。

---

## 1. 架构实况

### 1.1 分层

```
packages/shared   (3.5k)  引擎适配器 · YAML 配置 · DTO(含 narration) · 文本/章节工具
packages/writer   (12k)   bible → 蓝图 → 章节 → 章级门 → story-state 增量 · SQLite
packages/eval     (5.7k)  map/reduce 八维评分 · 平台红线 · audit 三探针 · 报告 · compare
packages/web      (15.7k) Hono + React · jobs · pipeline-spawn · render-lock · child-registry
packages/audiobook(4.8k)  annotate → tts → srt → render-assets → video → assemble → youtube
packages/narration(1.6k)  S1 切片 → S2 四阶段文案 → S3 双门 → S4 多轨音频 → S5 配图 → S6 渲染 → S7 物料
packages/digest   (0.5k)  精简短篇
```

### 1.2 真实数据流（含断裂点）

```
daily-novel-prompt.txt（事实上的 SOP，自然语言）
   + run-night-novel.sh（bash 重试 + python 拼 SQL 查 projectId）
        │
        ▼
writer auto ──ContextCompiler(recent=5 / arc=10 / timeline 5 条)──► LLM
   │  chapter_revision(draft→published) · story_state_revision(current/stale)
   │  章级门 quality-gate → assessChapters(同引擎, 单章, lite reduce)
        ▼
   writer.db ────────────「真相 A：结构化」
        │ export_book.py（与 export-and-verify.ts 并行两份实现；inner join；无条数断言）
        ▼
    book.md ──► eval(submission + fanqie 红线) ──► 人读 stdout 判过/不过  ◄── 断裂①
        └────► audit A(GLM)+B(DeepSeek) ──► P0 名单 ──► 人肉 grep ──► 手改 book.md + 手改 DB ◄── 断裂②
        └────► meta.md / TOPIC-LEDGER.md ────────「真相 B：自由文本」
        └────► adaptation-notes.md（人写三用蓝图，无任何管线读取） ◄── 断裂③
                    │
                    ├─► audiobook(narration)  registry 2 条，最后渲染 2026-09-15  ◄── 断裂④
                    └─► novel2motion（仓外）  仅靠笔记口头交接
```

### 1.3 「真相」有几份

| 真相 | 载体 | 谁在写 | 谁在读 |
|---|---|---|---|
| 正文 | `writer.db` chapter_revision | 引擎 + 16 个一次性 patch 脚本 | 导出器 |
| 正文 | `research/daily-novels/*/book.md` | 人工补丁直接改写 | eval / audit / 投稿 / 衍生线 |
| 故事状态 | `story_state_revision` | 抽取器（常失败，靠自愈补丁） | 下一章 ContextCompiler |
| 交付元数据 | `meta.md` | 每晚手写 | 只有人 |
| 选题状态 | `TOPIC-LEDGER.md` | 每晚追加散文 | 外部 agent 读 |
| 衍生状态 | `data/*/registry.json` | web 路由 | 无（已停更） |

**六份真相，零个自动对账。** 这是本仓库最根本的架构问题——不是某个 bug，是契约缺失。

---

## 2. 是否最佳实践：三层裁决

| 层 | 判定 | 依据（对标：单一真相源 / 门禁不可绕过 / 评测独立 / 内容回归 / 版本化产物） |
|---|---|---|
| **工程架构** | 部分是 | 租约+心跳 ✓、revision 追加 ✓、迁移 ✓、配置外置 ✓、类型全绿 ✓；单一真相源 ✗、依赖单向 ✗（writer→eval 反向）、双轨编排 ✗ |
| **质量工程** | 不是 | 门禁不可绕过 ✗、生成与评测独立 ✗、内容回归 ✗（golden 只测评委不测写手）、版本化 ✗（promptVersion 是手写常量） |
| **内容生产线** | 部分是 | 产能与一致性可复现 ✓（40+ 次）；但可复现靠人肉 SOP（三局两胜、P0 grep 复核、七版正则打地鼠），机器不持裁决权，且未闭环到发布 |

**已实测的工程健康度**（本次评审亲自跑）：

- `pnpm typecheck`：8 包全绿。
- `pnpm test:unit`：**Node 22 下 47 个测试红**，原因是 `better-sqlite3` 按 Node 24 ABI（NODE_MODULE_VERSION 137）编译，而本机默认 PATH 是 Node 22（127）；`PATH` 切到 Node 24 后 `db.test.ts` 3/3 通过。
- 仓库**无 `.nvmrc` / 无 node 版本锁**。结论：这不是代码坏了，是**可复现性坏了**——同一条产线换台机器就静默瘫痪，而故障表现是"47 个测试失败"，极易被误判为代码缺陷。
- `git`：170 次提交，**最后一次 2026-09-20**，近 30 天 0 提交；`research/daily-novels/` 下 **95 项未纳入版本控制**。

> 这条时间线很说明问题：**代码在 9 月 20 日冻结，内容生产从 9 月 15 日跑到今天。** 产线在跑，机器不修；所有学习成果以散文形式堆进台账，没有一条回流成代码。

---

## 3. 薄弱环节（按严重度，均已核到代码或数据）

### P0 —— 直接决定"能不能稳定出货"

| # | 环节 | 证据 | 失效模式 |
|---|---|---|---|
| W1 | **门禁不阻断** | `packages/eval/src/index.ts` 全文无 `process.exit` / `exitCode`；`scripts/export_book.py:110-141` 命中黑名单只 `print("❌")` 并 `hits += 1`，末尾无 `sys.exit` | 人工漏读即放行。CI 无法拦。"小满"违令 8 次（累计 300+ 处）就是这个机制的必然产物 |
| W2 | **评分仪器饱和** | 19 部有 `总分` 记录：均值 **86.1**、σ **2.3**、区间 80–89、**15/19 ≥85**；市场分 15/19 落 78–84；门槛 `passMinScore: 75` / `passGrade: B`（`writer.yml:22-26`） | 门通过率接近 100%，**不具备分辨力**。80 分和 89 分在统计上不可区分，却对应完全不同的读者体验 |
| W3 | **章级门只看一章，且砍掉了市场与节奏维** | `chapter/quality-gate.ts:145` 单元素 `chapterInput`；`eval/src/assess.ts:44-49` 单章路径**强制 `lite` reduce，跳过 R3 情绪曲线 / R5 市场对标** | 生成期对"全书一致性、伏笔回收、弧光、市场/节奏"零约束。而市场分恰恰是平台红线维度——**门看不见它自己要卡的那一维** |
| W4 | **评估器与被评者同源** | `quality-gate.ts:85` `evaluatorEngine ?? engine`；全仓**无任何调用方传入 `evaluatorEngine`**（仅类型定义与透传）；默认引擎 `bigmodel` | 同族偏置无法被结构性发现。能力写了没接线——audit 线的双红队接了，章级门没接 |
| W5 | **导出口径不可靠** | `export_book.py` 与 `export-and-verify.ts` 两份重复实现，黑名单已漂移；inner join `active_revision_id`；仅"0 章"才退出；启发式剥标题 | 已发生：丢章（ch3/ch12）、整库错位一位、双层标题致 36 个章头 |
| W6 | **人工补丁绕开产品路径** | 16 个 `scripts/patch_*.py` 硬编码 before/after 字符串 + `UPDATE chapter_revision SET content`；而产品早已有 `writer-application.ts:713 publishChapterEditWithExtract`，Web 路由在用（`routes/edit.ts:87`），CLI 不用 | 补丁不入 revision 链、不触发 state 重算。**改完第 10 章，11–18 章的 state 全部 stale**，后续续写/衍生跑在错状态上 |
| W7 | **门不可判定** | audit P0 同稿四轮 7→4→4→6 非单调；"三局两胜"只写在 prompt 文本里，不是代码 | 同一稿反复跑可任取"过"的那一次。已至少 12 例"阈值带交付" |

### P1 —— 决定"能不能做长篇"

| # | 环节 | 证据 | 失效模式 |
|---|---|---|---|
| W8 | **长程上下文按短篇设计** | `recentWindow: 5`、`arcInterval: 10`、`story-state.ts:314-318` timeline 只留最近 5 条、`:303-306` facts 全量无衰减无检索、`:269` summary 覆盖式 | 60 章 / 30 万字时：facts 线性膨胀→截断或 token 爆；早期时间锚与主线丢失；动机漂移无法归因 |
| W9 | **伏笔只有后验抽取，没有前验埋点表** | `story-state.ts:36-59` 仅 `open/resolved`；三处"幂等/自愈"注释（`:114/:126/:223`）承认抽取常失败；埋点清单只活在 `--topic` 的自由文本里（`prompt:47`） | 无法机器校验"应第 N 章回收"。回收率不可度量、漏收无告警。悬疑类的命门恰好在这里 |
| W10 | **prompt 版本是名义的** | `promptVersion` 手写常量 `'chapter-v1'`；22 个 prompt `.md` 不参与任何哈希；`contextHash` 生成后落库却无人消费 | "这次变差是不是我改了 prompt" 永远无解；golden 无法定位变量 |
| W11 | **编排双轨** | CLI：`run-night-novel.sh` bash 重试 + python f-string 拼 SQL 查 projectId；Web：内存 Map + DB 双写 | 两套恢复/错误语义，修 bug 改两处；CLI 与 Web 可同时写同库 |

### P2 —— 结构性整洁

W12 平台知识双写（`platforms.yml` 与 `writing-grammar.ts` 各一份）｜W13 依赖方向（writer→eval 反向、narration 深挖 audiobook 子路径）｜W14 应用层门面过宽（`writer-application.ts` 1425 行 / 9 个方法跨四域）｜W15 文档漂移（README 写"五维"，实际八维）｜W16 品牌漂移（`me.json` 频道名"悬疑借阅室"，日产 prompt 写"悬疑档案室"）

---

## 4. 视频化衔接：三处断裂，一个 40:0

这是本次评审里最硬的一组数据：

| 事实 | 数据 | 来源 |
|---|---|---|
| 小说成品 | **43 个作品目录 / 40 份 meta.md / 40 份 adaptation-notes.md** | `research/daily-novels/` |
| 进入有声书线的 | **2 部**（森铁 8/30、物业管家 9/15） | `data/audiobook/registry.json` |
| 进入解说视频线的 | **2 部**（物业管家、油锯不上山，均 9/15） | `data/narration/registry.json` |
| 最后一次实际渲染 | **2026-09-15**（单部 930 秒串行锁） | `data/narration/cost-ledger.json` |
| YouTube 频道 | **1 条视频 / 4 次播放**（2026-08-28 发布） | `research/yt-competitors/data/me.json` |

**投产比 40 : 0。** 小说线日产 18 章，视频线自 9 月 15 日后再无产出——**为不存在的下游满负荷投产**，这是当前最贵的架构问题（比任何一个代码缺陷都贵）。

### 三处断裂

**断裂① 交接物是散文，不是契约。**
`adaptation-notes.md` 质量很高（冷开场原句、6 集分集与钩位、名场面 TOP3、20 分钟解说爆点时间轴、短剧关键场景与色调、面位备注）。但它**没有被任何管线读取**——`packages/narration` 的 S1 从章节正文重新抽取 clue-graph，等于把已经做过一遍的判断重做一遍，且两套结果必然漂移：写作侧 `story_state.foreshadows`、审计侧 P0 判定、解说侧 clue-graph，**三份伏笔真相**。

**断裂② 解说管线建好了但没接。**
S1–S7 设计完整（三层幕-序列-拍、双门、多轨音频、物证优先配图、beat 精确渲染、Shorts 计划），`PLAN.md` 还记录了 20+ 条外部评审采纳。但：`shorts` / `thumbnail` / `cover` 在 packages 内检索**零命中**（PLAN 标 M2 已完成）；渲染是全局串行锁 930 秒/部，40 部 backlog 需 100+ 天；与 `adaptation-notes` 的分集钩位未打通（`chaptersPerEpisode=3` 是硬编码猜测，不是读笔记）。

**断裂③ 发布段完全没有工程化。**
`registry` 无 `published / videoId / views / publishedAt` 字段；40 份 meta grep「已投/已上架」= 0 命中；`me.mjs`（搜索/About/RSS）可用但 62 天未复跑。结果是：**无法回答"哪部发了、哪部没发、发了的效果如何"**，而 yt 赛道报告的核心打法是"持续出钩子等爆款"——没有发布节奏与数据回流，这个打法无法执行。

### 一条被忽视的品类风险

`research/yt-competitors/REPORT.md` 结论：爆款集中度极高（中位 4–6K，峰值 25.8 万）、纯推文小号在死、**「一口气看完·完结文·冷开场直讲」在活**。而当前产线是"每天一部新书"——产能对着"2–3 天一条长视频"的赛道节奏，**产能倒挂 2.5 倍**，backlog 每日净增。选题再准，也摊不到观众面前。

---

## 5. 优化方向与优先级

排序原则：**影响内容质量与出货能力 ÷ 返工成本**。P0 全部是"把已有的能力接上线"，不是新建。

### P0（1–2 周内可完成，收益最大）

**P0-1 门禁可执行化（gate as code）** — 3–5 人日
- `evaluate` / `audit` 加 `--gate`，不达标 `exit 2`；导出加后置断言（章数 = 蓝图数、无重复章头、黑名单零命中、英文残留零命中），违例 `exit 1`。
- 统一产出 `gate.json`（含章数、总分、八维、红线、P0 清单、promptVersion）。
- 改动面：`packages/eval/src/index.ts`、把 `scripts/export_book.py` 收编为 `writer/src/export.ts`（删掉 Python 与 TS 两份实现）。
- 为什么第一：W1/W5/W7 四类历史事故（丢章、错位、违令名出厂、任取一局过门）**全部因为"门不阻断"才成立**。这是把人工 SOP 变成系统能力的唯一单点。

**P0-2 章级门接异源评审 + 补上市场/节奏** — 1–2 人日
- 在 CLI/Web 生成入口传入 `evaluatorEngine`（换成与写作引擎**不同家族**），`evaluatorEngine` 已在 `quality-gate.ts:70` 留好。
- 单章路径不要再无条件 `lite`：至少对每个 arc 首章跑全量 reduce，让 market / pacing 进入生成期视野。
- 为什么排第二：改动最小、对"同源盲区"的边际收益最大——小满 8 次、章尾脚手架 7 变体、保护伞软着陆，都是同源偏差的产物。

**P0-3 补丁走产品路径，重建自动触发** — 3–4 人日
- 把 `publishChapterEditWithExtract`（`writer-application.ts:713`）提为唯一入口：`write patch --chapter N --file x.md --extract`，落 `revision(source=manual)`，随后自动 `rebuildFrom(N)`。
- 产出 DB ↔ book.md 差异报告（章数/字数/hash 三级对账）。
- 为什么第三：16 个一次性脚本是"错位一位""补丁自伤"事故的机制成因；能力已在，只差收口。**这一步做完，六份真相收敛成两份。**

**P0-4 打通 1 部视频的端到端闭环（零代码）** — 0.5 人日
- 选市场分最高的《守村人》（91）走 audiobook → narration → 发布全链，用现有 Web 五步工作台。
- 目的不是产能，是**暴露接口断裂**：不跑通第一部，`adaptation-notes` 与管线之间的契约就永远写不对。
- 这条排 P0 而不是 P1，因为 **40:0 是当前最大的架构损失**，且验证成本极低（一天）。

**P0-5 确定性连续性门（长篇前置条件 A）** — 5–8 人日
- 用 `story_state` 做零 LLM 成本校验，在 publish 前拒绝：违反角色 status（死人出场）、与 facts 字面矛盾、时间线非单调、伏笔 open 超 N 章未推进。
- 输入从"当前章"改为"当前章 + 近 5 章摘要 + 未回收伏笔清单"。
- 为什么必需：`quality-gate.ts:145` 是"生成期无全书视野"的根因，而这类检查**不需要模型**，是纯确定性收益。

**P0-6 伏笔埋点表前验化（长篇前置条件 B）** — 6–10 人日
- 蓝图期生成结构化 `plants[]`（id / plantChapter / resolveChapter / 物证载体 / 揭示方式），写进 `chapter_outline_revision`；publish 时校验、state 对账。
- 为什么必需：悬疑长篇的可行性完全建立在这张表上。当前是"topic 里写一句话 + 靠引擎自觉 + 事后 audit 抓"——短篇能撑住，长篇必崩。

### P1（1 个月内）

7. **prompt 真版本化**：prompt `.md` 内容 sha256 → `promptVersion`，写入 `eval_history` / `story_state_revision`，golden 结果按版本归档（2–3 人日）。
8. **裁决统计化**：把"三局两胜"写成 `--repeats 3 --require 2`，输出均值/极差；规则化"极差 > 6 加跑""覆盖单次失败需 ≥ +3 分"（2 人日）。阈值带交付会被自动暴露。
9. **选题台账结构化**：`TOPIC-LEDGER.md` 升为一行一记录的选题库（簇/原型/机制/情绪/市场分/面位/投产/发布/播放），窗口计算由脚本做。现状已失真：机制"首用"记录自相矛盾（0926 / 1029 / 1030 三处）。
10. **发布状态机 + 数据回流**：registry 增 `published/videoId/views/publishedAt`；`me.mjs` 每周定时跑，播放/完播写回选题库。
11. **人工通读门**：每部抽读 3 章（首章/高潮/末章），30 分钟。盐选拒稿证明"内部 88 ≠ 可读"——这是唯一能补上"读者代入感"的信号，成本最低、缺口最大。
12. **标注层（画本）**：怪谈线人名发音表 + 说话人/情绪归属，为多角色演播铺路。

### P2

13. 抽 `@novel-eval/quality` 包（writer 与 eval 共用 map/reduce/红线），解除 writer→eval 反向依赖。
14. 导出改为不可变 artifact（`book.md` + `manifest.json`，含每章 revisionId / 字数 / hash），衍生线读 artifact 而非目录。
15. 夜跑收编为 `write night`（resume/重试/预算/门禁一条命令），删掉 bash+python 拼 SQL。
16. 双标尺：投稿门（盐选/番茄）+ 改编门（名场面数 / 可视觉化物证数 / 冷开场强度 / 分集钩位密度）——`adaptation-notes` 里这些信息已经写好了，只是从未计分。《站冰桩》番茄 74 分而实际用途是影视改编，就是单标尺错判的实例。
17. 补齐 `.nvmrc` + `engines` 精确版本，锁 Node 24；CI 里跑 `typecheck + test:unit`。

### 不建议做（避免过度工程）

- 不引入微服务 / MQ / 独立数据库：单机 SQLite + 租约够用，双轨问题是"删掉一条轨"，不是再加一层。
- 不做通用多 provider 编排 DSL / 可视化工作流：2 引擎、1 品类、18 章，抽象收益为负。
- 不用 LLM 评委替代确定性检查：违令名、章尾脚手架、双层标题都是字符串问题，正则是唯一正解（现在七个正则版本打地鼠，应收敛成一条通配 + 一张清单）。
- 不为长篇先上向量 RAG：先做 P0-6 的结构化埋点，检索是次要问题。
- 不合并 audiobook 与 narration：抽 `@novel-eval/media`（ffmpeg/tts/srt，现已有两份 GAP 常量重复）即可。

---

## 6. 证据边界

**本次亲自核验**：typecheck 全绿；单测 47 红为 Node ABI 问题（Node 24 下转绿）；`eval/src/index.ts` 无退出码；`export_book.py` 无 `sys.exit`；`assess.ts` 单章强制 lite 跳过 R3/R5；`evaluatorEngine` 无调用方；`publishChapterEditWithExtract` 已存在且 Web 在用；19 部评分分布统计；两处 registry 与 `me.json` 数据；git 提交时间线与 95 项未跟踪交付物。

**沿用团队成员结论、未逐条抽验**：audit P0 四轮非单调的具体轮次、`writing-grammar.ts` 与 `platforms.yml` 的双写范围、`logs/` 是否已成事实编排器、narration `script.json` 是否存在绕过 `gates.ts` 的旁路。这四项不影响任何 P0 判断，实施前抽验即可。

---

## 7. 需要你决策的三件事

1. **产能 vs 出货**：是否接受"暂停日产 1 部"，用 3–5 天把 2–3 部书做成 2–3 条视频，先验证完播与选题假设？否则 backlog 继续扩大，架构优化没有外部真值可对照。
2. **短篇还是长篇**：如果近期仍以 18 章短篇为主，P0-5/P0-6（3–6 周工作量）可以推后，先做 P0-1~P0-4（1 周内）。如果准备转长篇，P0-6 是不可跳过的前置。
3. **单标尺还是双标尺**：投稿平台（番茄/盐选）与 YouTube/短剧对"好"的定义不同。是否建立第二把"改编面位"尺，决定选题准入按哪个目标优化。
