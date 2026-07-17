# E2E Short Stress Report — 灰雨驿站（3 章）

> 日期：2026-07-17  
> 选项：**G**（端到端压测，非新功能优先）  
> 项目：`a63bd8d3-b143-4bcd-89cd-3905ed6a4c3b`  
> DB：`data/writer/e2e-stress.db`（与生产 `writer.db` 隔离）

## 1. 跑通路径

| 步骤 | 结果 | 备注 |
|------|------|------|
| init + approve bible | ✅ | ¥0.178 · glm-5.2 |
| outline 3 章 + approve | ✅ | ¥0.142 · 仍生成三幕各 3 beats（见摩擦 #4） |
| chapter + qualityGate | ❌→⚠️ | 首次审阅 A81 后 **state 抽取炸**；重试 QG 得 **D/15 直接拒** |
| chapter 无 QG · 1200 字 | ✅ | 3 章 · 5394 字（修 normalize 后） |
| eval 全书切片 | ✅ | **86（A）** · ¥0.233 · coverage complete · evidenceLinkRate≈0.96 |
| revision-tasks import | ✅ | **18** 条 open；`setStatus → in_progress` OK |

产物：

- 正文：`data/writer/a63bd8d3-…-ch1-3.txt`
- 评估：`packages/eval/data/reports/c0c41613-…/result.json` + `report.html`
- 过程日志：`docs/spike/e2e-0*.log`

## 2. 发现的问题（按优先级）

### P0 — 状态抽取：模型省略空数组 → 发布失败（已修）

**现象**  
质量审阅已通过（A 81）后，`extractStoryState` 抛：

`Invalid persisted story state delta extraction: delta arrays are required`

无 QG 路径同样会在模型只返回 `summary` 时炸（修前）/ 校验重试耗尽（一度误标 `required:true`）。

**根因**  
`DELTA_SCHEMA` 里数组未 required，校验「通过」；`parseDelta` 又硬要求四个数组都存在。模型常省略空列表。

**修复**（本 PR）  
校验通过后把缺失数组 **normalize 为 `[]`**，再 `parseDelta`。单测：`state-delta-schema.test.ts`。

**残余风险**  
- 抽取失败会把已通过审阅的 draft **标 rejected**，正文丢弃，只能整章重写（浪费 QG 费用）。  
- 未做「抽取失败自动重试 / 保留 draft 待人工 finalize」。

### P1 — 质量门槛偶发灾难分 + block 不给 revise

**现象**  
第二次开 `--max-revise 1`：评估完成 **15（D）** → 直接  
`Chapter 1 rejected by quality reviewer`（block），不进入重写。

**影响**  
- `maxRevise` 对 **block** 无效，钱花了章没了。  
- 15 分对刚生成正文极不合理，更像评估噪声 / 短章 lite 评估不稳，而非「真·垃圾章」。

**建议（未做）**  
- block 与 revise 阈值复查；短章 / 单章 assess 是否应用更宽阈值。  
- reject 前保留 candidate 供 `resume` 或人工 override。  
- 记录 assess 原始 JSON 便于排障。

### P2 — CLI / 产品摩擦

| # | 摩擦 | 说明 |
|---|------|------|
| 1 | `write auto` 无 `--word-count` | 压测只能 `chapter --word-count`；auto 日志仍打印 yml 默认 2800 |
| 2 | 3 章仍跑满三幕 beats | outline 对极短篇偏贵（9 个段落 LLM） |
| 3 | 修订任务 → 修正未打通 | 18 条建议只能 list/set-status，不能一键 correction（选项 C） |
| 4 | 建议量爆炸 | 3 章 → 18 suggestions；缺优先级 / 折叠 / 「只导入 high」 |
| 5 | `WRITER_DB_PATH` 必填 | 符合设计，但新人易踩；压测需显式隔离 DB |
| 6 | shell 名冲突 | 在错误 cwd 下 `write` 可能变成系统命令；应用 `pnpm write` |

### 正向信号

- Planning 批准门、lease、分章、导出、eval coverage 门禁、revision-tasks CRUD：**闭环可用**。  
- 无 QG 三章生成稳定；评估费用可接受（本轮约 ¥0.2+写作费）。  
- 建议内容质量高（可执行、带 excerptRef），适合后续接选项 C。

## 3. 费用粗估（本轮）

| 阶段 | 约 |
|------|----|
| bible | ¥0.18 |
| outline | ¥0.14 |
| 失败的 QG 尝试 ×2 + 抽取失败 | （未精确加总，明显高于成功写作） |
| 成功 3 章写作 + finalize | 含在 chapter 成功跑中 |
| eval | ¥0.23 |
| **教训** | **QG 失败路径最烧钱且零产物** |

## 4. 建议的下一刀（供你选）

1. **巩固 P0 残余**：抽取失败时保留 draft + 自动重试 finalize（避免 QG 白跑）。  
2. **选项 C**：revision-task → 打开单章 correction。  
3. **QG 稳性**：短章阈值 / block vs revise / 保留候选。  
4. **再录 VCR**（选项 A）：对本短篇或 golden 录卡带，降低回归成本。

## 5. 复现命令

```bash
export WRITER_DB_PATH="$PWD/data/writer/e2e-stress.db"
pnpm write init --title "灰雨驿站" --genre 都市悬疑 --audience 青年男女 \
  --topic "…" -y --approve-planning
pnpm write outline <projectId> --chapters 3 -y --approve-planning
pnpm write chapter <projectId> --from 1 --to 3 --word-count 1200
pnpm eval data/writer/<projectId>-ch1-3.txt --title 灰雨驿站 --genre 都市悬疑 --audience 青年男女 -y
pnpm write revision-tasks import <projectId> --from-eval <result.json> --replace-open
pnpm write revision-tasks list <projectId>
```
