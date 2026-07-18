# Web 打磨设计（写 → 评 → 改闭环）

## 1. 目标

让作者在浏览器里走完：**写章 → 全书评估 → 修订清单 → 单章修正 →（必要时）draft 定稿**，不再在报告页读完建议后卡住，也不再依赖 CLI 补洞。

## 2. 明确不做（本轮）

- 不重做视觉体系 / 不换组件库（沿用 `styles.css`）。
- 不做多租户、登录、盲评 UI。
- 不把 CLI `auto` 整段搬进 Web。
- 不做「建议正文自动塞进 corrector」之外的智能编排（API 已支持 `revisionTaskId`）。

## 3. 现状判断

| 半环 | Web | 缺口 |
|------|-----|------|
| 写 | 项目 / 规划批准 / 写章 / pause·resume | 字数、maxRevise、outline 章数写死 |
| 评 | `/eval` 上传 + 报告 | 报告与项目脱节；建议只读 |
| 改 | 单章「按经验修正」 | 无修订任务 inbox；open-correction 未接 UI；finalize 未接 UI |

## 4. 分期

### Phase A — 打通改稿闭环（优先）

1. 评估报告：「导入为修订清单」（`from-eval` + `maxSuggestions` + `sourceEvalTaskId` + 可选 `projectId`）。
2. 项目页：修订任务 inbox（list / set-status / **打开修正** → `open-correction` → 跳转 correction URL）。
3. 修正页：有 `revisionTaskId` 时展示任务摘要；可选策略；避免无任务时误触与有任务时行为一致且可预期。

### Phase B — 写侧旋钮 + draft 续命

1. 写章：`wordCount`、`maxRevise` 可填。
2. 蓝图：目标章数可填（去掉写死 12）。
3. 修订历史：`draft` 显示「继续定稿」→ `finalize`。

### Phase C — 体验收口（有余力再做）

1. 空状态去掉「只能 CLI」文案，链到 `/projects/new` / 项目内生成。
2. `/eval` 流程带着 `projectId`（query 或上传后绑定）。
3. QualityPanel 错误可见；低分章链到修正。

## 5. 验收（Phase A）

1. 从某项目导出/评估后，报告页一键导入 ≤N 条修订任务到该项目。
2. 项目页能看到 open 任务，点「打开修正」进入带 `revisionTaskId` 的修正页并跑 correct。
3. 任务状态可标 done / dismissed；无需 CLI。

## 6. 原则

反 demo：每项改动必须缩短「看到建议 → 改完一章」的路径，而不是多一块仪表盘。
