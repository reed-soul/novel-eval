# Option A — draft 续 finalize + revision → correction（MVP）

## 已落地

1. **Draft 续 finalize**：`WriterApplication.finalizeDraftRevision`、CLI `write finalize-draft`、API `POST /api/projects/:id/revisions/:revisionId/finalize`。只重跑 extract + publish，不重生正文；extract 默认重试 3 次，仍失败则抛 `StateExtractionError` 并保留 draft。
2. **Revision-task → 单章 correction**：`openCorrection` 返回带 `?revisionTaskId=` 的 path；Web 修正页 / `POST .../correct` 把 `task.content` 注入 corrector prompt（见 `2026-07-18-suggestion-into-correction.md`）。
3. **建议导入降噪**：`from-eval` / CLI `--max-suggestions N`；导入前按「单章 → 跨章 → 全书」排序再截断。

## 明确不做（本 MVP）

- 跨章 / 全书 revision-task 一键打开修正
- 修订任务列表页一键按钮（path / API 已通）
