# Novel Eval

给中文网文作者和编辑的**本地 AI 改稿评估器**——30 分钟出一份**可追溯、可执行、可对比**的五维报告。

灵感来自 [燃点AI剧本评估平台](docs/reference/燃点AI剧本评估平台.md)，方法论迁移到小说领域。详见 [产品定义](docs/product.md)。

## 与直接问 ChatGPT 的差异

| 能力 | ChatGPT | Novel Eval |
|------|---------|------------|
| 评分可复现 | 否 | 固定 rubric + prompt 版本 |
| 原文证据 | 含糊 | Map 逐字摘录 + 报告内高亮 |
| 改稿对比 | 否 | `compare` 子命令 |
| 隐私 | 上传云端 | 本地运行、离线 HTML |
| 成本 | 不可控 | 评估前确认屏 + 费用明细 |

## 安装

```bash
pnpm install
export ANTHROPIC_AUTH_TOKEN=your_zhipu_key   # 智谱 GLM 兼容端点
```

## 用法

### 评估

```bash
pnpm eval -- ./data/spike-samples/sample-novel.txt \
  --genre 都市言情 \
  --audience 青年女性 \
  -y
```

评估前会显示字数、章节数、预估耗时与费用。完成后打开 `data/reports/<taskId>/report.html`。

### 改稿对比

```bash
pnpm eval -- ./book-v2.txt --genre 玄幻 --audience 青年男性 -y

novel-eval compare \
  ./data/reports/<task-a>/result.json \
  ./data/reports/<task-b>/result.json \
  --html
```

## 五维模型

故事架构 · 人物塑造 · 文笔质量 · 情感共鸣 · 市场潜力

## 报告内容

- 五维雷达图与分数条
- 情绪/节奏曲线（含波峰/拖沓标注）
- 五维分析（可点击 `[ch001#2]` 查看原文证据）
- 按维度分组的改稿建议（含章节与证据链接）
- 章节事件时间线
- 人物关系拓扑图（有数据时）
- 市场对标（模型推断 + 免责声明，非实时票房数据）

## 开发

```bash
pnpm typecheck
pnpm test:unit
```

## License

MIT
