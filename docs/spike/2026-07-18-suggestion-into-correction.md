# 修订建议注入单章修正

## 行为

1. `openCorrection` 返回 path 带 `?revisionTaskId=`
2. Web 修正页 / `POST .../correct` 可传 `revisionTaskId` 或 `feedback`
3. `correctChapter` 把任务 `content`（或显式 feedback）追加进 rewrite `{FEEDBACK}` / surgical `{ISSUES}`

## 不做

- 跨章任务仍不能 open
- 不强制改策略（仍可自动 surgical/rewrite）
