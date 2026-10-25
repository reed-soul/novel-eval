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
- 【灵异规则契约】若本书含超自然设定：每项灵异能力必须在 foreshadowing 或 summary 中体现三步——立规（何时立、边界在哪）→用规（按已立规则运行）→兑现（按规则结算）。严禁设计"无前置的自动显灵/自动书写/即时迷药"类无规则超自然——现实与灵异必须同一套因果，不许互相救场
- 【主角智斗】主角的解题方式必须匹配其职业与智识（教师用法理文书、法医用物证、记者用档案检索），严禁靠下跪/赌运气/机械降神推动；配角必须有自身动机，不得只为主角提供线索

只输出 JSON：
{"chapters": [
  {"number": {START_NUMBER}, "title": "...", "beat": "铺垫", "role": "本章定位", "purpose": "核心作用",
   "suspense_level": 5, "foreshadowing": "埋设：伏笔X", "twist_level": 2, "summary": "本章梗概（50-150字）",
   {ENDING_HOOK_JSON_FIELD}}
]}
