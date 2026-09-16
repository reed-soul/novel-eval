你是资深全栈架构师，受聘对一个 monorepo 内的新管线方案做「工程红队评审」。仓库：/Users/reed_soul/code/novel-eval（pnpm workspace）。

先读这些材料（务必真读，不要凭空想象）：
1. 待评审方案：research/narration-video/PLAN.md
2. 依赖现状：packages/audiobook/src/{cli.ts,tts/volcengine.ts,tts/cache.ts,video.ts,srt.ts,episode.ts,registry.ts,project-config.ts,gen-scenes-ark.ts}、packages/digest/src/condense.ts、packages/shared/src/{derivative-work.ts,engine/}、packages/web/server/routes/{audiobook.ts,digest.ts}、packages/web/server/lib/pipeline-spawn.ts
3. 契约先例：data/audiobook/registry.json、data/digest/registry.json（如有）

评审任务：攻击这份方案的工程决策，找出「照着做会返工/会翻车」的点。重点：
- packages/narration 跨包 import audiobook 内部模块的可行性（tsconfig/project references、exports、循环依赖风险）；audiobook 的 tts/video 模块是否干净可复用，还是需要先抽公共层
- NarrationScript beat 数据结构是否足以支撑 S4-S6（时长控制、时间轴对齐、字幕、缓存粒度）
- 定妆照→参考图生图的流程状态管理（角色册版本化、参考图与分镜的关联、重生成时缓存失效）
- Web spawn 模式 vs digest 进程内直跑的选择是否正确；SSE/串行锁复用是否有坑
- 成本台账、registry、发布检查单复用方式的漏洞
- 里程碑切分是否真能增量验收
- 你发现的任何其他风险

输出格式（中文）：
## P0 必须改（照做会翻车）
每条：问题 → 证据（文件:行） → 改法
## P1 强烈建议
同格式
## P2 可选
## 总评
一段话：这个方案能否开工，最关键的一个前置条件是什么。
要求：具体、可执行、不要客套。宁枉勿纵。
