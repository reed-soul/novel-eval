# M2 验收报告（五项全绿）

> 验收日期：2026-09-13
> 对应方案：PLAN-2.0.md §5 M2（第二形态 + 发布清单）
> 范围：digest 精简短篇管线（第二真形态）/ DerivativeWork 抽象（双真形态驱动）/ 成本台账 / 发布检查单；OUT：剧本/漫剧壳（M3）
> 测试基线：六包全绿（shared 71 / writer 156 / eval 74 / audiobook 54 / digest 4 / web 49，零失败）；workspace typecheck 干净

## 逐项验收

### 1. digest 精简短篇管线（第二真衍生形态）✅

- 新包 `@novel-eval/digest`：选章 → LLM 缩写（map 逐章浓缩 → reduce 合成终稿）→ markdown 产物 + 登记；引擎走应用同款（shared engines.yml + loadEnv 同源 key）
- 双风格：忠实浓缩（保留完整主线）/ 引流浓缩（前三句抛悬念、强钩子）
- **内容哈希缓存**（与 M1 TTS 缓存同哲学）：改章只重浓缩那一章 + reduce——单测实锤（3 章改 1 章 = 2 次调用而非 4 次）
- **真实 E2E**：《物业管家》第 1 章 → 600 字引流风格，23 秒 2 次 LLM 调用 803 字成稿（主线/反转/嫌疑钩子全保留），产物落 `dist/derivatives/物业管家不想破案/digest/p1-茶水间的耳语.md` 并登记
- CLI：`pnpm digest build --project X --chapters 1-9 --title T [--target-words 3000] [--style hook]`

### 2. DerivativeWork 抽象（双真形态驱动）✅

- `packages/shared/src/derivative-work.ts`：DerivativeKind / DerivativeUnit（id=registry 键名）/ DerivativeLine 契约 + `nextUnitNumber` 共用编号助手
- **双形态真实使用**（非仪式性抽象）：audiobook `nextEpisodeHint` 与 digest `nextPieceId` 都走 `nextUnitNumber`（excludeDraft 语义保留）；两包各提供 `toDerivativeLine` 适配器做结构化类型自检
- 施工禁令遵守：单形态特有概念（TTS 引擎/浓缩风格）未上提；M3 形态接入指南写在契约文档里

### 3. 成本台账 ✅

- `cost-ledger.ts`：CLI 每集完成落账（口径=截断后实配字数；试产标 isDraft 不入正式汇总；封顶 1000 条防膨胀）；估费公式与确认条一致（edge 免费 / volcengine ≈¥2/万字）
- `GET /api/audiobook/books/:id/cost`：书层聚合（集数/总字数/总时长/总成本/按引擎）+ 近 30 条明细
- 工作台 hero 显示累计成本行（API 实测返回空汇总不炸）
- 边界：台账从本版本起算，历史集无回填（如实记录）

### 4. 发布检查单 ✅

- `GET/PUT /books/:id/ep/:ep/checklist`：10 项发布前确认（标题/说明/标签/缩略图/SRT/播放列表/AI 披露/非儿童/语言/定档），按集持久化 `publish-checklist.json`
- 集详情上传页：静态速查清单升级为可勾选（勾选即存）+ 保留后台正确选项速查
- 实测：森铁 ep01 PUT/GET roundtrip 通过（已清理测试文件）

### 5. 短篇 tab（Web 集成）✅

- `routes/digest.ts`：状态/正文/生成任务三组端点；任务进程内直跑（分钟级 LLM 作业不复制 audiobook 的 spawn/SSE 机械），单书单任务锁，2s 轮询
- `BookDigest` 页（`/books/:id/digest`）：生成表单（章范围/标题/目标字数/风格）+ 条目卡 + 灯箱阅读视图
- BookTabs 四格：写作 | 有声书 | 短篇 | 质检（DOM 实测渲染在案，p1 条目可见）

## 顺带修复（digest 开发中发现）

- **audiobook `--llmAttribute` 潜伏 ENOENT**：attribute.ts 的 SHARED_CONFIG_DIR 上溯 3 级指向不存在的仓库根 `shared/`（engines.yml 实际在 `packages/shared/config/`）——测试全注入引擎、生产从未走过默认引擎，故一直未暴露。已修正。

## 已知边界（诚实记录）

- 成本台账自本版本起算，无历史回填；首条真实账目将在下次真实构建时产生
- digest 生成任务的完整成功路径以 CLI E2E 为准（API 路径共享同一 condenseChapters；API 侧实测了校验与 409 锁，未烧 LLM 跑全任务）
- 短篇正文阅读视图为 pre 排版（首版够用；排版精修留后续）

## 改动清单

- 新包：`packages/digest`（cli/condense/registry/db/index + 4 条单测）
- shared：`derivative-work.ts`（契约+编号助手）+ index 导出
- audiobook：`cost-ledger.ts`（新）、cli.ts（落账）、registry.ts（nextUnitNumber 接入+适配器）、attribute.ts（路径修复）、index.ts（导出）
- web：`routes/digest.ts`（新）、routes/audiobook.ts（cost/checklist 端点）、server/index.ts（挂载）、`BookDigest.tsx`（新）、BookTabs（四格）、main.tsx（路由）、AudiobookEpisode（检查单勾选化）、BookAudiobook（成本行）、styles.css、package.json（+@novel-eval/digest）
- 根：package.json（digest script）、.gitignore（data/digest/registry.json 例外）、pnpm-lock
