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
pnpm golden run                # 评估切片并对 status=active 的 case 校验分数带
pnpm golden run --case literary-bailuyuan
```

## 标注流程

1. `pnpm golden slice && pnpm golden run --case <id>`（需 API key）
2. 读报告，编辑 `cases/<id>/expect.json` 各维 `min`/`max`（建议 ±10）
3. 将 `status` 改为 `active`（或保留 `seeded_baseline` 作为机器种子基线门禁）
4. 之后改 prompt/模型再跑 `pnpm golden run`；越界非零退出

状态说明：
- `pending_annotation`：不校验分数
- `seeded_baseline`：首跑机器种子，按 ±10 带校验（可回归）
- `active`：人工确认后的正式期望

