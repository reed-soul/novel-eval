# 借鉴 chinese-novelist-skill：最终落地方案（三源整合版）

> 日期：2026-10-25
> 输入：原方案（WorkBuddy）+ 独立评审 ×2（Claude Code 2.1.300 / Antigravity CLI agy 1.4.7，均带代码级核对）
> 评审原文：`docs/research/agent-reviews/claude-review.md`、`docs/research/agent-reviews/agy-review.md`
> 结论先行：**原方案 8 项中 5 项成立（含 2 项需修正落地方式）、2 项被否决、1 项前提错误；两份评审独立发现了同一个原方案漏掉的最大确定性缺口——字数从未进过质量门禁。**

---

## 一、三方裁决共识矩阵

| 原方案项 | 原方案 | Claude Code 评审 | agy 评审 | **最终裁决** |
|---|---|---|---|---|
| 1. 上下文顺序（近因效应） | P0 | ❌ 前提不成立：活代码 `buildPrompts` 里最近章节原文**已在末尾**（`chapter-generation-service.ts:163-171`）；唯一动作=revise 反馈附语态锚 | ⚠️ 已垫底但**尾部裸奔**有续写幻觉风险；须考虑 prefix cache（`:443 enableCache:true`），末尾加 Action Anchor | **小改保留**：末尾加闭合指令段 + revise 轮反馈附上章结尾 200 字 |
| 2. AI 味负面清单 | P0 轻量 + 重量检测器 | ✅ 轻量采纳；检测器无 golden 标定=拍脑袋阈值，P2 | ✅ 采纳但**严禁 hardBlock**——情绪爆发点句式合法，误杀耗尽 maxRevise 死循环；检测器只诊断+路由 surgical（`corrector.ts:73` writingQuality 本属 SURGICAL_DIMS） | **采纳轻量注入（P0）+ 检测器只诊断不阻断（P1）** |
| 3. 防注水诊断表 | P0，含三题材 few-shot | ✅ 采纳，且发现**门禁根本无字数检查**（`quality-gate.ts:82-278` 全流程无字数比对） | ✅ 同发现无字数闸门；**反对 few-shot**（每次 revise 凭空 +2000 token），凝练 200 字规则 | **采纳 + 升级**：先补字数闸门（两评审独立发现的同一缺口），诊断表用凝练规则版，阈值 70-80% 可配 |
| 4. 文风校准段落 | P1，第 1 章提取回填 DB 全书注入 | ✅ 采纳核心；砍文风指纹量化（无人校准）；复用 eval evidence 选段省一次 LLM | ❌ 反对全书常驻注入（第 50 章时 recentChapters 已有 3 章语态，强塞第 1 章=冗余+节奏干扰）；**指出致命盲区：第 1 章冷启动才是最裸奔的**（无 recentChapters 无 previousState） | **折中**：首章冷启动用平台内置范例（P1 必做）；全书回填锚点降 P2 等漂移证据 |
| 5. 读者已知/计划揭示 | P1，改 StoryState schema | ⚠️ 低估 3-5 倍：漏算蓝图链路改造+存量迁移+corrector 双状态分裂；死锁重灾区 | ❌ **坚决否决**：策划态与执行态概念混淆——StoryState 是事后事件溯源账本，正文已写出则读者已看到，`revealedToReader:false` 逻辑不可能；到期必兑必复现 2026-09-16 死锁；并指出原方案"已有 OPEN_FORESHADOWS"论断来自**死代码** chapter-next.md | **否决 schema 改造**。改为蓝图层软方案：foreshadowing 标注计划回收章位（"宜回收"软指导）+ POV/信息差描述字段 |
| 6. 钩子技法库 | P1 | ✅ 采纳；提醒 ending_hook 机制已有一半，杠杆率低 | ✅ 采纳；**严禁大段示例倾倒**，技法 tag + ≤15 字指引 | **采纳**，收敛在 writing-grammar.ts，技法枚举化 |
| 7. 并行写入协议 | P2 暂缓 | ✅ 暂缓；理由升级：与 `assertPreviousState`（`:419-427`）+ ProjectWriteLease 单写者租约根本冲突 | ❌ 架构降级倒退：文件编辑礼仪套 ACID 事务后端是体系错位 | **不做**。除非真实吞吐需求且先在双引擎对比场景试水 |
| 8. 摘要放宽 300 字 | P2 试验 | ✅ 采纳；确认整体替换无结构风险（`story-state.ts:269`） | ✅ **升 P0**：`listArcSummaries` 只是每 N 章抽 summary 快照，50-150 字只记得"谁去了哪"；改一个 prompt 数字成本≈0 | **升 P0**：200-350 字，含心理位移+悬念残留点 |

## 二、两份评审的新发现（原方案盲区）

| 发现 | 来源 | 采纳状态 |
|---|---|---|
| **死 prompt 双源陷阱**：`chapter-next.md`/`chapter-first.md`/`summary-update.md` 未被任何代码加载（grep `loadPrompt` 仅命中 5 个文件），但死模板里有活链路没有的好东西：**【下一章蓝图】预告块、独立【未回收伏笔】块、专业细节真实感要求**。改 .md 文件=空操作 | 两家都发现 | ✅ P0：移植活内容 + 清理死文件 |
| **字数无门禁**：八维评分、平台红线、重复率都有，唯独没有"实际字数 vs 目标字数"。模型吐 800 字也能过闸落盘 | 两家独立发现 | ✅ P0 第一项 |
| **第 1 章冷启动裸奔**：无语态参照、无状态看板，最易出 AI 腔 | agy 独有 | ✅ P1 第一项 |
| **corrector surgical 与在线循环割裂**：质检不过一律整章重写，轻度问题本应路由 `surgical` 微创修复（省约 40% token） | agy 独有 | ✅ P2（收益明确但动在线循环，谨慎排后） |
| **corrector 与生成双状态表示**：修正链路读 `getNarrativeState` 旧格式（items/abilities），生成链路读 `formatStoryStateDirectives`，任何状态维度改动须两处同步 | Claude 独有 | ✅ 记录为 P1-2 前置约束；统一 P2 |
| **prefix cache 兼容**：`enableCache:true` 下动态内容位置影响前缀命中率 | agy 独有 | ✅ 并入 P0-5 实施 |

## 三、最终行动清单

### P0 —— 本周，合计约 2.5 人天

| # | 事项 | 落点 | 工作量 |
|---|------|------|--------|
| P0-1 | **字数闸门进质量门禁**：确定性检查（实际 < 目标 70-80%，阈值入 writer.yml 可配）→ revise；反馈文本挂防注水 4 象限诊断（场景薄→感官肌理 / 跳太快→放慢关键帧 / 情感平→内心展开 / 对话干→潜台词层次），凝练 200 字规则注入 `correct-rewrite.md`，**不带**三题材 few-shot | `quality-gate.ts` 重复检查之后新增一步 + `correct-rewrite.md` | 0.8 天 |
| P0-2 | **死 prompt 双源清理**：把【下一章蓝图】预告块、独立【未回收伏笔】块、专业细节真实感要求从死模板移植进 `buildPrompts`；`chapter-next.md`/`chapter-first.md`/`summary-update.md` 删除或明确归档标记 | `chapter-generation-service.ts:122-177` + `chapter/prompts/` | 0.5 天 |
| P0-3 | **AI 味负面清单注入**（纯 prompt，无检测器）：禁堆砌形容词（璀璨/瑰丽/宛如类）、抽象情绪陈述改具体动作、破四字格律陈词滥调、长短句交替；注入 `writing-grammar.ts` 平台指令尾部 + `correct-rewrite.md` | `writing-grammar.ts` + `correct-rewrite.md` | 0.5 天 |
| P0-4 | **状态摘要扩容**：50-150 字 → 200-350 字，口径改为"推进事实 + 角色心理位移 + 章末悬念残留"；确认对 state-rebuild 的向下兼容（旧状态照读，新抽取按新口径） | `state-update.md` + 兼容性检查 | 0.2 天 |
| P0-5 | **Prompt 末端 Action Anchor**：正文语态参照后加强闭合指令（"现在写第 N 章《标题》，目标 X 字，完成蓝图 Y"），防续写幻觉；revise 轮反馈末尾附上章结尾 200 字作语态锚 | `chapter-generation-service.ts` buildPrompts | 0.5 天 |

### P1 —— 两周内，合计约 3.5-4 人天

| # | 事项 | 落点 | 工作量 |
|---|------|------|--------|
| P1-1 | **首章冷启动文风锚点**：按平台（番茄/盐选/豆瓣/通用）各内置约 400 字黄金开局范例（静态资产，进 `writing-grammar.ts`），仅 `outlinePosition === 1` 时注入 | `writing-grammar.ts` + `buildPrompts` | 1 天 |
| P1-2 | **蓝图层伏笔规划（软方案）**：蓝图 foreshadowing 字段标注计划回收章位 + POV/信息差描述；`formatStoryStateDirectives` 把"到期"与"可推进"分列表，措辞"本章宜回收"——**不动 StoryState schema，不做硬门禁**。前置约束：蓝图侧新增字段不得依赖 corrector 的旧状态格式 | `blueprint.ts` schema/prompt + `story-state.ts` 指令格式化 | 1.5 天 |
| P1-3 | **钩子技法库**：MIT 素材整理为技法枚举（截断/反转/危机/留白等 tag + ≤15 字指引），蓝图阶段选型，正文按 tag 挂一句话指引 | `writing-grammar.ts` + `blueprint-chapters.md` | 1 天 |
| P1-4 | **AI 味轻量检测器**：`detectAiTaste()` 正则扫描（AI 高频词表 + 句式频率），**只诊断不阻断**——结果进 quality-gate feedback，命中项优先路由 corrector surgical 模式替换 | `repetition.ts` 旁新文件 + `quality-gate.ts` + `corrector.ts` | 0.8 天 |

### P2 —— 有证据后再排

| # | 事项 | 触发条件 |
|---|------|----------|
| P2-1 | 在线 revise 链路接入 surgical 微创修稿（轻度问题不整章重写） | P1-4 验证诊断→surgical 路由有效后 |
| P2-2 | corrector/生成双状态表示统一 | 与任何状态维度改造合并做 |
| P2-3 | 全书文风锚点回填（第 1 章 evidence 选段 → DB → 后续注入） | golden 集显示文风漂移证据后 |
| P2-4 | AI 味检测阈值标定 | golden 集有 AI 腔维度量化差分后 |
| P2-5 | 并行生成 | 出现真实吞吐需求；先在双引擎对比场景试水，不动租约/串行架构 |

### 明确否决项（不再出现在任何排期）

| 否决项 | 理由 |
|--------|------|
| StoryState 加 `revealedToReader` / `plannedResolvePosition` + 到期必兑硬门禁 | 策划态与执行态概念混淆；事后事件溯源账本上标"读者未知"逻辑不可能；到期必兑必复现 9-16 死锁（agy 强拒 + Claude 低估 3-5 倍警告） |
| 文风指纹量化指标（对话占比 35%-45% 等） | 无人校准、评估模型不会真执行数字指标（Claude：过度设计） |
| 全书常驻注入第 1 章锚点段落 | 中后期与 recentChapters 冗余、干扰高潮章节节奏（agy） |
| 三题材 few-shot 全量进 revise prompt | 每次 revise +2000 token，规则版已覆盖核心（agy） |
| 借鉴并行写入协议 | 与单写者租约 + 串行状态机根本冲突；文件协议套数据库后端是体系错位（两家一致） |

## 四、验证方式

- P0 全部 + P1-1/P1-4 完成后跑一轮 golden 回归（`pnpm golden run`），对比连贯性、文笔维度基线
- P0-1 字数闸门：构造 800 字短章用例验证必然触发 revise
- P0-4 摘要扩容：跑 3 章确认 state-rebuild 兼容旧存量状态

## 五、过程记录

- Cursor agent 因未完成浏览器授权，本轮跳过（用户确认）；其登录链接已失效，后续如需补第三份评审，重新 `cursor-agent login` 即可
- 本机 `antigravity` 命令是 npm 同名占位包（内容为打开 xkcd 漫画），真正的 Antigravity CLI 是 `~/.local/bin/agy`
