# Golden Corpus MVP 设计

## 1. 目标

为评估质量建立可复现的真实长篇基准集：固定语料、固定抽样、可提交的期望分数带、一条本地回归命令。模型 / prompt / 阈值变更时能产出对比报告，分数漂移出带则失败。

本设计是 Stage C「可验证质量系统」的第一刀，**不做**完整 Stage C（独立 reviewer、evidence store、卷级修订任务、双人编辑盲评流程）。

## 2. 明确不做

- 不把受版权保护的全文小说提交进 git（`data/novels/**` 继续 gitignore）。
- 不在 CI 默认路径里打真实 LLM（成本与密钥）；日常 CI 只跑 harness 单测 + 语料存在性检查（可选）。
- 不伪造「权威」人工标注分数；未标注 case 标记为 `pending_annotation`，回归时跳过或仅 dry-run。
- 不做多租户、盲评 UI、VCR 全量录制（后续 Stage C）。

## 3. 语料选择（本地）

| Case ID | 路径 | 题材 | 抽样策略 |
|---------|------|------|----------|
| `literary-bailuyuan` | `data/novels/白鹿原.txt` | 现实主义文学 | 前 8 章或约 2 万字 |
| `romance-heyi` | `data/novels/何以笙箫默.txt` | 都市言情 | 前 8 章或约 2 万字 |
| `romance-weiwei` | `data/novels/微微一笑很倾城.txt` | 都市言情 | 前 8 章或约 2 万字 |
| `scifi-qiuzhuang` | `data/novels/球状闪电.txt` | 硬科幻 | 前 8 章或约 2 万字 |
| `scifi-santi` | `data/novels/三体全集.txt` | 硬科幻 | **仅前 8 章**（控制成本） |
| `mystery-changye` | `data/novels/长夜难明.txt` | 悬疑 | 前 8 章或约 2 万字 |
| `web-guimi` | `data/novels/网络小说合集/诡秘之主.txt` | 玄幻/奇幻网文 | 前 8 章或约 2 万字 |

MVP 验收至少 **5** 个 case 可解析、可抽样、可挂 expect；优先保证：白鹿原、球状闪电、何以笙箫默、长夜难明、诡秘之主。

## 4. 仓库布局

```
tests/golden/
  README.md
  corpus.json              # 注册表：id → 相对路径、元数据、slice、expect 路径
  cases/<id>/
    meta.json              # 书目元信息 + slice 策略
    expect.json            # 分数带；status: pending_annotation | active
  slices/                  # gitignore：本地生成的抽样 TXT
  runs/                    # gitignore：最近一次回归的 result 摘要

packages/eval/src/golden/
  types.ts
  load-corpus.ts
  slice.ts                 # 解析 + 按章抽样写出切片文件
  assert-bands.ts          # 纯函数：结果 vs 分数带
  run-golden.ts            # 编排：check | slice | evaluate | assert
```

## 5. 契约

### 5.1 `corpus.json`

```json
{
  "schemaVersion": "1.0.0",
  "cases": [
    {
      "id": "literary-bailuyuan",
      "sourcePath": "data/novels/白鹿原.txt",
      "metaPath": "tests/golden/cases/literary-bailuyuan/meta.json",
      "expectPath": "tests/golden/cases/literary-bailuyuan/expect.json"
    }
  ]
}
```

### 5.2 `expect.json`

```json
{
  "status": "pending_annotation",
  "toleranceNote": "人工标注后改为 active；单维默认容差 ±10",
  "overall": { "min": 0, "max": 100 },
  "gradeAllowlist": ["S", "A", "B", "C", "D"],
  "dimensions": {
    "writingQuality": { "min": null, "max": null }
  }
}
```

- `null` 边界 = 该维不校验。
- `status !== "active"` 时，`golden run` 默认跳过 assert（仍可 `--force-assert`）。
- 标注完成后写入具体 min/max，再改 `active`。

### 5.3 抽样

- 输入：全文 TXT（本地）。
- 输出：`tests/golden/slices/<id>.txt`（gitignore）。
- 策略：`splitChaptersWithMeta` 后取 `chapters.slice(0, maxChapters)`，或累计字数达到 `maxChars` 即停；保留原标题行格式以便再次切分。

### 5.4 CLI

```
pnpm golden check          # 语料文件是否存在、能否切分、章数/字数
pnpm golden slice          # 生成 slices/
pnpm golden run            # 对 active（或 --all）case 评估并校验分数带
pnpm golden run --dry-run  # 只 check+slice，不调 LLM
```

退出码：语料缺失 / 切分失败 / active case 分数越界 → non-zero。

## 6. 标注工作流（人工）

1. `pnpm golden slice && pnpm golden run --seed-baseline`（或对单本 `pnpm eval` 切片）。
2. 编辑阅读报告，填写 `expect.json` 各维区间（建议 ±10）。
3. `status` → `active`。
4. 之后 prompt/模型变更跑 `pnpm golden run`；漂移则失败并打印维度对比表。

## 7. 验收

1. 5 本以上本地小说通过 `golden check`。
2. `golden slice` 产出可再次切分的切片文件。
3. `assert-bands` 有单测：边界内通过、越界失败。
4. `golden run --dry-run` 不调 LLM 且 exit 0（语料齐全时）。
5. 至少一个 case 可切到 `active` 并在有 API key 时跑通（文档说明，不强制 CI）。

## 8. 后续（完整 Stage C）

- 双人独立标注与一致性度量。
- Evidence 覆盖率门槛与 incomplete 门禁。 ~~（C2 已落地）~~
- Prompt-hash 索引的 VCR 回放。 ~~（见 `2026-07-17-golden-active-vcr-design.md`）~~
- 盲评（对模型隐藏作品来源）。
- 人工收紧 `active` 分数带（当前为确认后的 ±10 种子带）。
