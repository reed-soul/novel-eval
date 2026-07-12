/**
 * Bible 生成 prompts — 雪花法 4 步的 prompt 模板
 *
 * 设计原则（来自调研）：
 *   1. 有意的上下文隔离：character_dynamics 不喂给 world_building，
 *      只有 plot_architecture 汇集全部——避免早期步骤被后期信息污染。
 *   2. 每步要求 JSON 输出（配合 callWithValidation 的 schema 校验）。
 *   3. 中文创作，prompt 用中文写规则。
 *
 * M1 用代码内常量；M2 起可迁 .md 文件（loadPrompt(name, dir)）。
 */

// ─── Step 1: 核心种子 ─────────────────────────────────────────────

export function coreSeedPrompt(topic: string, genre: string, audience: string): string {
  return `你是一位资深小说策划。请根据以下信息，用一句话提炼故事的核心种子。

【类型】${genre}
【目标受众】${audience}
【主题/创意】${topic}

要求用这个公式（25-100 字）：
当[主角]遭遇[核心事件]，必须[关键行动]，否则[灾难后果]；与此同时，[隐藏的更大危机]正在发酵。

要具体、有张力、有悬念，不要空话。

只输出 JSON：{"premise": "一句话核心种子"}`;
}

// ─── Step 2: 角色动力学 ───────────────────────────────────────────

export function characterDynamicsPrompt(coreSeed: string, audience: string): string {
  return `你是一位角色设计大师。基于以下核心种子，设计 3-6 个核心角色。

【核心种子】${coreSeed}
【目标受众】${audience}

每个角色必须包含：
- name: 角色名
- role: 定位（主角/反派/导师/挚友/...）
- background: 背景简介（含身份、来历）
- secret: 暗藏的秘密或致命弱点（推动冲突的关键）
- drives: 驱动力三角
    - surface: 表面追求（他以为自己想要的）
    - deep: 深层渴望（真正驱动他的）
    - soul: 灵魂需求（他需要学会的）
- arc: 角色弧光
    - start: 初始状态
    - trigger: 触发事件（打破初始状态）
    - shift: 认知失调/转变节点
    - end: 最终状态（蜕变后）
- relationships: 与其他角色的关系（至少 2 条）
    - target: 对象角色名
    - type: 关系类型（对手/盟友/师徒/暗恋/背叛可能...）
    - note: 关系说明（含价值观冲突点）

角色之间要有价值观冲突和隐藏的背叛可能，关系网要能产生张力。

只输出 JSON：{"characters": [上述角色数组]}`;
}

// ─── Step 2.5: 初始角色状态树 ────────────────────────────────────

export function characterStatePrompt(characterDynamicsJson: string): string {
  return `你是一位小说连贯性编辑。基于以下角色设计，生成每个角色的「初始状态树」。
这份状态树会在后续逐章生成时作为角色的「当前快照」被维护更新。

【角色设计 JSON】
${characterDynamicsJson}

对每个角色，生成初始状态（故事开始时的状态，能力/物品/关系都是起点）：
- name: 角色名（与上面一致）
- items: 初始持有物品（含简短描述，如 ["寒铁长剑(武器)：传承自父亲"]）
- abilities: 初始能力/技能（如 ["基础剑法", "过目不忘"]）
- status: 初始身体/心理状态（如 "健康，但背负家族仇恨，性格孤僻"）
- relationships: 初始主要关系（如 ["李四：表面盟友，实则各怀鬼胎"]）
- events: 初始已触发事件（通常为空 []，或开篇前的关键往事）

只输出 JSON：{"characters": [上述状态数组]}`;
}

// ─── Step 3: 世界观（三维度交织法）────────────────────────────────

export function worldBuildingPrompt(coreSeed: string, genre: string): string {
  return `你是一位世界观架构师。基于以下核心种子，构建三维度交织的世界观。
注意：你只看到核心种子，不要假设角色细节（角色信息会被有意隔离，避免污染世界观设计）。

【核心种子】${coreSeed}
【类型】${genre}

构建三个维度，每个维度要有能与角色决策互动的动态元素和内在张力：

1. physical（物理维度）：
   - elements: 空间结构/时间轴/法则体系中的动态元素（≥3 个，每个都能成为情节推动力）
   - tensions: 法则体系的漏洞/地理的天然断层/时间的紧迫性（≥3 个）

2. social（社会维度）：
   - elements: 权力结构/文化禁忌/经济命脉中的动态元素（≥3 个）
   - tensions: 权力断层线/阶层矛盾/资源争夺焦点（≥3 个）

3. metaphorical（隐喻维度）：
   - elements: 视觉符号系统/环境映射心理/建筑暗示（≥3 个）
   - tensions: 符号背后的潜台词/环境暗示的危机（≥3 个）

只输出 JSON：{"physical": {"elements": [...], "tensions": [...]}, "social": {...}, "metaphorical": {...}}`;
}

// ─── Step 4: 三幕式情节架构（汇集全部）────────────────────────────

export function plotArchitecturePrompt(
  coreSeed: string,
  characterDynamicsJson: string,
  worldBuildingJson: string,
): string {
  return `你是一位情节架构大师。现在汇集前面的全部成果，设计三幕式情节架构。
这是雪花法的最后一步，你看到的是完整的核心种子、角色动力学和世界观。

【核心种子】${coreSeed}

【角色动力学】
${characterDynamicsJson}

【世界观】
${worldBuildingJson}

设计三幕，每幕含铺垫/转折点/高潮，并埋设跨幕伏笔：

act1（触发幕）：
- setup: 第一幕的铺垫（如何开场、如何引入主角和核心矛盾）
- conflicts: 关键转折点（3 个，改变角色关系或推进主线）
- climax: 第一幕高潮（主角被迫踏上旅程/接受挑战）

act2（对抗幕）：
- setup: 第二幕的发展（主线与副线如何交织）
- conflicts: 关键转折点（3 个，含虚假胜利、灵魂黑夜）
- climax: 第二幕高潮（最大危机/真相揭露）

act3（解决幕）：
- setup: 第三幕的收束准备
- conflicts: 关键转折点（3 个，含最终对决、代价）
- climax: 最终高潮（主题升华、角色弧光完成）

foreshadows: 跨幕伏笔列表（每个含 description/setupAct埋设幕/resolveAct回收幕），至少 3 个，要能在故事后文回收。

只输出 JSON：
{"act1": {"setup":"...","conflicts":[...],"climax":"..."},
 "act2": {...}, "act3": {...},
 "foreshadows": [{"description":"...","setupAct":1,"resolveAct":2}, ...]}`;
}
