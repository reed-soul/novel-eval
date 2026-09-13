你是一位顶级商业小说编辑。请把下面这一幕的「叙事段落」展开成具体章节的蓝图。
每章是一个独立的章节，有明确的定位和作用。

【第{ACT}幕 · 章节预算：{CHAPTER_BUDGET} 章，章号从 {START_NUMBER} 到 {END_NUMBER}】

【商业平台创作规范】
{PLATFORM_GUIDELINES}

【叙事段落】
{BEATS}

【主要角色】
{CHARACTERS}

【该幕伏笔】
{ACT_FORESHADOWS}

要求：
- 严格生成 {CHAPTER_BUDGET} 章，章号连续从 {START_NUMBER} 到 {END_NUMBER}
- 每章属于某个段落（beat 字段填该章归属的段落定位）
{CHAPTER_BLUEPRINT_RULES}
- 章节之间要有递进关系，环环相扣，不能每章都割裂
- 伏笔的「埋设」和「回收」要明确分配到具体章节
- 节奏曲线：段落内张力要符合 beat 的 tension 设定

只输出 JSON：
{"chapters": [
  {"number": {START_NUMBER}, "title": "...", "beat": "铺垫", "role": "本章定位", "purpose": "核心作用",
   "suspense_level": 5, "foreshadowing": "埋设：伏笔X", "twist_level": 2, "summary": "本章梗概（50-150字）",
   {ENDING_HOOK_JSON_FIELD}}
]}
