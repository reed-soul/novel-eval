# Chapter write lease 在质量审阅后过期

## 根因

`generateChapterRange` 只在每章开始时 `renew` 一次；默认 TTL 120s。  
开质量门槛时，审阅 + 抽取常超过 TTL。发布时 `assertActiveLease` 要求 `expires_at > now`，于是抛 `ProjectLeaseConflictError`（“held by another owner”）。draft 已落库，可用 `finalize-draft` 续跑。

Bible / Blueprint 路径已用 `bindLeaseHeartbeat`；章节路径漏了。

## 修复

1. `generateChapterRange`：`onProgress` 绑定 `bindLeaseHeartbeat`；传入 `renewLease`
2. `generateNext`：在生成 / 审阅 / 抽取 / 发布前调用 `renewLease`
