# 解说视频管线 M3（Web 自助层）独立代码评审报告

- **评审员**：外部独立架构评审员
- **评审对象**：`novel-eval` 仓库工作区解说视频 M3（Web 自助层）代码实现
- **评审基准**：Git 未提交改动（当前工作区代码）
- **评审时间**：2026-09-15

---

## 一、总评：方案是否最佳、可否上线？

### 1. 方案评估
- **架构方向正确，业务闭环度高**：五步向导流（文案双门 → 句级配音 → 定妆照批准门 → 参考图分镜 → 成片渲染）逻辑链条完整，从产物派生状态（禁独立状态机）的设计原则执行坚决；跨路由渲染排他锁（`render-lock.ts`）抓住了 16GB Mac 机器的核心瓶颈。
- **但目前方案“并非最佳”，存在严重的实现粗糙与设计借贷**：
  1. **锁粒度混淆**：把“防止 ffmpeg 并行压死 Mac 的渲染锁”直接扩大化为“全流水线互斥锁”。解说视频的文案提炼（纯 LLM 跑 2 分钟）期间，整个有声书管线被完全锁死。
  2. **并发/生命周期漏洞**：进程先 `spawn` 后占锁；取消任务过早释放锁；`scene-regen` 端点存在显式 TOCTOU 竞态。
  3. **数据一致性致命 Bug**：发布检查单（`publish-checklist.json`）在后端 `PUT` 每次只写传入的单个 key，导致勾选新项直接抹除已勾选项（刷新即丢）。
  4. **状态机翻转 Bug**：前端所有 5 步向导卡片在重跑已完成阶段时，因三元表达式优先级错误，界面恒定显示“已完成”而非“进行中”。
  5. **大量代码逐行重复（~120 行）**：`narration.ts` 与 `audiobook.ts` 几乎整段复制粘贴了子进程 stdout 处理、SSE 事件分发与取消逻辑。

### 2. 结论：**【暂不可上线，必须修复 P0 后方可合入】**
核心业务跑通值得肯定，但当前代码存在 **数据丢失（Checklist 覆盖）**、**孤儿进程逃逸与并行渲染击穿（先 spawn 后占锁 + 取消过早释放）**、**TOCTOU 竞态崩溃（scene-regen）** 以及 **前端步骤状态永远无法展示 running 态** 4 项硬阻断性缺陷（P0）。必须完成 P0 项最小修复并补全回归测试后，方可正式合入主干。

---

## 二、问题清单（按严重级别）

### 【P0 必须修】（阻塞上线 / 数据丢失 / 进程失控）

#### 1. [P0-1] Checklist 数据被单键覆盖丢失（数据丢失 Bug）
- **位置**：[packages/web/server/routes/narration.ts:513-521](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L513-L521) 对照 [packages/web/src/pages/BookNarration.tsx:128-133](file:///Users/reed_soul/code/novel-eval/packages/web/src/pages/BookNarration.tsx#L128-L133)
- **问题陈述**：
  前端 `toggleCheck` 每次点击单个复选框发送单个键值对（如 `{ 'title-copied': true }`）。
  后端 `PUT /books/:bookId/checklist` 处理时，初始化了空白对象 `const state: Record<string, boolean> = {};`，**未读取磁盘已有的 `publish-checklist.json`**，直接将仅含这一个 key 的 `state` 序列化写盘。用户勾选第二项时，第一项被物理抹除；刷新页面后，之前勾选的历史状态全部丢失。
- **最小修法**：
  在遍历 `CHECKLIST_KEYS` 赋值前，先回读旧文件做合并：
  ```ts
  const file = join(registryRoot(rec), 'publish-checklist.json');
  let state: Record<string, boolean> = {};
  try { state = JSON.parse(readFileSync(file, 'utf-8')); } catch { /* 首次 */ }
  for (const k of CHECKLIST_KEYS) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== 'boolean') return c.json({ error: `${k} 需为布尔` }, 422);
      state[k] = body[k] as boolean;
    }
  }
  writeFileSync(file, JSON.stringify(state, null, 1), 'utf-8');
  ```

#### 2. [P0-2] 进程先 Spawn 后占锁，占锁失败遗留不受控孤儿渲染进程
- **位置**：
  - [packages/web/server/routes/narration.ts:114-121](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L114-L121)
  - [packages/web/server/routes/audiobook.ts:229-237](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/audiobook.ts#L229-L237)
  - [packages/web/server/routes/audiobook.ts:810-811](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/audiobook.ts#L810-L811)
- **问题陈述**：
  在 `startNarrJob`、`startJob` 和 `scene-regen` 三处，代码逻辑均为：
  `runPipeline()`（**内部已调用 `spawn` 启动 OS 子进程**）→ `acquireRenderLock()`。
  若 `acquireRenderLock` 发现锁冲突并抛出 `RENDER_LOCK_BUSY` 异常，子进程**已经启动并在后台脱轨运行**！因为未将其包装并加入 `jobs` Map，调用方虽然返回了 409 或 500，但 OS 中有一个完全无人管控的 ffmpeg/pipeline 进程在死命吃 CPU/内存，彻底击穿了全仓串行保证。
- **最小修法**：
  必须先占锁、再 spawn；若 spawn 阶段抛错，在 catch/finally 中回滚释放锁：
  ```ts
  acquireRenderLock(id, KIND);
  let childProcess;
  try {
    const { child, argv } = runPipeline(argsFile, REPO_ROOT);
    childProcess = child;
    ...
  } catch (err) {
    releaseRenderLock(id);
    throw err;
  }
  ```

#### 3. [P0-3] `audiobook.ts` 的 `scene-regen` 端点存在 TOCTOU 竞态且无 try-catch
- **位置**：[packages/web/server/routes/audiobook.ts:799-811](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/audiobook.ts#L799-L811)
- **问题陈述**：
  在 `POST /books/:bookId/scene-regen` 中：
  第 799 行检查 `const busy = busyPayload(); if (busy) return c.json(busy, 409);`。
  第 801 行紧接着执行异步 `const body = await c.req.json(...)`。
  在 `await` 悬挂期间，另一个解说或有声书请求完全可以切入并占领全局渲染锁。当 `scene-regen` 从 await 恢复时，**没有任何二次检查**，直接调用 `runSceneRegenJob` 启动 Python 子进程，随后调用 `acquireRenderLock` 触发抛错。
  且此处未加 try-catch，导致接口向前端喷出 500 Internal Server Error，而 Python 生图进程已经在后台并发运行。
- **最小修法**：
  将 `c.req.json()` 解析移至锁检查之前；或者在 `runSceneRegenJob` 之前再次检查 `busyPayload()`，并用 try/catch 包裹 `acquireRenderLock`。

#### 4. [P0-4] 取消任务同步释放渲染锁，造成新老任务重叠双渲染窗口
- **位置**：
  - [packages/web/server/routes/narration.ts:489-493](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L489-L493)
  - [packages/web/server/routes/audiobook.ts:756-760](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/audiobook.ts#L756-L760)
- **问题陈述**：
  在 `POST /jobs/:id/cancel` 中，调用 `j.child?.kill('SIGTERM')` 后，立即在下一行同步执行了 `releaseRenderLock(j.id)`。
  但 ffmpeg/Node 子进程收到 SIGTERM 并不会瞬时退出，系统为其预留了高达 4 秒的退出宽限期（`setTimeout(() => j.child?.kill('SIGKILL'), 4000)`）。此时前端如果立即点击“重新渲染”，由于锁已被释放，新任务会立即启动。
  结果就是：**正在退出中的旧 ffmpeg 进程与刚启动的新 ffmpeg 进程在长达数秒内同时跑在 16GB Mac 上**，直接违背了“绝对串行”的承诺。
- **最小修法**：
  `cancel` 路由只负责发送信号，**不要同步调用 `releaseRenderLock(j.id)`**。让子进程真实的 `child.on('close')` 回调去执行 `releaseRenderLock(job.id)`。当进程真正从 OS 消失时，锁才会自然交出。

#### 5. [P0-5] 前端步骤状态机三元表达式次序倒置：重跑步骤恒定显示“已完成”而非“进行中”
- **位置**：[packages/web/src/pages/BookNarration.tsx:241, 264, 273, 295, 304](file:///Users/reed_soul/code/novel-eval/packages/web/src/pages/BookNarration.tsx#L241)
- **问题陈述**：
  向导中 5 个步骤卡片的状态计算，均把“产物就绪（ready/done）”写在了“当前运行中（running）”之前。以第 1 步为例：
  `scriptReady ? (gates?.passed ? 'done' : 'ready') : busy && job?.action === 'script' ? 'running' : 'ready'`
  当用户已经生成过一次脚本（`scriptReady === true`），点击“重新提炼”时，三元表达式第一分支命中，返回 `'done'`，**永远无法进入 `busy && job?.action === 'script'` 分支**。第 2 步（配音）、第 3 步（定妆）、第 4 步（分镜）、第 5 步（成片）全有同样的问题！导致用户点击重跑任何一步时，卡片永远是绿色的“已完成”，无任何 spinning 动效，误以为点击没有生效。
- **最小修法**：
  将 `busy && job?.action === '...'` 的运行态检查**置于最顶层优先判断**：
  ```ts
  // Step 1:
  busy && job?.action === 'script' ? 'running' : scriptReady ? (gates?.passed ? 'done' : 'ready') : 'ready'
  // Step 2:
  busy && job?.action === 'audio' ? 'running' : audioReady ? 'done' : scriptReady ? (gates?.passed ? 'ready' : 'blocked') : 'blocked'
  // Step 3:
  busy && job?.action === 'sheets' ? 'running' : sheetsReady ? (st.script!.approvedAll ? 'done' : 'ready') : scriptReady ? 'ready' : 'blocked'
  // Step 4:
  busy && job?.action === 'scenes' ? 'running' : scenesReady ? 'done' : st.script?.approvedAll ? 'ready' : 'blocked'
  // Step 5:
  busy && job?.action === 'render' ? 'running' : st.video ? 'done' : scenesReady && audioReady ? 'ready' : 'blocked'
  ```

---

### 【P1 应该修】（架构设计借贷 / 健壮性隐患 / 数据失真）

#### 1. [P1-1] 全局渲染锁粒度过粗：非渲染步骤（LLM/TTS/生图）全占锁，导致管线盲锁
- **位置**：[packages/web/server/routes/narration.ts:406-437](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L406-L437)
- **问题陈述**：
  此前工程评审确立的约束是：“`ffmpeg 渲染全仓串行（16GB Mac 并行压死先例）`”。
  但在 `narration.ts` 中，只要调用 `startNarrJob`，不管 action 是 `script`（纯 LLM 文本生成，耗时 1~2 分钟）、`audio`（调用火山 TTS API）、`sheets`（Seedream API 文生图）、`scenes`（Seedream API 分镜图），全部都调用了 `acquireRenderLock(id, KIND)`。
  这导致用户在解说界面点“提炼解说文案”时，有声书那边的构建和场景重绘全部被 409 拦截，报 `解说视频任务在跑（渲染必须串行）`。纯 API 网络 I/O 任务冒充重度多媒体渲染锁，严重劣化系统并发体验。
- **最小修法**：
  解说管线内部的任务串行应用路由局部的 `currentJobId` 或书级锁控制；`acquireRenderLock` 全局排他锁**应当仅在 `action === 'render'`（即真正调起 ffmpeg 渲染正片与切片）时才持有**。

#### 2. [P1-2] 前端 `load` 与 `useEffect` 循环依赖引起高频轮询重绑
- **位置**：[packages/web/src/pages/BookNarration.tsx:68-96](file:///Users/reed_soul/code/novel-eval/packages/web/src/pages/BookNarration.tsx#L68-L96)
- **问题陈述**：
  `load` 的 `useCallback` 依赖数组包含了 `[bookId, job]`；轮询 `useEffect` 依赖了 `[job, load]`。
  每当轮询触发 `setJob({ ...job, ...j })` 更新日志行时，`job` 发生变化 → `load` 重新生成 → `useEffect([load])` 立即执行（打两次 HTTP 请求拉状态和成本）→ 轮询 `useEffect([job, load])` 销毁当前定时器并重建。
  造成每 2 秒就会触发一波连环重绑与不必要的全量状态拉取。
- **最小修法**：
  `load` 内只在无 job 时采纳 `activeJob`，改用函数式更新 `setJob(prev => (!prev && s.activeJob ? ... : prev))`，使 `load` 的依赖彻底解耦为仅依赖 `[bookId]`。

#### 3. [P1-3] 后端已实现 SSE 流，前端却退化为 2s 轮询 HTTP，且服务端与有声书逐行重复 ~120 行
- **位置**：
  - [packages/web/server/routes/narration.ts:458-483](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L458-L483)
  - [packages/web/src/pages/BookNarration.tsx:85-96](file:///Users/reed_soul/code/novel-eval/packages/web/src/pages/BookNarration.tsx#L85-L96)
  - 对照 [packages/web/src/pages/BookAudiobook.tsx:68-80](file:///Users/reed_soul/code/novel-eval/packages/web/src/pages/BookAudiobook.tsx#L68-L80)
  - 对照 [packages/web/server/routes/audiobook.ts:186-271](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/audiobook.ts#L186-L271)
- **问题陈述**：
  服务端在 `narration.ts:458` 专门写了 26 行极其规范的 `GET /jobs/:id/stream` SSE 端点。
  更有力的是证据是：**开发分支在 `BookAudiobook.tsx:68` 甚至已经修改并导出了带 `basePath = '/api/audiobook'` 参数的通用 `JobConsole` 组件**（明确注释“`导出供集详情页/解说 tab 复用。basePath 默认有声书；解说传 '/api/narration'`”）。
  然而到了 `BookNarration.tsx`，前端开发者却完全没接这根线，反手自己写了一套低频的 `setInterval(..., 2000)` HTTP 轮询（`narr-console`）！
  同时，服务端 `narration.ts` 与 `audiobook.ts` 内部对子进程 stdout `feed`（ANSI 剥离、2000 行环形缓冲、Emitter 触发）、日志查阅、SSE 推流、cancel 杀进程的代码几乎逐行重复（~120 行）。
- **最小修法**：
  1. 服务端抽象公共模块 `packages/web/server/lib/job-runner.ts` 统领进程生命周期与 SSE。
  2. 前端 `BookNarration.tsx` 直接引入现成的 `JobConsole`，传 `basePath="/api/narration"`，彻底删掉脆弱的 `setInterval` 轮询逻辑。

#### 4. [P1-4] `cli.ts` 的 `usage.json` 统计口径不准，重跑存在幽灵成本
- **位置**：[packages/narration/src/cli.ts:118, 143](file:///Users/reed_soul/code/novel-eval/packages/narration/src/cli.ts#L118)
- **问题陈述**：
  1. 定妆照阶段：`images.ts:62` 的 `generateCharacterSheets` 函数明确在注释中注明并返回了“本次真实生图数（缓存命中不计）”，但 `cli.ts:143` 却写死为全量角色的数组长度：`recordUsage(outDir, 'sheets', { images: script.characters.filter((c: any) => c.sheetFile).length })`。如果 8 张图全部命中缓存，账本仍然记入 8 张生图费用（¥1.2）。
  2. 配音阶段：`cli.ts:118` 的 `ttsChars` 直接把整本脚本的所有汉字数算作消费，完全忽略了 TTS 缓存的存在。
- **最小修法**：
  - `cmdSheets` 采纳 `generateCharacterSheets` 的返回值：`const count = await generateCharacterSheets(...); recordUsage(outDir, 'sheets', { images: count });`。
  - `buildAudio` 返回 `synthesizedChars`（实际送往火山合成的字数，命中缓存记 0），`cli.ts` 据此落账。

#### 5. [P1-5] `probeDurationMs` 在 HTTP GET 路径上无超时同步执行 `execFileSync`
- **位置**：[packages/web/server/routes/narration.ts:65-76](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L65-L76)
- **问题陈述**：
  `scanOutRoot` 在每次用户刷新或请求 `GET /books/:bookId` 时，冷启动下会对 mp3、正片 mp4 以及所有 `short-*.mp4` 逐一执行 `execFileSync('ffprobe', ...)`。
  该方法不仅阻塞 Node.js 事件循环（冷态下累积阻塞 150~350ms），且**未配置任何 timeout**。一旦某个 mp4 正处于 ffmpeg 尚未写完 moov atom 的瞬间，ffprobe 极易陷入挂起，导致单线程 Web 服务彻底卡死，拒绝所有后续 HTTP 请求。
- **最小修法**：
  在 `execFileSync` 参数中强加超时控制 `{ encoding: 'utf-8', timeout: 2000 }`；同时成片与音轨时长优先从各阶段已落盘的 `script.timed.json` 与 `usage.json` 回读，避免在 GET 路径上高频打探。

#### 6. [P1-6] `scanOutRoot` 缺乏对半成品/异常 JSON 的防空校验
- **位置**：[packages/web/server/routes/narration.ts:244-247](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L244-L247)
- **问题陈述**：
  在 `script` 任务进行中，如果前端轮询触发 `scanOutRoot`，此时 `script.json` 可能刚被建好但 `sequences` 字段尚未写完（或者格式半损坏）。代码中直接使用：
  `const beats = script?.sequences.flatMap((q) => q.beats) ?? [];`
  若 `script` 为 `{}`，`script.sequences` 为 undefined，执行 `.flatMap()` 会当场抛出 `TypeError: Cannot read properties of undefined (reading 'flatMap')`，引发服务端 500 崩溃。
- **最小修法**：
  增加可选链与防御性数组判断：`const beats = script?.sequences?.flatMap((q) => q?.beats ?? []) ?? [];`。

---

### 【P2 可选】（边界防御与代码洁癖）

1. **[P2-1] `approve` 端点对非数组 `ids` 未做校验，误把非法输入当作“全量批准”**
   - **位置**：[packages/web/server/routes/narration.ts:368-372](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L368-L372)
   - **说明**：当用户传入 `{ ids: "c-zhou" }`（传了字符串而非数组）时，`Array.isArray(body.ids)` 为 false，导致 `ids` 保持 `null`。而后端判定 `!ids` 为真，结果变成了全量批准。建议显式报错：`if (body.ids !== undefined && !Array.isArray(body.ids)) return c.json({ error: 'ids 必须为数组' }, 422);`。
2. **[P2-2] Shorts 列表按字符串字母序排序，在大于 9 条切片时错位**
   - **位置**：[packages/web/server/routes/narration.ts:269](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L269)
   - **说明**：`readdirSync(root).filter(...).sort()` 采用字符串默认字典序，若切片达到 10 条，`short-10.mp4` 会排在 `short-2.mp4` 前面。应改为数字提取排序：`.sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))`。
3. **[P2-3] CLI `outDirOf` 与 Web `setupNarrationLine` 的 slugify 逻辑存在分裂**
   - **位置**：[packages/narration/src/cli.ts:54-57](file:///Users/reed_soul/code/novel-eval/packages/narration/src/cli.ts#L54-L57) 对照 [packages/web/server/routes/narration.ts:49-52](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L49-L52)
   - **说明**：Web 路由建线时用了 `slugify(title)` 过滤掉特殊标点与空格；而 CLI 默认 `outDirOf` 直接使用书名原文字符串。在不传 `--out` 时直接跑 CLI 可能找不到 Web 建立的目录。
4. **[P2-4] 内存 `jobs` Map 缺乏 LRU 或容量上限控制**
   - **位置**：[packages/web/server/routes/narration.ts:105](file:///Users/reed_soul/code/novel-eval/packages/web/server/routes/narration.ts#L105)
   - **说明**：长期运行下，`jobs` Map 持续常驻已结束的 Job 对象及其 2000 行日志缓存，建议保留最近 50~100 个任务即可。

---

## 三、八大评审问题逐一解答

### 1. 锁与并发
- **进程内单例是否足够？Server 崩溃/重启时是否引入双渲染窗口？**
  - **不足以防御进程外部的孤儿进程**：如果 Node.js Web 服务被热重启或异常崩溃，内存中的 `holder` 会直接重置为 `null`；但此前由 Node 派生的底层 `ffmpeg` 进程属于独立的 OS 进程，可能仍在后台疯狂占用 GPU/CPU。此时新服务启动后接收到新的渲染指令，将判定锁为空闲，从而立即唤起第二个 ffmpeg 实例，直接击穿 16GB 内存底线。
  - **建议防御**：在进程退出钩子（`process.on('SIGINT'/'SIGTERM')`）中清理子进程树；或将持锁状态关联 PID 落临时文件（如 `data/.render.pid`），服务重启时探查对应 PID 是否存活。
- **POST /jobs 里的 check lock → acquire 之间是否有 TOCTOU？**
  - 在 `narration.ts` 的 `POST /jobs` 中，由于 `await c.req.json()` 发生在 `renderLockActive()` 之前，后续直到调用 `acquireRenderLock()` 全程为同步代码，在单线程 Node 事件循环中**不存在**微任务切入隙缝，因此 narration 本路由内部没有 TOCTOU。
  - **但在 `audiobook.ts` 的 `scene-regen` 端点存在明确的 TOCTOU**（见 P0-3）：其先在同步阶段查锁，中间被 `await c.req.json()` 打断，后续未复核直接 spawn。
- **audiobook.ts 重构后 close/error/cancel/regen 释放是否全覆盖？有无泄漏？**
  - **覆盖面存在严重泄漏与并发漏洞**：
    1. `cancel` 在执行 `j.child?.kill('SIGTERM')` 时**同步**释放了全局锁，此时底层进程未真正退出，导致“取消后立即重建”产生双渲染重叠窗口（见 P0-4）。
    2. `scene-regen` 的子进程**完全没有监听 `error` 事件**（仅监听了 `close` 与 `onDone`）。一旦派生阶段报错，锁将无法在 `error` 回调中释放，造成锁死。

### 2. 安全
- **对比 audiobook 先例，narration 有没有遗漏的攻击面？**
  - **整体防御体系高度对齐**：`bookId` 校验、`outRoot` 根目录防越界（`distAbs + sep` 双保险）、`checked` 逐项正则且严禁前导 `-`（防参数选项注入）、参数经随机 UUID 文件（`.job-${id}-args.json`，权限 `0o600`）落盘中转并读后即焚。
- **outRoot 正则 `^dist\/[\w\u4e00-\u9fff/-]{3,120}$` 是否可被 `..` 或符号链接绕过？**
  - **无法被 `..` 绕过**：正则字符集为 `\w`（仅字母数字下划线）、中文范围、`/` 和 `-`，**排除了 `.`（点）**，因此包含 `..` 的路径会在正则层被直接拒绝。
  - **符号链接风险**：Node 的 `path.resolve` 仅做路径字符串归一化，不解析真实符号链接。如果有人在 `dist/` 内部手工建立了指向仓库外部的 symlink（如 `dist/derivatives/evil -> /etc`），`registryRoot` 的前缀比对仍会通过。若要实现军工级防御，可在目录已存在时调用 `realpathSync` 验证真实落点。

### 3. 状态派生健壮性
- **scanOutRoot 对损坏 JSON、半成品、并发写的容错**：
  - 目前仅依靠 `loadJson` 外围的 `try/catch`。一旦遇到并发写入导致的半成品 JSON（例如被格式化为 `{}` 的对象），代码中无保护的 `script.sequences.flatMap(...)` 会因 TypeError 导致整条 GET 崩溃（见 P1-6）。
- **probeDurationMs 的 ffprobe execFileSync 同步阻塞 event loop 的代价与是否该异步化**：
  - **代价测算**：单次 `ffprobe` 耗时约 30~80ms。当解说视频包含成片 + 3 条 Shorts + 1 条 mp3 时，首次或缓存未命中时累积阻塞达 150~350ms，且无 `timeout` 守护。
  - **处置建议**：时长在 `buildAudio` 与 `renderVideo` 阶段本身就是已知且落盘的数字（`script.timed.json` 与 `usage.json` 均有记录）。应以盘面既有记录为准，仅在兜底时做异步探查，严禁在 HTTP 请求链路中无超时同步拉起外部 CLI。

### 4. 前端
- **BookNarration.tsx 派生状态逻辑与后端实际语义是否一致？**
  - **不一致（存在 P0 级状态死锁）**：由于步骤卡片的三元表达式优先判定产物存在，重跑已完成步骤时界面恒定显示“已完成”，无法显示“进行中”状态（见 P0-5）。
  - **定妆照卡片边界问题**：若某部小说未提取出任何具名角色（`characters.length === 0`），`sheetsReady` 恒为 false，导致后续分镜生成被永久判定为 `blocked`。
- **轮询 useEffect 依赖数组导致的轮询重建/泄漏**：
  - `load` 闭包依赖了 `job`，而定时器又依赖了 `load` 与 `job`，形成了典型的 React Hooks 级联震荡，导致每 2 秒就会触发全量重绑与状态深拉（见 P1-2）。
- **activeJob 采纳逻辑（!job 时才采纳）是否会吞掉刷新时在跑任务的日志？**
  - **不会吞掉正在运行的日志**：页面刷新后，`job` 初始为 null，首次 `load()` 会采纳 `activeJob`，随后启动轮询请求 `/jobs/:id`，后端该接口切片返回了最近 200 行日志（`lines.slice(-200)`），因此刷新后控制台能恢复日志。
  - **但会彻底丢失“刚跑完/刚失败任务”的最终结果**：若用户刷新时任务刚好执行完毕（非 running 态），`activeJob` 变为 null，控制台将直接消失，用户无法得知刚刚到底成功还是失败，也看不到任何失败错误堆栈。

### 5. 架构与重复
- **该不该抽 packages/web/server/lib/job-runner.ts 公共模块？收益/风险权衡**：
  - **强烈建议抽离（P1）**。
  - **收益**：彻底消除 `narration.ts` 与 `audiobook.ts` 之间重复的 ~120 行高危进程管控逻辑；全局渲染锁与 Job Map 统一治理；修复一处漏洞（如先 spawn 后占锁、cancel 提前交锁）两处同时受益。
  - **风险**：两者的回调钩子不同（audiobook 需要写 episode 登记，narration 需要读 usage.json 算账）。
  - **最佳解法**：JobRunner 仅负责“安全启动、唯一参数暂存、标准输出环形缓冲、SSE 推流、优雅取消、进程终态回调 `onSuccess(job)` / `onFailure(job)`”，业务差异完全通过钩子函数注入。
- **render-lock 与 job map 的双源真相（jobs Map + 锁 holder）是否有更干净的单一事实设计？**
  - 目前的设计中，`render-lock.ts` 内部记录了 `holder: { jobId, kind }`，而各路由又各自拥有 `jobs: Map<string, Job>`。
  - **更干净的单一事实**：把 `jobs` 收归在 `JobRunner` 单例中，锁的状态直接派生自当前是否有 `status === 'running' && isExclusiveRender(job)` 的任务。消灭独立的 `holder` 变量，杜绝“锁释放了但 Job 还在跑”或“Job 挂了但锁没解开”的状态漂移。

### 6. 成本台账
- **Schema（llmCalls/ttsChars/images/durationMs/cost）与落账时机是否合理？**
  - **设计合理**：比有声书粗糙的单一 `chars` 维度先进很多，精准匹配了现代生成式多媒体的三大支出项（Token、TTS 字数、生图张数），落账时机选在任务成功退出的 `child.on('close')` 回调之后，符合“成功产出方才计费”的常规理念。
- **单价口径是否该做成配置而非常量？**
  - 目前硬编码在 `NARRATION_UNIT_COST` 中，作为展示层粗估完全可用。但不同大模型（如 DeepSeek 与 GPT-4o）价格相差数十倍，建议未来提升至 `packages/shared` 或系统配置中心，使其可按当前激活的 `engine` 动态调整单价。
- **同一 stage 重跑会重复落账——这算 bug 还是特性？**
  - **属于账本业务特性，但被当前统计口径扭曲成了 Bug**：
    台账（Ledger）记录的是**实际产生的金钱消耗流水**。若用户重跑了生图并真实消耗了 API Token，追加一条账目完全合情合理。
    但正如 P1-4 所指出的，当前 `cmdAudio` 和 `cmdSheets` 存在“哪怕全部命中本地缓存，依然按全量规模记入新账”的逻辑错误，导致反复点击会产生严重的“幽灵花费膨胀”。

### 7. /media 修复
- **rewriteRequestPath 剥前缀方案 vs Hono 官方推荐姿势**：
  - 属于 Hono 在 Node.js 环境下静态服务子路径挂载的标准方案。Hono 的 `serveStatic` 默认按照完整的 `req.path` 拼装磁盘路径，在挂载到 `/media/*` 时如果不使用 `rewriteRequestPath: (p) => p.replace(/^\/media/, '')`，会导致寻找 `dist/media/...` 路径引发 404。此修复简洁、标准且无副作用。
- **Vite 代理补丁是否完整（WebSocket/HMR 有没有被误伤）？**
  - **配置完整且无伤**：Vite 内部 HMR 默认走根路径 `/` 的专用客户端 WebSocket 服务，不会进入 `/media` 规则。Vite 底层基于 `http-proxy`，天然支持视频流的 `Range: bytes=...` 206 分段传输，经核查无误。

### 8. CLI usage.json
- **recordUsage 的合并语义在重跑部分阶段时账会不会算重/算漏？**
  - **`usage.json` 扮演的是“当前各阶段最新产物用量快照”，而非累计流水账**。
  - 当某个阶段重跑时，`prev[stage] = part` 覆盖该 stage 的记录，`billJob` 随后将这次重跑的差额记入全局 `cost-ledger.json`。
  - **算漏边界**：如果 CLI 增加了某个未调用 `recordUsage` 的命令（例如携带 `--gates-only` 时跳过了文案生成），`usage.json` 会残存上一次全量跑的旧数字，若触发落账则会导致旧数被再计一次。

---

## 四、验证记录（只读执行）

本评审在 `/Users/reed_soul/code/novel-eval` 根目录下执行了以下只读验证命令，未修改仓库原有文件，未调用任何涉及 ffmpeg 渲染、TTS 合成或外部生图的任务：

| 验证项 | 执行命令 | 执行结果 |
| :--- | :--- | :--- |
| **Git 变更状态** | `git status -s` | 确认 13 个修改文件及 6 个新文件/目录分布 |
| **差异核对** | `git diff packages/web/server/ packages/web/src/ packages/shared/` | 逐行核对 `render-lock` 接入、`audiobook.ts` 改动与样式挂载 |
| **全仓类型检查** | `pnpm -r typecheck` | 全部 8 个参与编译的项目 `tsc --noEmit` 均为 0 错误通过 |
| **全仓单测验证** | `pnpm -r test` | 354 个单元测试全部执行通过（narration 6/6，web 49/49） |
| **目录与符号审计** | `rg "outRoot" packages/web/server/routes/` | 审计两路由对 `outRoot` 正则与越界防护逻辑一致性 |
| **进程派生流程审计**| `cat packages/web/server/lib/pipeline-spawn.ts` | 确认 `runPipeline` 的文件解耦及同步 spawn 行为 |
| **生图缓存逻辑核对**| `sed -n '85,140p' packages/narration/src/images.ts` | 确认 `generateCharacterSheets` 返回生成张数但 CLI 未采纳的事实 |

---

## 五、评审结论与行动建议

解说视频 M3 的工程底座相当扎实，全量状态由产物派生的思想极为优秀。但由于临近收尾时的赶工痕迹，在**数据保存（Checklist 覆盖）**、**进程与锁时序（先 spawn 后占锁、cancel 过早交锁）**、**前端向导三元表达式**上出现了硬伤。

**建议修复流程**：
1. **立即修复 P0-1（Checklist 合并写盘）与 P0-5（前端状态机 Running 态优先级）**，恢复正确的数据持久化与交互反馈；
2. **立即修复 P0-2、P0-3、P0-4（进程与锁的时序修正）**，确保绝无脱轨孤儿渲染进程和重叠渲染窗口；
3. **完成上述 P0 修复后即可执行 M3 准入合入**；后续在 M3.1 迭代中推进 P1-1（锁粒度解耦）与 P1-3（抽取公共 `job-runner.ts`）。
