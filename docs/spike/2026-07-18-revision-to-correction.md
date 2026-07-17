# Option A — draft 续 finalize + revision → correction（MVP）

## 已落地

1. **Draft 续 finalize**：`WriterApplication.finalizeDraftRevision`、CLI `write finalize-draft`、API `POST /api/projects/:id/revisions/:revisionId/finalize`。只重跑 extract + publish，不重生正文；extract 默认重试 3 次，仍失败则抛 `StateExtractionError` 并保留 draft。
2. **Revision-task → 单章 correction**：`RevisionTaskService.openCorrection`、CLI `revision-tasks open-correction`、API `POST .../revision-tasks/:taskId/open-correction`。仅单章任务；解析 `ch001` / `ch-10` / `"12"`；标记 `in_progress`；返回 `{ chapterNumber, path }`。**不**把 `task.content` 注入 corrector prompt。
3. **建议导入降噪**：`from-eval` / CLI `--max-suggestions N`；导入前按「单章 → 跨章 → 全书」排序再截断。

## 明确不做（本 MVP）

- 把修订建议正文自动塞进单章修正 LLM
- 跨章 / 全书 revision-task 一键打开修正
- Web UI 按钮（API/CLI 已通）
