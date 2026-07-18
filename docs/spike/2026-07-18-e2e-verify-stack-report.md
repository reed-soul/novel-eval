# E2E 验货 — QG 稳性 + 建议注入（#12/#13 合入后）

> 日期：2026-07-18  
> 范围：短烟测，非完整三章重跑

## 已合入

- #12 QG 软挡可重写 / 失败保留 draft / `assess_raw`
- #13 修订建议注入单章修正 prompt

## 验货结果

### A. 灰雨驿站（既有 `e2e-stress.db`）

| 步骤 | 结果 |
|------|------|
| `revision-tasks open-correction`（单章任务） | ✅ path 含 `?revisionTaskId=` |

示例：

```
path：/projects/a63bd8d3-…/chapters/3/correction?revisionTaskId=82d09d7c-…
```

### B. 烟测驿口（新库 `data/writer/e2e-qg-smoke.db`）

| 步骤 | 结果 | 备注 |
|------|------|------|
| init + approve bible | ✅ | ¥0.22 |
| outline 1 章 + approve | ✅ | ¥0.05；仍跑满三幕 beats |
| chapter `--max-revise 1` · 600 字 | ⚠️ | QG **A 82 通过**；随后 extract 报 lease conflict |
| `eval_history.assess_raw` | ✅ | 长度 9363 |
| draft 保留 | ✅ | 未因失败标 rejected |
| `finalize-draft` | ✅ | 发布成功 |

项目：`0e0f9f07-8a3b-4e81-a2cb-59dcd13af4f4`  
draft/published revision：`2bdc4e98-3e64-4a2d-8aad-bc9ea6998c48`

本轮未撞上「灾难分 D」软挡重写（首次审阅即 A）；软挡路径以单测为准。

## 新发现（下一刀候选）

**P1 — QG 通过后 extract 偶发 lease conflict**

```
失败: The project write lease is held by another owner
```

审阅已通过且 draft 已落库；extract 阶段抢 lease 失败。`finalize-draft` 可恢复，但自动路径仍会中断、多花一轮手操。

## 结论

- open-correction → `revisionTaskId` 链路可用  
- QG 评估落盘 + 失败保 draft + finalize 续跑可用  
- 自动 chapter 路径在「审阅后 extract」仍有 lease 毛刺，建议下一刀修
