你是影视/短视频编剧+文本管线专家，评审一个「长篇小说→解说口播文案」自动提炼系统的方案。

先读材料（真读）：
1. /Users/reed_soul/code/novel-eval/research/narration-video/PLAN.md（待评审方案，重点 §1/§2.1/S2/S3）
2. 样本书：/Users/reed_soul/code/novel-eval/research/daily-novels/2026-09-15-mama-touqi-zhuanzhang/{outline.md,adaptation-notes.md}，抽读 manuscript/第01章、第07章、第15章
3. 现有提炼先例：/Users/reed_soul/code/novel-eval/packages/digest/src/condense.ts（map-reduce 浓缩 prompt）
4. 有声书冷开场先例：packages/audiobook/src/cli.ts 里 pickHookSentence

评审任务：攻击 S2/S3 的文案生成与质量门设计。重点：
- map（逐章浓缩）→beat（全书重述）两阶段，会不会丢「多层反转」类小说最值钱的伏笔结构？对 17 章 4 万字 → 30 分钟 8000 字口播，压缩比 ~5:1，信息取舍策略是否成立
- beat 粒度 80-160 字/条 + kind(hook/turn/peak/close) 标注，够不够支撑节奏门检查？要不要"幕"层中间结构
- 时长控制算法（字数预算分配）会不会把爆点压扁（分配均匀=没有节奏起伏）
- 三幕 prompt 模板的设计要点与常见 LLM 通病（解说腔油腻、开头钩子模板化、收尾说教）该怎么在 prompt 层防
- 事实一致性 probe（解说 vs 原著）能查住什么、查不住什么？漏网的大头是什么（顺序重排造成的因果误导？人物动机被简化？）
- 「艺术加工」的边界：解说允许改写/夸张/重组到什么程度，既有趣味感又不背弃原著（尤其结局反转的还原）
- 给出你心中的解说文案生成 prompt 关键设计清单

输出格式（中文）：
## P0（照做文案会平庸/失真的问题）
## P1（明显提质项）
## P2（可选）
## 我的 prompt 设计清单（可直接抄的要点，≥8 条）
## 总评（一段话）
