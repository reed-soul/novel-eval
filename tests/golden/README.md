# Golden Corpus

本地真实长篇评估基准集。**全文小说不入库**（`data/novels/` gitignore）；本目录只提交注册表与期望分数带。

## 前置

把语料放到仓库根相对路径（见 `corpus.json` 的 `sourcePath`），例如：

- `data/novels/白鹿原.txt`
- `data/novels/球状闪电.txt`
- `data/novels/网络小说合集/诡秘之主.txt`

## 命令

```bash
pnpm golden check              # 语料是否存在、能否切分
pnpm golden slice              # 生成 tests/golden/slices/<id>.txt
pnpm golden run --dry-run      # check + slice，不调 LLM
pnpm golden run                # 评估切片并对 active|seeded_baseline 校验分数带
pnpm golden run --case literary-bailuyuan
pnpm golden run --vcr-record --case literary-bailuyuan   # 录制 LLM 卡带（需 API key）
pnpm golden run --vcr-replay --case literary-bailuyuan   # 无网回放卡带
```

## 标注 / 晋升流程

1. `pnpm golden slice && pnpm golden run --case <id>`（需 API key）→ 得到 `seeded_baseline`
2. 审阅报告与 `cases/<id>/expect.json` 分数带（默认 ±10）
3. 将 `status` 改为 `active`（当前仓库 7 个 case 已晋升）
4. 之后改 prompt/模型再跑 `pnpm golden run`；越界非零退出

状态说明：
- `pending_annotation`：不校验分数
- `seeded_baseline`：机器种子，按带校验（可回归）
- `active`：已确认的正式期望

## VCR（prompt-hash 回放）

- 卡带目录：`tests/golden/cassettes/<caseId>/<sha256>.json`（gitignore）
- 按 `systemPrompt + userPrompt + model + temperature` 哈希索引，兼容 Map/Reduce 并发
- `--dry-run` **不会**启用 VCR（仍只 check+slice）
- Prompt 或切片变更 → 哈希失效 → replay miss；用 `--vcr-record` 刷新
