# 评审任务书：解说视频管线 M3（Web 自助层）代码评审

你是外部独立评审。请对 novel-eval 仓库（pnpm monorepo，当前工作区即评审对象，未提交改动就是被评审代码）的「解说视频 M3」实现做**代码级评审**：判断方案是否最佳、代码是否有 bug。不要客套，直接挑毛病；拿不准的标注"待验证"。

## 背景（30 秒版）

- 仓库：AI 网文写作+衍生产品 monorepo。已有「有声书」管线（packages/audiobook + web 路由）与「短篇」管线。
- 本次新增第三衍生形态「解说视频」：packages/narration（M1 文案四阶段+双门禁、M2 定妆照/Seedream 参考图分镜/beat 精确渲染，已验收：全片 931s 漂移 31ms、45/45 分镜零 fallback）。
- **M3（本轮评审对象）** = Web 自助层：建线、五步任务流（script/audio/sheets/scenes/render）、定妆照批准门、发布检查单、多维成本台账、发布物料，以及跨路由全局渲染锁。
- 此前外部评审定下的硬约束（勿推翻，除非有硬理由）：ffmpeg 渲染全仓串行（16GB Mac 并行压死先例）；渲染锁必须跨 audiobook/narration 两路由共享（工程评审 P0）；安全模式对齐 audiobook 路由先例（用户输入永不构成 fs 路径、spawn 白名单、产物根必须落 dist/ 内）。

## 评审文件清单（绝对路径基准 = /Users/reed_soul/code/novel-eval）

新增：
- packages/web/server/lib/render-lock.ts（全局渲染锁单例）
- packages/web/server/routes/narration.ts（解说路由：状态扫描/建线/任务/approve/checklist/cost）
- packages/narration/src/registry.ts（登记 + 多维成本台账）
- packages/web/src/pages/BookNarration.tsx（五步向导 + 任务台 + 成品页）

修改：
- packages/web/server/routes/audiobook.ts（currentJobId 私有锁 → 改用全局 render-lock；对照重点：行为是否等价、有无回归面）
- packages/narration/src/cli.ts（新增 recordUsage 各阶段写 usage.json；评审点：audio 阶段 chars 统计口径）
- packages/web/server/index.ts（路由挂载 + /media 静态服务修复）
- packages/web/vite.config.ts（补 /media 代理）
- packages/web/src/components/BookTabs.tsx、packages/web/src/main.tsx（tab 与路由接线）

关联上下文（可读，勿深审）：packages/narration/src/{script,gates,audio,images,render}.ts、packages/web/server/lib/pipeline-spawn.ts、packages/web/server/routes/digest.ts（同期先例）。

## 已做过的验证（不必重复，但可抽查）

- 全仓 typecheck 0 错；单测 354/354 过（narration 6/web 49）。
- 线上集成：建线→状态全量派生（5 序列 45 拍/双门绿/8 定妆照/45 分镜/931s 成片）；解说渲染中有声书构建被 409 拒（跨路由锁实证）；成本 render 条目落账；无头 Chrome DOM 断言（5 步/8 角色卡/4 video/检查单）。
- /media 字节级：jpg 200（291KB）、mp4 Range 206、`/media/../writer/writer.db` 与 %2e%2e 变体返回 SPA HTML（fetch 层规范化+serveStatic 解码守卫，无文件泄露）。

## 评审问题（按优先级）

1. **锁与并发**：render-lock.ts 进程内单例是否够？考虑：server 崩溃/重启时锁自然释放是否引入双渲染窗口；POST /jobs 里"check lock → acquire"之间的 await 间隙（c.req.json()）是否有 TOCTOU；audiobook.ts 重构后 close/error/cancel/regen 四条路径的释放是否全覆盖、有无泄漏路径。
2. **安全**：narration.ts 的参数白名单、registryRoot 越界防护、approve 端点 ids 正则、checklist 写入路径、mediaUrl 编码——与 audiobook 路由先例比对，有没有audiobook 堵了而 narration 没堵的面？特别是 outRoot 正则 `^dist\/[\w\u4e00-\u9fff/-]{3,120}$` 是否可被 `..` 或符号链接绕过（对照 audiobook 的越界双保险）。
3. **状态派生健壮性**：scanOutRoot 对损坏 JSON、半成品（有 timed 无 script、有 scenes 无 characters）、并发写文件（任务运行中前端轮询 GET）的容错；probeDurationMs 的 ffprobe execFileSync 在请求路径上同步阻塞 event loop 的代价（多大的代价？audiobook 先例同款，是否该异步化）。
4. **前端**：BookNarration.tsx 的派生状态逻辑（scriptReady/gates/audioReady/sheetsReady/scenesReady）与后端实际语义是否一致；轮询 useEffect 依赖 [job, load] 而 load 依赖 job（useCallback [bookId, job]）——依赖数组变化导致的轮询重建/泄漏；activeJob 采纳逻辑（!job 时才采纳）会不会吞掉刷新时已在跑的任务的日志。
5. **架构与重复**：narration.ts 的 job 执行器/SSE/cancel 与 audiobook.ts 几乎逐行重复（~120 行）——该不该抽 packages/web/server/lib/job-runner.ts 公共模块？抽的收益/风险怎么权衡？render-lock 与 job map 的双源真相（jobs Map + 锁 holder）是否有更干净的单一事实设计？
6. **成本台账**：schema（llmCalls/ttsChars/images/durationMs/cost 三列）与落账时机（任务成功后读 usage.json）是否合理；单价口径 llm ¥0.1/次·tts ¥2/万字·图 ¥0.15/张（标注"保守估算"）是否该做成配置而非常量；同一 stage 重跑会重复落账——这算 bug 还是特性？
7. **/media 修复**：rewriteRequestPath 剥前缀方案 vs Hono 官方推荐姿势（如 app.use('/media/*', serveStatic({root:'./dist/media'})) 或 path 重写）——有没有更标准/更不易回归的写法？vite 代理补丁是否完整（WebSocket/HMR 有没有被误伤）？
8. **CLI usage.json**：recordUsage 的合并语义（每次覆盖该 stage 键）在重跑部分阶段时账会不会算重/算漏（与路由 billJob 从 usage.json 读数的组合）。

## 输出要求

- 写入你自己的输出文件（任务书末尾指认，勿写别的文件）。
- 结构：① 总评（方案是否最佳、可否上线）② P0 必须修 / P1 应该修 / P2 可选——每条带 file:line、问题陈述、最小修法 ③ 对上述 8 个问题的逐一简答 ④ 你验证过什么（跑了什么命令）。
- 只许读仓库与跑只读命令（cat/grep/ls/rg/typecheck/单测）。**禁止**：跑任何渲染/ffmpeg/生图/TTS 任务、改仓库任何文件（你的输出文件除外）、git 写操作。
