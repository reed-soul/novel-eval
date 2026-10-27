我已通读方案文档和 `packages/writer/src/` 的关键代码（生成、评估、修正、状态四条链路）。以下是评审报告。

---

# 对《chinese-novelist-skill 借鉴分析》的独立评审

## 0. 总评

方案的大方向判断正确：**对方强在 prompt 资产，我们强在工程管线，该抄的是资产不是流程**。但方案有 3 个问题：

1. **P0-1 的前提不成立**——活代码里语态参照已经在 prompt 末尾，这个行动项基本是 no-op；
2. **P1-5 成本被严重低估**——它不是“加两个字段”，而是横跨 schema/迁移/抽取 prompt/重建服务/两条状态链路的改造，且这块代码历史上就是死锁重灾区；
3. **漏掉了两个真问题**——死 prompt 文件双源陷阱、字数根本没有进质量门禁。

---

## 1. 逐项评审

### P0-1 动笔前上下文顺序 —— ❌ 前提不成立，降级为“验证后关闭”

方案说“拼 prompt 时应检查各段落顺序”。实际代码 `chapter-generation-service.ts:138-176`（`buildPrompts`）的顺序是：

```
蓝图摘要/节拍/钩子/字数 → 平台指令 → 前章状态看板 → 卷摘要 → 最近章节原文 →（revise 时的反馈）
```

**最近章节原文已经在末尾**（163-171 行），只有 revise 轮次会被 `revisionFeedback` 追加在后面（172-174 行）。这里存在一个方案没讨论的张力：revise 轮“反馈垫底”（利于指令遵循）和“正文垫底”（利于语态）二选一。我的判断是**维持现状**——revise 轮指令遵循比语态更急需，且前一轮正文就在反馈上方不远。如果要动，只值一行改动：反馈块末尾附上一章结尾 200 字作语态锚。

**结论：采纳“检查”动作，结论是已达标。半小时预算实际花在关闭这个项上。**

### P0-2 AI 味负面清单 —— ✅ 采纳，轻量版

代码证据：`repetition.ts` 全文只有 k-shingle + Jaccard 两层（机械重复），`writing-grammar.ts` 的平台指令没有任何 AI 腔约束。确实没人管 AI 味。

落地点确认无误：`correct-rewrite.md` 是活文件（`corrector.ts:402` 经 `loadPrompt` 加载），生成侧则是 `buildPrompts` 内联拼的。两处都注入负面清单，半天估算合理。

“重量版确定性检测器”（词表命中率统计）**不建议现在做**——50 行代码不贵，但阈值标定需要 golden 集数据支撑，没数据前是拍脑袋阈值。放 P2 观察。

### P0-3 防注水诊断表 —— ✅ 采纳，但方案低估了真实缺口

方案说“我们字数不足时 revise 反馈笼统”。**实际情况更糟：质量门禁根本没有字数检查。** `quality-gate.ts:82-278` 全流程只查：重复率（severe/mild）→ 八维评估 → 等级/总分/低分维度/平台红线。`chapter.wordCount` 传进来了但从未与目标字数比对。字数目标只出现在生成 prompt 里（`buildPrompts` 146 行），短了没人管。

所以真正的 P0 是：**在 `assessChapterQuality` 第 1 步旁加一个确定性字数检查**（如 <70% 目标字数 → revise），反馈文本用防注水诊断表（先诊断场景薄/节奏快/情感平/对话干，再扩充）。这比方案设想的“改进反馈质量”多了一层从 0 到 1 的 gate，但成本仍是半天到一天（纯算法 + 文案）。

### P1-4 文风校准段落 —— ✅ 采纳核心，砍掉过度设计部分

代码证据确认缺口：bible 是结构化设定（`bible/prompts.ts`、`context-compiler.ts:180-181` 还会剥离 mutable 字段），`writing-grammar.ts` 只有规则无范例。全书没有可注入的正文级锚点。

**砍掉的部分：文风指纹量化指标（对话占比 35%-45% 等）。** 这是对方项目里典型的过度设计——数字指标既没人校准也没人执行，审阅模型不会真去数对话占比。锚点段落（600-1000 字 few-shot）承载 90% 的价值，成本低得多。

成本估算：方案说 2-3 天，砍掉指纹后 **1-1.5 天**足够——第 1 章 review pass 后提取（可直接复用 `quality-gate.ts:165-175` 已有的 evidence/excerpt 机制选段，省一次 LLM 调用），存 `writer.db` 一张小表，注入点放 systemPrompt 的 bible 文本之后（`chapter-generation-service.ts:127-132`）。锚点在第 1 章后不变，与 `enableCache: true`（443 行）兼容良好。

### P1-5 读者已知 / 计划揭示 —— ⚠️ 半采纳，成本估算严重失真

代码证据确认缺口为真：`story-state.ts:36-59` 的 `OpenForeshadow` 只有 `openedAtChapterRevisionId`，无计划回收位；`StoryFact` 无读者可知性。`formatStoryStateDirectives`（277-322 行）对未回收伏笔的措辞是“本章适度推进或回收”（311 行）——确实太软。

**但方案把 2-3 天的标签贴在了一个 1-2 周的工程上**：

- `plannedResolvePosition` 是**规划期属性**，状态抽取（`state-update.md` → `finalizer.ts`）根本填不出来，必须改蓝图链路（`blueprint.ts` 的 schema 和 prompt）再传递到状态——方案完全没提蓝图侧改动；
- 要动 `StoryState`/`StoryStateDelta`/`applyStoryStateDelta`/`state-update.md`/`formatStoryStateDirectives` + 存量状态迁移 + `state-rebuild-service.ts`；
- **这块是死锁重灾区**：`story-state.ts` 里三处注释（112-114、235-238 行）记录了 2026-09-16 夜跑死锁，抽取循环重试 3 次（`chapter-generation-service.ts:339-391`）。每个新字段都是新的验证失败模式；
- 还有一个方案没发现的坑：**corrector 走的是另一套状态表示**（`corrector.ts:394-396` 用 `getNarrativeState` 的 characters/items/abilities 格式，与生成链路的 `formatStoryStateDirectives` 不是同一份数据）。只改一条链路会造成重写修正与生成的状态视图分裂。

**拆法**：便宜的一半先做（伏笔到期强化——blueprint 时顺手给 foreshadow 标注回收章位，`formatStoryStateDirectives` 把到期伏笔从“适度推进”升级为“本章必须回收”），贵的另一半（`revealedToReader` 全账本）放 P2 等便宜的一半验证收益。

### P1-6 钩子技法库 —— ✅ 采纳，但杠杆率比方案暗示的低

方案没注意到：**钩子选型机制我们已经有一半了**——`blueprintChapterRules`/`formatEndingInstruction`（`writing-grammar.ts:76-104`）已经让 LLM 在蓝图阶段产出 `ending_hook` 并注入正文 prompt（`buildPrompts` 145 行）。缺的只是技法分类学和分题材 few-shot。所以这条的实际增量是“给已有决策点喂更好的素材库”，1-2 天估算合理，优先级可排在 P1 末位。MIT 素材直接吸收没有问题。

### P2-7 并行生成写入协议 —— ✅ 同意暂缓，且应升级为“有真实吞吐需求前不做”

比方案更硬的理由：我们的架构是**串行强依赖**——`assertPreviousState`（`chapter-generation-service.ts:419-427`）硬性要求前章状态已发布，`ProjectWriteLease`（`lease-repository.ts`）是单写者租约。并行生成不是加协议，是推翻这两根柱子。对方的写入协议是在**无数据库、纯文件**场景下的无奈设计，参考价值低于方案给的位置。双引擎对比跑同章的试水建议是好的。

### P2-8 摘要放宽到 300 字 —— ✅ 采纳

确认：`state-update.md:10` 限定 50-150 字，且 `delta.summary` 是整体替换（`story-state.ts:269`）非累积，放宽无结构风险。recentWindow=5 章全文已主导上下文，摘要加 150 字 token 成本可忽略。半天 + golden 验证，估算准确。

---

## 2. 方案遗漏的点（本评审新增）

| # | 遗漏点 | 代码证据 | 建议 |
|---|--------|----------|------|
| A | **死 prompt 文件双源陷阱**：`chapter-next.md`、`chapter-first.md`、`summary-update.md` 未被任何代码加载（全库 grep `loadPrompt` 只命中 state-update/blueprint-act/blueprint-chapters/correct-surgical/correct-rewrite 五个）。`chapter-next.md` 自己第 1 行也承认“未接入 live path”。但死模板里有活 prompt 没有的好东西：**【下一章蓝图】预告块、独立的【未回收伏笔】块、专业细节真实感要求**——活链路 `buildPrompts` 全都没有。改 .md 文件的人会以为改了生成行为，实际是空操作 | `chapter-generation-service.ts:122-177` vs `chapter/prompts/chapter-next.md` | **P0 卫生项**：要么删死文件，要么把下一章预告/伏笔块移植进 `buildPrompts`。这是全清单里性价比最高的一项 |
| B | **corrector 与生成的双状态表示**（上文 P1-5 已述）：修正链路读 `getNarrativeState` 的旧格式（items/abilities/events），生成链路读 `formatStoryStateDirectives`。任何状态维度的增改（包括 P1-5）都必须两处同步，否则修正稿与生成稿的世界观视图不一致 | `corrector.ts:394-396` vs `chapter-generation-service.ts:152` | 作为 P1-5 的前置约束记录在案；统一是 P2 |
| C | **锚点段落提取可复用评估产物**：P1-4 方案写“让 reviewer 挑”，实际 `quality-gate.ts:165-175` 的 evidence/excerpt 机制已经有选段产物，加一次轻量 LLM 调用即可，不必新造提取流程 | `quality-gate.ts:41-49` | 降低 P1-4 成本依据 |

## 3. 过度设计 / 低估成本汇总

| 项 | 判定 |
|---|---|
| 文风指纹量化指标（对话占比 35%-45% 等） | **过度设计**。无人校准、审阅模型不会真执行数字指标。锚点段落已覆盖主要价值 |
| P1-5 整体 2-3 天 | **低估 3-5 倍**。漏算蓝图链路改造、存量迁移、双状态表示同步；且该区域是历史死锁重灾区 |
| AI 味确定性检测器（重量版） | 现在做是**过早优化**——无 golden 数据标定阈值。先靠 prompt 注入，有证据再上检测器 |
| P2-7 并行协议 | 方案定位（暂缓）对，但理由不足：不是“借鉴协议”问题，是与我方租约+串行状态架构根本冲突 |

## 4. 我的优先级清单

### P0 —— 本周内，合计 ~2.5 天

| # | 事项 | 工作量 | 落点 |
|---|------|--------|------|
| P0-1 | 清理死 prompt 双源：把【下一章蓝图】预告、【未回收伏笔】独立块移植进 `buildPrompts`，删除或明确归档 `chapter-next.md`/`chapter-first.md`/`summary-update.md` | 0.5 天 | `chapter-generation-service.ts:122-177` |
| P0-2 | 字数进质量门禁：确定性检查（<70% 目标 → revise），反馈挂防注水诊断表（先诊断后扩充）+ 三题材 few-shot | 0.5-1 天 | `quality-gate.ts:121` 之后新增检查步 |
| P0-3 | AI 味负面清单注入：`correct-rewrite.md` + `buildPrompts` 平台指令尾部 | 0.5 天 | `corrector.ts:402` 加载的模板 + `writing-grammar.ts` |
| P0-4 | 上下文顺序核验（原方案 P0-1）：确认已达标，唯一动作用一行“revise 反馈后附上章结尾 200 字语态锚” | 0.5 小时 | `chapter-generation-service.ts:172` |

### P1 —— 两周内，合计 ~5-6 天

| # | 事项 | 工作量 | 落点 |
|---|------|--------|------|
| P1-1 | 文风锚点段落：第 1 章 pass 后提取（复用 eval evidence 选段）→ `writer.db` 小表 → systemPrompt 注入。**不做**指纹量化指标 | 1-1.5 天 | `chapter-reviewer-service.ts` + 新 migration + `buildPrompts` |
| P1-2 | 伏笔到期强化（P1-5 便宜半）：blueprint 产出时标注计划回收章位，`formatStoryStateDirectives` 分离“到期必收”与“可推进”两个列表 | 2-3 天 | `blueprint.ts` schema/prompt + `story-state.ts:308-312` |
| P1-3 | 钩子/开头技法库分题材入库（MIT 素材整理），蓝图阶段选型带示例 | 1-2 天 | `writing-grammar.ts` + `blueprint-chapters.md` |

### P2 —— 有证据后再排

| # | 事项 | 触发条件 |
|---|------|----------|
| P2-1 | 读者已知账本（`revealedToReader`）+ corrector/生成状态表示统一 | P1-2 验证伏笔到期机制有正收益后；预算按 1-2 周报，不按 2-3 天 |
| P2-2 | AI 味确定性检测器 | golden 集上有 AI 腔维度的可量化差分证据后 |
| P2-3 | summary 放宽 300 字 golden 实验 | 半天，随任意一次 golden 回归顺带跑 |
| P2-4 | 并行生成 | 出现真实吞吐需求（且先在双引擎对比场景试水）；此前不动租约/串行架构 |

---

**一句话总结**：方案的 P0 三项里两项成立一项前提错误；真正被漏掉的最大便宜是“死 prompt 双源 + 字数无门禁”这两个确定性缺口；最大的坑是把 P1-5 当 2-3 天的活去排期——它是这个代码库里风险最高的改造区域之一。
