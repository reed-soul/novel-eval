# v3 处方草案架构评审报告

> **评审基准**：结合 [2026-10-25-v3-prescription-draft.md](file:///Users/reed_soul/code/novel-eval/docs/research/2026-10-25-v3-prescription-draft.md)、Battle3 裁判判词（[battle3-agy-verdict.md](file:///Users/reed_soul/code/novel-eval/research/daily-novels/2026-10-25-skill-battle-shoucunren/battle3-agy-verdict.md)、[battle3-claude-verdict.md](file:///Users/reed_soul/code/novel-eval/research/daily-novels/2026-10-25-skill-battle-shoucunren/battle3-claude-verdict.md)）以及 `packages/writer/src` 真实执行链路进行穿透式审查。

---

## 一、 处方生效性与落点可靠性评审

### 处方 1：每章强制情感拍点（蓝图层）
* **生效性预测**：**低效（被稀释）**。
* **落点偏差**：草案要求在 [blueprint-chapters.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/blueprint-chapters.md) 规定「每章 summary 必须包含一个明确的情感拍点」。然而检查 [blueprint.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/blueprint.ts#L68)，`summary` 的 Schema 长度约束仅为 30-400 字，且需承担主线事件、转折、伏笔等高密度信息。模型为了满足事件闭环，会将情感拍点高度压缩成一两句套话（如“阮棠顺手给椿伯递汤”）。
* 在正文生成活链路 [chapter-generation-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L134-L150) 中，`summary` 只是 `lines` 里的单条文本，而紧随其后的是硬编码的番茄爽点规范、每 500 字转折要求、以及第 147 行的 `'专业细节真实感：涉及物证、刑侦...'`。正文生成模型在巨大的快节奏推理张力挤压下，会直接把 summary 里的弱情感拍点一笔带过，继续滑向纯事件推进。
* **可靠性判定（蓝图层 vs 闸门层）**：
  * **蓝图层是必要分配，但不是执行保证**：不在蓝图排定情感场次，正文生成连叙事空间都没有；
  * **闸门层是防守底线，但不是生产力**：若蓝图没设计情感场景，闸门拦截只会让正文在同一段冰冷情节上硬挤虚假抒情，陷入无效重写循环；
  * **结论**：**蓝图必须做“独立槽位分配”，正文指令必须给“篇幅预算”，闸门负责“守住底线”**。仅在 summary 塞要求是典型的形式主义。

### 处方 2：取证对象从物转向人（生成指令层）
* **生效性预测**：**中效偏弱，极易反噬**。
* **落点偏差**：草案将该条放进 [writing-grammar.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/writing-grammar.ts#L23) 的通用去 AI 味清单中，并附带样例文案（*“指纹咬合的瞬间，我想起按手印那只手如今在给谁喂饭”*）。
* **致命隐患**：
  1. 当前 LLM 面对“验物时写出物主的脸、手、呼吸”这种微观文学笔法，最直接的执行动作就是**机械插入第一人称内心独白与煽情回忆**，直接打脸 [writing-grammar.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/writing-grammar.ts#L18) 的`【忌抽象情绪陈述】`，产出油腻廉价的“AI 哭腔”。
  2. 检查 [chapter-generation-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L147)，该文件写死了：`'专业细节真实感：涉及物证、刑侦、医学、机械、地理等行业细节时，写出严密扎实的生活与专业细节'`。活链路里的硬编码指令正在强力驱动模型“死抠物证”，与 grammar 的要求直接打架。

### 处方 3：情感维度进闸门 + 双本取优（质量门槛层）
* **生效性预测**：**阈值失效；取优机制存在架构倒退风险**。
* **落点分析**：
  1. **阈值形同虚设**：草案建议 `minEmotionalResonance: 72`。在 Battle3 中，被 agy 批为“解谜机器，流不下一滴泪”、被 Claude 批为“几乎没有一场情感互动”的 v2，**两个裁判给的情感分恰好就是 74**。设 72 作为硬闸门，v2 这种情感崩塌的残卷将** 100% 畅通无阻**。
  2. **双本取优是饮鸩止渴**：在没有解决生成侧结构性缺陷前，跑两本取高分，本质是**用双倍 Token 掩盖管线均值低下的系统缺陷**，不仅使长篇连载生成成本翻倍，还会引发基于内部 evaluator 的过拟合偏好。

---

## 二、 5 个待评审问题逐一裁决

### Q1：处方 1 的“情感拍点进 summary”会不会被蓝图生成器敷衍填空？有无更稳落点？
> **裁决：必然敷衍。更稳落点是“独立结构字段 + 正文指令对齐”。**

* **原因**：Summary 是复合事件叙述段落。在 LLM 生成多目标指令时，高阶逻辑（悬念/转折/破案）必然吞噬低阶逻辑（温情互动）。
* **稳健落点**：
  1. 在 [blueprint.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/blueprint.ts) 的 `CHAPTER_ITEM_SCHEMA` 中增加强约束字段：
     ```ts
     emotional_anchor: {
       type: 'string',
       min: 15,
       max: 80,
       required: true, // 明确：本章主角与谁产生实体互动/动作，承载何种情感亏欠或慰藉
     }
     ```
  2. 在 [chapter-generation-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L142) 的 `buildPrompts` 中将 `emotional_anchor` 作为与“蓝图定位”平级的主指令直接注入，明确分派至少 300-500 字的场景预算。

### Q2：处方 2 的“物挂人”指令在 LLM 执行时的遵从率预估？是否需要 eval 层检测？
> **裁决：纯 Prompt 遵从率不足 35%，且极易变质为廉价抒情。不需要在 eval 扩充第九维度，但需在 quality-gate 的 revise 诊断中挂钩。**

* **遵从率分析**：LLM 擅长单向演绎（“从 A 推导出 B”），极其不擅长在推导过程中同时维持人物微动作描写。给“物挂人”提示词，LLM 大概率产出“看着汇款单，我流泪了”的敷衍语句。
* **方案**：不需要改动 `@novel-eval/eval` 的八维评分大盘（新增维度成本过高），而是修改 [quality-gate.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/quality-gate.ts#L323) 的 `buildFeedback`：当 `characterization` 或 `emotionalResonance` 触发低分 revise 时，将反馈模板对准具体的行动纠偏：*“严禁纯物证说明文；关键线索必须从活人口中或人际肢体冲突/照护中套出”*。

### Q3：处方 3 的 `minEmotionalResonance=72` 阈值合理性？
> **裁决：不合理。72 是掩耳盗铃，必须定在 76。**

* **数据事实**：
  * Battle3 丙（v1 旧版）情感分：Claude 85 / agy 66（均值 75.5）；
  * Battle3 乙（v2 处方版）情感分：Claude 74 / agy 74（均值 74.0）；
  * Battle3 甲（skill 版）情感分：Claude 93 / agy 98（均值 95.5）。
* 若设 72，两裁判一致判定为“冰冷解谜机器”的 v2 会全部无视闸门直接落盘。
* **架构定案**：
  * 在 [writer.yml](file:///Users/reed_soul/code/novel-eval/packages/writer/src/config/writer.yml) 中配置：
    ```yaml
    qualityGate:
      minCharacterization: 75
      minEmotionalResonance: 76  # 必须高于 v2 的 74 失败线
    ```
  * 当得分 < 76 时，触发带对症诊断指南的 `revise`，坚决将情感冷漠稿件挡在交付门槛外。

### Q4：有没有遗漏的处方？
> **裁决：遗漏了最核心的结构级命门——「核心羁绊对象活体在场律」与「主角主观动机亏欠绑定」。**

* **回顾 agy 在 Battle3 中的核心判词**：
  * **批 v1**：“核心人物活的人格第 1 章即离场（死透了），靠尸体开口与遗物借力，情则借力”；
  * **赞 甲（Skill）**：“椿伯活着，让他展现出哪怕口不能言也要把碗口朝内作揖的傲骨与人道尊严；第 6 章端坐上首喝腊八粥……将守村人重塑为替众生负重前行的一夜白头者”。
* **草案遗漏的重大结构约束**：
  * **死人无法产生即时情感互动，活人才有尊严与羁绊**。v1 和 v2 为什么冷？v1 第一章让椿伯在门板上死透；v2 开篇直接把奶奶写死，椿伯变成背景远景。
  * **遗漏处方 A（核心人物存活锁）**：题材定义的情感核心对象（如守村人、重病至亲、被冤长辈），**在前 2 幕（前 10 章）严禁彻底死亡或物理退场**！必须作为活体在场，接受照护、产生对视、承担共同危机。
  * **遗漏处方 B（主角道德亏欠绑定）**：主角不能是客观冷静的“法医/语文老师讲卷子”，主角家庭必须与核心人物存在**不可推卸的历史亏欠或救命因果**（如：“他哑了三十年，替的是我当年的命”）。

### Q5：双本取优会不会引入“过拟合裁判偏好”的选稿偏差？
> **裁决：必然引入，且会严重劣化工程性价比。**

* **偏差机理**：单次评审的 LLM Evaluator 存在词汇与风格方差。在两个同源样本中做局部挑拣，选出来的往往不是“故事更有人味”，而是“更迎合 Evaluator 提示词偏好（例如更多四字成语或排比情绪词）”的过拟合版本。
* **工程代价**：全书生成成本直接增加 100%，耗时翻倍。管线架构的任务是**提高单次生成中位数的质量（提升下限）**，而不是把赌注押在抽卡上。双本取优只能作为研发阶段的离线 A/B 对比工具，绝对不能写进生产主流程。

---

## 三、 过度设计与低估成本点

| 模块 | 诊断 | 严重度 | 架构实情与隐患 |
|---|---|:---:|---|
| **双本取优跑法** | **严重低估成本 / 过度设计** | **高** | 60 章连载如果全跑双份，Token 消耗翻倍、DB 写入冲突与 Lease 续期压力激增，用抽卡掩盖生成不稳定是工程退步。 |
| **“物挂人”的微观辞藻控制** | **过度设计 / 易引反噬** | **中** | 强制要求“指纹咬合想到喂饭的手”，是用微观修辞来强扭宏观情感。模型只会大量生成模板化陈腐联想，破坏悬疑硬核度。 |
| **死模板认知混淆** | **工程债务 / 维护成本** | **中** | [chapter-first.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/chapter-first.md) 早已标注为死模板，但开发人员仍经常试图去改 markdown 模板。真实生效的活链路在 [chapter-generation-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts)，若不在代码层统一，修改将持续打空。 |
| **闸门重写震荡风暴** | **低估重试成本** | **高** | 如果只在 [writer.yml](file:///Users/reed_soul/code/novel-eval/packages/writer/src/config/writer.yml) 提分数而不给清晰的重写动作指引，每章将触发 2-3 次 Revise 耗尽重试次数，导致单章生成耗时突破 10 分钟。 |

---

## 四、 架构师追加处方（结构级约束）

结合 Battle3 盲评对甲（Skill 版）“文学级情感力量”的肯定，以及对 v1/v2“死人借力、机器解谜”的抨击，补充以下两项关键结构级处方：

### 追加处方 A：【核心羁绊对象活体在场律】（Bible / Planning 层）
* **规则**：在故事的世界观 Bible 和 Act 1 蓝图设计中，承载本题材道德、情感核心的角色（如民俗中的受难圣者/守村人、现实悬疑中的受害冤亲），**在第一幕（前 10 章）绝对禁止写成僵硬尸体或彻底退场**。
* **机制**：
  * 该角色必须活体在场，具备微弱的、但有尊严的生理或行为反应（吃粥、叠物、眼神凝视、特定习惯动作）；
  * 主角的所有破案推理与危机解决，必须**与其照护、救治该角色的生存死线紧密绑定**。

### 追加处方 B：【情感靠仪式化动作落地，严禁抽象抒情】（Writing Grammar 层）
* **规则**：在 [writing-grammar.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/writing-grammar.ts) 的通用去 AI 味规范中，新增强行约束：
  > `- 【情感靠动作落地】严禁抽象感叹与心路回忆（不许写"心中酸楚/眼眶发热/想起当年"）。人物情感必须通过具体的物理动作、规矩仪式与物件交互传递（如：把幡角叠平、碗口规矩朝里、全村顿拐送粥、撕掉半截药包）。读者因动作而落泪，不因叙述者煽情而落泪。`

### 追加处方 C：消除代码层硬编码物证偏见（Service 活链路层）
* **规则**：修改 [chapter-generation-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L147) 的单向物证指令。
* **修订前**：
  `'专业细节真实感：涉及物证、刑侦、医学、机械、地理等行业细节时，写出严密扎实的生活与专业细节，使其成为可信的情节依托'`
* **修订后**：
  `'专业细节与人性依托：物证与推理细节必须服务于人际关系和道德真相；每次关键取证都必须通过与当事人的语言交锋、微表情博弈或生活照护完成，严禁脱离人物的纯机械物料验看'`

---

## 五、 修订后最终处方清单（P0 / P1 分级）

### 🔴 P0 级（必须落地，直击根因，架构刚性约束）

| 编号 | 处方名称 | 落地目标文件 | 核心技术实现 |
|:---:|---|---|---|
| **P0-1** | **核心羁绊人物活体在场律** | [blueprint-chapters.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/blueprint-chapters.md)<br>[blueprint.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/blueprint.ts) | 蓝图生成指令硬约束：第一幕核心情感人物严禁物理死亡，必须作为活体在场与主角产生照护/依存关系。 |
| **P0-2** | **蓝图独立情感锚点字段** | [blueprint.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/blueprint.ts)<br>[chapter-generation-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts) | 在 `CHAPTER_ITEM_SCHEMA` 增加必填 `emotional_anchor` 字段，并在正文 Prompt 中作为独立要求单独注入，严禁挤在 summary 里。 |
| **P0-3** | **修正 Service 硬编码物证偏见** | [chapter-generation-service.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/services/chapter-generation-service.ts#L147) | 重构 L147 指令，将纯物证要求修正为“物证与人际博弈并轨”，铲除 v2 产生“解谜机器”的系统发源地。 |
| **P0-4** | **情感共鸣闸门下限设为 76 并加载对症反馈** | [writer.yml](file:///Users/reed_soul/code/novel-eval/packages/writer/src/config/writer.yml)<br>[config.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/config.ts)<br>[quality-gate.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/quality-gate.ts) | 在 `qualityGate` 新增 `minEmotionalResonance: 76`（高于 v2 的 74 失败线）；在 `buildFeedback` 中提供行为级诊断指令。 |

### 🟡 P1 级（重要改进，完善工程体系与体验）

| 编号 | 处方名称 | 落地目标文件 | 核心技术实现 |
|:---:|---|---|---|
| **P1-1** | **动作仪式化情感语法** | [writing-grammar.ts](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/writing-grammar.ts) | 新增`【情感靠动作落地】`，禁止抽象抒情与感叹回忆，用民间规矩、肢体动作和物什交互呈现情感尊严。 |
| **P1-2** | **主角主观道德亏欠绑定** | [blueprint-act.md](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/blueprint-act.md)<br>`packages/writer/src/bible/` | 在主角设定中强制注入“道德亏欠/救命代偿因果”，严禁设计客观中立、置身事外的纯解谜型主角。 |
| **P1-3** | **废除生产端双本取优** | 架构决策 | 严禁将 Best-of-2 作为管线常规运行机制；仅保留作为离线评测（Evaluation Benchmark）的手动对比参数。 |
| **P1-4** | **死模板彻底物理归档** | [prompts/](file:///Users/reed_soul/code/novel-eval/packages/writer/src/chapter/prompts/) | 将未接入 live path 的死模板（如 `chapter-first.md`）移动至 `legacy/` 或完全移除，杜绝提示词工程调试盲区。 |
