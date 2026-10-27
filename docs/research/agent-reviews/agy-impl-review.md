# 代码评审报告：commit `c1df49f`（P0 批次落地）

- **评审目标**：`c1df49f` — feat(writer): 落地 chinese-novelist-skill 借鉴 P0 批次
- **依据规范**：[2026-10-25-skill-adoption-final.md](file:///Users/reed_soul/code/novel-eval/docs/research/2026-10-25-skill-adoption-final.md)
- **评审结论**：**`Approve with Comments`**（核心主链路闭环良好，零 LLM 成本字数闸门与 AI 味清单落地扎实；但存在**测试用例承诺未兑现**、**下一章预告存在 LLM 越界抢戏风险**、**corrector 链路脱节**等必须修复的问题，需在紧接着的 Fixup 提交中解决）。

---

## 一、逐文件 Diff 详细评审

### 1. [quality-gate.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/quality-gate.ts#L124-L150) & [config.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/config.ts) & [writer.yml](file:///Users/reed_soul/code/novel-eval/packages/writer/src/config/writer.yml)
- **实现剖析**：在质量门禁第 0.5 步前置接入 `actualWords < targetWords * wordRatio` 确定性拦截，判定不达标直接返回 `verdict: 'revise'`，挂上防注水 4 象限指引，并调用 `persistEval` 写入 `eval_history`。
- **优点**：
  - 真正做到了零 LLM 成本拦截残卷/短章，杜绝了模型吐出 800 字也能过闸落盘的历史缺陷。
  - `countChars` 采用中文字符过滤算法，统计稳定。
- **边界情况与隐患**：
  - 🟡 **配置缺少合法性校验**：若 `writer.yml` 中的 `minWordRatio` 误配为负数、大于 1.0 或 NaN，会导致永远无法过闸或门禁失效。建议添加 `Math.max(0.1, Math.min(1.0, wordRatio))` 防御。
  - 🟡 **假占位符问题**：`writer.yml` 的注释写着 `# null 关闭；替换文案请同步 correct-rewrite.md 的占位符语义`，然而 [correct-rewrite.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/correct-rewrite.md) 中根本没有支持该占位符替换，代码里也未实现相关逻辑。

### 2. [writing-grammar.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/writing-grammar.ts#L15-L22)
- **实现剖析**：抽象出通用的 `ANTI_AI_FLAVOR_DIRECTIVES`，注入到 `douban`、`yanxuan`、`fanqie`、`general` 四个平台的指令尾部。
- **文案质量**：
  - 规则凝练有效，正反例对比清晰（如禁止"房间很乱"，示范为"桌上三个空罐，烟灰缸满出来"；成语排比限制 ≤1 次/章）。
  - 没有引入歧义指令，LLM 遵从度高。
- **轻微瑕疵**：
  - 💭 "禁用'璀璨/瑰丽/宛如/不由得/心中涌起'类陈词堆砌，一个名词前最多一个形容词"：其中"宛如"、"不由得"属副词/介词，语法分类归在"形容词堆砌"稍欠严谨，但不影响 LLM 语义理解。

### 3. [context-compiler.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/context-compiler.ts#L183-L196) & [chapter-generation-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L144-L200)
- **实现剖析**：
  - `ContextCompiler` 查询下一章 approved 蓝图，若存在则包装为 `nextOutline`，并加入了 `contextHash`。
  - `buildPrompts` 移植了专业细节真实感、下一章蓝图预告、Action Anchor；revise 轮在审阅反馈后拼接上一章结尾 200 字语态锚。
- **优点**：
  - `nextOutline` 在最后一章或后续章节大纲未批复时正确回退为 `null`，边界处理严密。
  - `hashPayload` 包含了 `nextOutline`，确保编译哈希与前缀缓存一致性。
  - `prevChapter` 获取逻辑与 SQL `position ASC` 保持一致，末尾 200 字切片准确。
- **边界情况与隐患（重点）**：
  - 🔴 **Prompt 误解风险：下一章预告存在越界抢戏/提前剧透风险**：
    当前文案为：
    ```typescript
    '【下一章蓝图预告】（本章结尾要为下章做好铺垫，保证衔接）',
    `第${context.nextOutline.position}章《${context.nextOutline.title}》：${context.nextOutline.summary}`,
    ```
    大语言模型在生成时有极强的"把已知情节一口气写完"的冲动。若未加明确的**负面禁止约束**，模型容易把下一章的 summary 事件在当前章末尾提前演完，导致下一章情节被透支。
  - 🟡 **Revise 轮 Action Anchor 语义弱化审阅意见**：
    当前末端闭合指令固定为：
    ```typescript
    `现在开始创作：写出第 ${context.outlinePosition} 章《${outline.title}》完整正文（约 ${wordCount} 字），完成上述蓝图目标，直接输出正文。`
    ```
    由于末端指令拥有最高的近因效应权重，在 revise 轮只提"完成蓝图目标"而未提"质量审阅反馈"，易导致模型忽略上文的审阅批评。

### 4. `chapter/prompts/` 模板文件
- **[state-update.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/state-update.md#L10)**：
  - 摘要扩容至 200-350 字，三要素（推进事实、角色心理位移、章末悬念残留）口径精确。
  - 经核对 [story-state.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/domain/story-state.ts) 与 [finalizer.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/finalizer.ts)，代码侧对 summary 无硬性长度裁剪，完全向下兼容。
- **[chapter-next.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/chapter-next.md#L1-L4) 等归档标记**：
  - 🔴 **事实不符**：`chapter-next.md` 顶部注释声明：
    `原模板中的【下一章蓝图】预告块、【未回收伏笔】块、专业细节真实感要求已移植进活链路。`
    经查，活链路 [buildPrompts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L138-L200) 中**根本没有移植【未回收伏笔】独立块**（该项在设计文档中已明确延期至 P1-2 软方案）。注释与实现不一致，容易误导后续维护者。
- **[correct-rewrite.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/correct-rewrite.md)**：
  - 🔴 **遗漏 P0-1 核心要求**：设计文档中明确要求"凝练 200 字规则注入 `correct-rewrite.md`（防注水 4 象限）"，但本次 diff 仅加了一行去 AI 味，完全遗漏了防注水 4 象限规则。

### 5. [p0-adoption.test.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/tests/unit/p0-adoption.test.ts)
- 🔴 **严重遗漏：测试承诺未兑现**：
  文件头部的 docstring 明确写着要测试 3 项：
  > 1. 字数闸门：短章直接 revise，带防注水诊断反馈
  > 2. AI 味负面清单：四平台指令全部包含
  > 3. buildPrompts：下一章预告 / 专业细节 / Action Anchor / revise 语态锚
  
  **但代码实现到第 157 行就结束了，文件中根本没有针对第 3 项（`buildPrompts` 系列功能）的任何测试代码！** 涉及 `nextOutline`、`Action Anchor`、`语态锚` 的新增逻辑测试覆盖率为 0。

---

## 二、专项审查问题解答

### Q1: CLI 路径 `targetWordCount` 是否透传？
- **结论：已完整透传。**
- **调用链核对**：
  1. CLI 入口 [index.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/index.ts#L1128)：解析 `--word-count`，默认回退 `config.generation.chapterWordCount`。
  2. Facade [writer-application.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/writer-application.ts#L1137)：将 `wordCount` 传入 `generation.generateNext({ wordCount, ... })`。
  3. 服务层 [chapter-generation-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L321)：传入 `this.reviewer.reviewChapter({ targetWordCount: input.wordCount, ... })`。
  4. 评审包装器 [chapter-reviewer-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-reviewer-service.ts#L70)：透传给 `assessChapterQuality({ targetWordCount: input.targetWordCount, ... })`。
  5. 质量门禁 [quality-gate.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/quality-gate.ts#L128)：优先使用 `opts.targetWordCount`。
  - `resume` 和 `auto` 命令以及 Web 路由也均有同样正确的透传逻辑。

### Q2: Corrector 链路是否也该吃到字数闸门或语态锚？
- **结论：Corrector 链路目前完全脱节，存在严重漏洞。**
  1. **字数闸门完全脱节**：[corrector.ts:correctChapter](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/corrector.ts#L298-L327) 在生成修正稿后，直接调用底层的 `assessChapters` 和 `detectRepetition`，**跳过了 `assessChapterQuality`**，没有任何字数比例比对！若修正稿因 LLM 截断只生成了 300 字残卷，依然会被存入 `correction_draft`，一旦采纳就会破坏正常正文。
  2. **语态锚与 Action Anchor 缺失**：[correct-rewrite.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/correct-rewrite.md) 中，待修正正文 `{CURRENT_CONTENT}` 位于最末尾附近，而最近章节放在前面。原稿本身的劣质语态会产生严重的近因干扰，末尾既没有上一章 200 字语态锚，也没有清晰的 Action Anchor 闭合声明。
  3. **硬编码字数**：`corrector.ts:282` 硬编码读取 `getRuntimeConfig().generation.chapterWordCount`，无法感知项目的自定义单章字数。

---

## 三、问题定级清单与修改建议

### 🔴 Blockers（必须在下一个 Fixup 提交中修复）

#### 1. 补齐 `p0-adoption.test.ts` 中承诺的 `buildPrompts` 回归测试
- **位置**：[p0-adoption.test.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/tests/unit/p0-adoption.test.ts)
- **原因**：文件顶部声称包含但实际漏写，导致 `nextOutline`、`Action Anchor`、`语态锚` 处于零测试状态。
- **修复方案**：补充测试套件，验证：
  - `nextOutline` 存在时注入下一章预告，为 null 时不注入。
  - 初稿生成时包含末端 Action Anchor。
  - Revise 轮包含上一章 200 字语态锚；第 1 章 revise 时优雅跳过语态锚。

#### 2. `buildPrompts` 下一章蓝图预告增加防越界/防剧透禁令
- **位置**：[chapter-generation-service.ts:155-161](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L155-L161)
- **原因**：防止大模型在当前章末尾提前把下一章的剧情事件写完。
- **修复建议**：
  ```typescript
  if (context.nextOutline) {
    lines.push(
      '',
      '【下一章蓝图预告】（仅供本章章末收束与过渡铺垫，严禁提前推进或解决下一章事件！）',
      `第${context.nextOutline.position}章《${context.nextOutline.title}》：${context.nextOutline.summary}`,
    );
  }
  ```

#### 3. 补齐 `correct-rewrite.md` 遗漏的防注水 4 象限规则并清理注释
- **位置**：[correct-rewrite.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/correct-rewrite.md) 及 [writer.yml:29](file:///Users/reed_soul/code/novel-eval/packages/writer/src/config/writer.yml#L29)
- **原因**：落实 P0-1 承诺的凝练规则注入，消除 `writer.yml` 中的假占位符描述。

#### 4. 纠正 `chapter-next.md` 归档注释中的事实错误
- **位置**：[chapter-next.md:3](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/chapter-next.md#L3)
- **原因**：删去"【未回收伏笔】块已移植进活链路"的失实描述，避免后续排查困惑。

---

### 🟡 Suggestions（建议尽快优化）

1. **Corrector 补齐字数闸门**：
   在 [corrector.ts:correctChapter](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/corrector.ts#L294) 步骤 4 前增加字数比例判断（`countChars(revisedContent) < wordCount * minWordRatio`），低于阈值直接抛错或标记重试，禁止将残卷存入 `correction_draft`。
2. **Revise 轮 Action Anchor 语义协同**：
   在 [chapter-generation-service.ts:193](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L193) 中，若存在 `revisionFeedback`，将末尾指令调整为：
   `现在开始重写：结合上述审阅反馈与蓝图目标，写出第 ${context.outlinePosition} 章《${outline.title}》完整正文（约 ${wordCount} 字），直接输出正文。`
3. **`minWordRatio` 范围保护**：
   在 [quality-gate.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/quality-gate.ts#L38) 的 `gateConfig()` 中包裹 `Math.max(0.1, Math.min(1.0, cfg.minWordRatio))`。

---

### 💭 Nits（代码风格与一致性）

1. 保持 [correct-rewrite.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/correct-rewrite.md#L35) 与 [writing-grammar.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/writing-grammar.ts#L15) 中去 AI 味清单的分行排版一致，增强可读性。
