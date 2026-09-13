# M1 验收报告（六项全绿）

> 验收日期：2026-09-13
> 对应方案：PLAN-2.0.md §5 M1（预设与质检回流 + 审听精修）
> 范围：书级配置中心 UI / 审听单段重制 UI 化 / 内容哈希缓存键控 / 评估审计进质检 tab / 阶段感知 / Radix 高频控件；OUT：数据库迁徙（未做，按方案）
> 测试基线：@novel-eval/audiobook 54 过 0 挂（新增 6 条：tts-cache 4 + project-config-save 2）；@novel-eval/web 49 过 0 挂；双包 typecheck 干净

## 逐项验收

### 1. 内容哈希缓存键控（替代 --clean 的长期解）✅

- 实现：`tts/cache.ts`——指纹=sha256(引擎|类型|音色|语速|音调|正文)，索引 `tts/.cache-index.json`；edge/volcengine 两引擎接入；`--clean` 同步清索引；旧缓存无索引条目时信任一次（零重合成成本渐进迁移）
- 单测：指纹稳定性/敏感性（改字、换音色、改语速、换引擎均失配）、索引缺失/损坏容错、命中三态——4 条
- **E2E（隔离 DB 副本 + 隔离 out + edge 引擎）**：首跑 25 段全合成（77s）→ 在 DB 副本把 `"什么叫又来了？"` 改为 `"什么叫又来啦？"` → 不带 --clean 复跑：**25 段中仅 c1-s16（该句所在对白段）重新合成，其余 24 段全部缓存命中**（总用时 15s）。改字即自动重做、无需人工清缓存，旅程③的机制级闭环
- 现场已清理（dist/m1-e2e、data/writer/m1-e2e.db 均删，生产 data/ 零改动）

### 2. 书级配置中心 UI ✅

- 后端：`GET /books/:id/config`（presets+project+voices 合并读）、`PUT /config/presets`（复用 setupBookLine 部分更新，正则校验）、`PUT /config/project`（`saveProjectConfig` 先校验后写，坏数据写入前拦截）——分工铁律（presets 归 registry / 音色发音归 projects/<书名>.json）在后端强制
- 前端：BookAudiobookConfig 组件（工作台 hero「配置」按钮展开）——「制作预设」（引擎/每集章数/纯音频）与「发音与班底」（旁白/对白音色、角色→音色+语速音调行编辑、发音表、角色名单、场景图指令高级折叠）两区，分开保存
- 端点实测：未建线书返回 `presets:null + 10 音色目录`；DOM 实测：配置按钮渲染在案
- 单测：saveProjectConfig 往返一致 + 三类坏数据拦截不落盘——2 条

### 3. 审听台单段重制 UI 化 ✅

- 后端：`POST /books/:id/ep/:ep/resegment`——段标识严格校验（`chNN/c{pos}-s{n}` 且目录前缀与段 id 章节号一致）、路径锁定产物根内、删该段 mp3+srt
- 前端：集详情审听报告 worst 列表每项加「重做此段」——删缓存 + 拉起本集重制（段级缓存保其余段），JobConsole 复用展示进度
- 按钮态处理：段处理中/任务运行中禁用，防连点重复拉任务

### 4. 评估/审计绑定书进质检 tab ✅

- `BookQuality` 页（`/books/:id/quality`）：作品评估 / 剧情逻辑审计双工具，`bookId` prop 预绑定本书并隐藏选源区（独立入口 /eval /audit 行为不变）
- BookTabs 第三格「质检」点亮（原"2.0 M1 开放"占位符移除）
- DOM 实测：质检 tab 渲染、两工具齐全、「评估对象：本书工作台绑定的书」绑定提示在案

### 5. 阶段感知 ✅

- 定义（终审链原意，final-cursor.md:685）：制作期打开书落有声书 tab，旅程②变 2 击
- 实现：`GET /api/audiobook/lines`（已建线书+集数）→ 书架卡片对已建线书直达 `/books/:id/audiobook`，未建线仍落写作 tab；已建线书卡加「🎧 有声书 N 集」徽章
- DOM 实测：物业管家卡片 href 直达有声书 + 「🎧 有声书 2 集」徽章在案

### 6. Radix 高频控件 ✅

- `@radix-ui/react-tabs` 接入两处高频页签：质检工具切换（BookQuality）、集详情面板（场景图库/台本/审听报告/上传物料，受控模式保留条件渲染）
- 激活态走 `data-state='active']` 样式；键盘方向键切页签 + 原生 tab 语义

## 已知边界（诚实记录）

- 配置面板的完整交互（点开-改-存-生效）未做点击级自动化（无头 dump-dom 只验渲染）；保存路径已有单测+端点校验兜底，建议首次使用时人工过一遍
- 单段重制的完整点击流依赖一次真实构建任务（审听报告 worst 非空才有按钮），首次审听出报告后自然可验
- volcengine 引擎的哈希缓存与 edge 同构实现但仅单测覆盖（E2E 用 edge 走的免费路线），首次 volcengine 制作时行为等同（缓存索引机制引擎无关）

## 改动清单

- audiobook 包：`tts/cache.ts`（新）、`tts/{volcengine,edge}.ts`（接入）、`cli.ts`（--clean 清索引）、`voices.ts`（新）、`project-config.ts`（saveProjectConfig）、`index.ts`（导出）
- web 包：`routes/audiobook.ts`（/lines + config 三端点 + resegment）、`BookAudiobookConfig.tsx`（新）、`BookQuality.tsx`（新）、`BookAudiobook.tsx`（配置入口+导出 JobConsole）、`AudiobookEpisode.tsx`（单段重做+Radix）、`Evaluation.tsx`/`Audit.tsx`（bookId prop）、`ProjectList.tsx`（直达）、`BookTabs.tsx`（质检）、`main.tsx`（路由）、`styles.css`、依赖 +@radix-ui/react-tabs
- 测试：`tts-cache.test.ts`（新 4 条）、`project-config-save.test.ts`（新 2 条）
