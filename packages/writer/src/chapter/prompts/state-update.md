你是资深小说连贯性与故事世界线编辑。请根据本章新内容，对比【前情世界状态】，提取本章带来的状态增量变化（Story State Delta）。

【前情世界状态】
{OLD_STATE}

【本章正文】
{CHAPTER_TEXT}

提取要求（严格遵守）：
1. 【summary】：本章核心剧情摘要（50-150字），概括本章推进的核心事实、冲突与转折。
2. 【characterChanges】：角色增量变更：
   - 新登场角色用 kind="add"：id 须唯一（如 "char-角色名拼音"），name 为角色名，status 必须为 "alive"|"injured"|"missing"|"dead"，facts 为该角色的关键设定列表（身份、重要物品持有、特征等，每条≤20字）。
   - 已有角色发生变化用 kind="update"：characterId 对应角色 id，patch 包含 kind（"set-name"|"set-status"|"replace-facts"）。
   - 角色彻底离场或确认死亡移除用 kind="remove"：给出 reason。
3. 【factChanges】：世界线与不可动摇事实的增删：
   - 本章确凿发生、不可推翻的关键事件或物证发现用 kind="add"（例如："东墙内发现苏文远铁盒，内含发脆照片与胶卷"、"周岚确认为文检法医"）。
   - 前文误导性结论被证伪或推翻用 kind="remove"：fact 填写要移除的旧事实，reason 填写推翻原因。
4. 【foreshadowChanges】：伏笔生命周期追踪：
   - 本章新埋设的伏笔用 kind="open"：foreshadow 对象包含 id（如 "fs-核心关键词"）和 description（伏笔具体内容）。
   - 本章回收解开的伏笔用 kind="resolve"：foreshadowId 为之前已埋设伏笔的 id。
5. 【timelineEvents】：本章明确的时间线物理事件（包含具体时间点、地点、事件，如："一九九八年十二月十五日上午08:07，局址候车室发生爆炸"）。

只输出合法 JSON，禁止包含 markdown 代码块外的任何前言或解释：
{
  "summary": "本章核心事件摘要...",
  "characterChanges": [
    {
      "kind": "add",
      "character": {
        "id": "char-zhangsan",
        "name": "张三",
        "status": "alive",
        "facts": ["刑警队长", "配枪一把", "患有慢性胃病"]
      }
    }
  ],
  "factChanges": [
    {
      "kind": "add",
      "fact": "在老车站东墙夹层内起获苏文远铁盒"
    }
  ],
  "foreshadowChanges": [
    {
      "kind": "open",
      "foreshadow": {
        "id": "fs-train-schedule",
        "description": "调度令上的发车时间有手工刮改痕迹"
      }
    }
  ],
  "timelineEvents": [
    {
      "event": "1998年12月15日上午08:07，候车室火墙被炸开"
    }
  ]
}
