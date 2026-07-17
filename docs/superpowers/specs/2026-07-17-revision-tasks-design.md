# Volume Revision Tasks 设计（Stage C4）

## 1. 目标

把全书/卷级评估产出的 `suggestions` 落成可审阅的修订任务清单：可列表、可改状态、可追溯来源；不自动改写正文。

## 2. 明确不做

- 不自动调用 LLM 重写或 `correctChapter`。
- 不做卷级批量 rebuild 编排。
- 不替代单章 correction 流；任务可后续「打开修正」但本切片不接。

## 3. 数据模型

表 `revision_task`：

| 字段 | 说明 |
|------|------|
| id | UUID |
| project_id | FK project |
| status | `open` \| `in_progress` \| `done` \| `dismissed` |
| scope | `chapter` \| `volume` \| `book`（默认由 relatedChapters 推断） |
| dimension | 评估维度 |
| content | 修订建议正文 |
| type | 可选建议类型 |
| related_chapters_json | 章节 id/号列表 |
| excerpt_ref_json | `{ chapterId, excerptIndex }` |
| source_eval_task_id | 可选，来自 `/api/eval` 任务 |
| source_kind | `evaluation_report` \| `manual` |
| created_at / updated_at | ISO |

## 4. API（项目作用域）

```
POST   /api/projects/:id/revision-tasks/from-eval
GET    /api/projects/:id/revision-tasks?status=
GET    /api/projects/:id/revision-tasks/:taskId
PATCH  /api/projects/:id/revision-tasks/:taskId   { status }
```

`from-eval` body：`{ suggestions, sourceEvalTaskId?, replaceOpen?: boolean }`  
或 `{ result }`（`EvaluationResult` / report DTO，取 `suggestions`）。

## 5. CLI

```
pnpm write revision-tasks import <projectId> --from-eval <result.json> [--replace-open]
pnpm write revision-tasks list <projectId> [--status open]
pnpm write revision-tasks set-status <projectId> <taskId> <status>
```

## 6. 验收

1. Migration `005` 在空库可应用。
2. 从含 suggestions 的 result JSON 导入 → list 可见。
3. PATCH 状态机合法迁移；非法 status → 400。
4. `replaceOpen` 仅关闭/替换 `open` 任务，不影响 `done`。
