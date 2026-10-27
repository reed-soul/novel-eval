# 代码评审：c1df49f — chinese-novelist-skill P0 批次落地

**结论：approve-with-comments**。主生成链路实现正确、集成点齐、测试在 Node 24 下全绿（166/166 pass）。有 2 个必改小项和 1 个应跟进的链路遗漏（corrector）。

---

## 0. 验证环境说明

直接 `node --test` 或用错 Node 版本跑 `npm test` 会大面积失败（better-sqlite3 ABI 不匹配 / `strip-only mode` 报错）——**这是环境问题不是本提交的问题**。用 `.nvmrc` 的 Node 24 跑：**166/166 通过**，含新增 5 例。

## 1. 逐文件审查

### quality-gate.ts — 字数闸门 ✅（有 1 个边界防御缺失）

- 闸门位置在防重复检测之前，短章 revise 不写 repetition 记录，省 LLM 成本，逻辑自洽。
- 耗尽 maxRevise 后走 `ChapterQualityRejectedError` 保留草稿（chapter-generation-service.ts:350），兜底正确。
- 全库 `assessChapterQuality` 只有 `reviewChapter` 一个调用方，且已透传 `targetWordCount`——无遗漏调用点。

**边界 bug（必须修）**：`opts.targetWordCount ?? config` 只挡 `null/undefined`。CLI `--word-count abc` 经 `parseInt` 得 `NaN`（index.ts:314 无校验），或上游传 `0`，都会原样传入；`actualWords < NaN` 恒 false，闸门**静默失效**。建议：

```ts
const targetWords = opts.targetWordCount && Number.isFinite(opts.targetWordCount) && opts.targetWordCount > 0
  ? opts.targetWordCount
  : getRuntimeConfig().generation.chapterWordCount;
```

### writing-grammar.ts — AI 味负面清单 ✅

四平台（general/fanqie/yanxuan/douban literary 分支）全部命中，测试有断言；douban 自身底座未被顶掉。

**Nit**：`/** 通用平台（general）默认也吃 AI 味清单。*/` 是悬空注释，紧贴 `writingEngineFor`，看起来在文档化那个函数——实际 general 分支的 spread 已自说明。删掉即可。

### chapter-generation-service.ts — Action Anchor / 语态锚 / 预告 ✅

- **语态锚取章正确**：`recentChapters` 经 `DESC + reverse()` 后为升序（chapter-repository.ts:237-248），`[length-1]` 确为紧邻上一章。已核实。
- anchor 放在反馈+语态锚之后收尾，"直接输出正文"防续写幻觉，设计合理。
- `目标字数` 出现两次（L146 与 anchor L197）——轻微冗余，无害。
- `slice(-200)` 可能截半句，中文语境可接受。

### context-compiler.ts — nextOutline ✅

`getApprovedOutlineAtPosition(position+1)`：末章/act 边界（下一章蓝图未批）返回 null，行为正确降级；两条返回路径（带/不带 contextHash）都加了 `nextOutline`，无遗漏。

### config.ts / writer.yml ✅

`minWordRatio` 默认 0.75、`revision.expansionGuide` 默认 null，向后兼容。测试里手搓的 `WriterConfig` 也同步了新字段，没有漏。

### CLI 透传 ✅（已专项核实）

`--word-count`（index.ts:314/330）→ `args.wordCount ?? config`（L1128）及 job 快照 `snapshot.wordCount`（L1346→1377）→ `GenerateNextInput.wordCount` → `targetWordCount: input.wordCount`（chapter-generation-service.ts:321）→ reviewer → gate。**透传链路完整，无断点**。

### state-update.md 摘要扩容 ✅

grep 无任何下游按 150 字截断/假设 summary 长度的代码，扩容安全。

## 2. 链路遗漏：corrector 不吃字数闸门（应修，follow-up）

用户问的两个点，核实结果：

1. **字数闸门：corrector 完全绕过**。`correctChapter`（corrector.ts:262）重评走 `assessChapters` 直连 LLM 评分，不经 `assessChapterQuality`——整章重写策略产出的修正稿**无字数校验**即可存草稿、经 revision publication 发布。这正打在本特性"杜绝短章过闸落盘"的意图上。
2. **corrector 的 wordCount 来源也错**：`correctChapter` 用 `getRuntimeConfig().generation.chapterWordCount`（corrector.ts:292），忽略 CLI `--word-count` / job 快照的 per-project 目标——闸门若后续接入，两处口径会打架。
3. **语态锚：corrector 不需要**。`correct-rewrite.md` 已注入 `{RECENT_CHAPTERS}` 全文（含上一章完整正文），语态参照已存在；且本次 diff 已给 correct-rewrite.md 补了去AI味行——覆盖到位。

建议：corrector 重评后补一个同样的确定性字数检查（或抽 `checkWordGate(content, target)` 共用），并让 corrector 的 wordCount 与生成链路同源。

## 3. Prompt 文案质量

| 位置 | 评价 |
|---|---|
| Action Anchor | 清晰、无歧义，"直接输出正文"与既有模板收尾语一致 ✅ |
| 禁词指令 | `禁用"璀璨/瑰丽/宛如/不由得…"类陈词堆砌` 有歧义——LLM 可能读成**绝对禁词**而非"禁堆砌"。"宛如"是正当文学词，全面禁用对 douban literary 引擎偏激进。建议改为可执行判据："这些词每章合计最多 1 次" |
| state-update 三要素 | 指令具体 ✅，但"③章末悬念残留"遇 douban 安静收束章（writing-grammar 明确允许）可能诱导抽取器**幻觉出悬念**。建议补"若本章以安静收束，此项写'无'" |
| expansionGuide | "删掉该段扩充，故事是否变差？不变差即注水"是好的可执行判据 ✅ |
| 三处复制 | 防AI味文案存在于 writing-grammar.ts / correct-rewrite.md / writer.yml 三处，需人工同步（yml 注释已自我提醒，可接受） |

## 4. 测试覆盖

- **通过**：5/5（Node 24），字数闸门的拦/放/可配三态 + 四平台清单 + douban 底座保留，断言到位（含 `llmCalled === false` 验证零 LLM 成本）。
- **必须修（一行事）**：测试文件头注释宣称 `3. buildPrompts：下一章预告 / 专业细节 / Action Anchor / revise 语态锚`，但**文件里没有任何 buildPrompts 用例**——buildPrompts 是模块私有函数未导出，本次 5 项特性中 3 项（预告/anchor/语态锚）零回归覆盖。要么改注释别撒谎，要么经 `generateContent` test seam（chapter-generator.test.ts:250 已有该模式）捕获 prompt 补 3 个断言。建议后者，语态锚的 `[length-1]` 取章逻辑值得钉住。
- Nit：测试 2 注释说"80+ 字"，实际构造约 200 字，注释不准。
- 无人覆盖：`revision.expansionGuide = null` 的降级文案分支。

## 5. 必须修清单

| # | 项 | 位置 | 成本 |
|---|---|---|---|
| 1 | `targetWordCount` 为 0/NaN 时闸门静默失效，加 finite 校验 | quality-gate.ts:128 | 2 行 |
| 2 | 测试头注释宣称 buildPrompts 覆盖但无此用例——补测或改注释 | p0-adoption.test.ts:5 | 1 行～20 行 |
| 3（跟进） | corrector 绕过字数闸门 + wordCount 不同源 | corrector.ts:292/316 | 小函数抽取 |

1、2 修完即可合入；3 建议单独开 follow-up commit，不阻塞本批次。
