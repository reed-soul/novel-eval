# Novel Eval

AI 驱动的中文网文**写作 + 评估**工具箱。本地运行，支持智谱 GLM 与 DeepSeek 双引擎。

- **写作**（writer）：bible 设定集 → 章节蓝图 → 正文生成，带质量门槛写-评-改循环。支持**暂停/继续/取消**，中断后**断点续写**。
- **评估**（eval）：吃一本 `.txt` 小说，输出五维评分（故事架构 · 人物塑造 · 文笔质量 · 情感共鸣 · 市场潜力）+ 可追溯原文证据的 HTML 报告，支持改稿前后对比。
- **Web 端**：可视化界面，写作进度、章节网格、质量趋势图、模型配置。

---

## 前置要求

- **Node ≥ 20**、**pnpm ≥ 10**（项目强制 pnpm，`engine-strict=true`）
- 一个 AI 引擎的 API key（智谱或 DeepSeek，二选一即可开始）

## 安装

```bash
git clone <repo-url> novel-eval && cd novel-eval
pnpm install
```

## 配置 API Key

本项目不自动读取 `.env` 文件，key 通过环境变量注入。两种方式（任选其一）：

**方式 1：shell 直接 export（推荐）**

```bash
# 智谱 GLM（默认引擎）—— 在 https://open.bigmodel.cn 申请
export ANTHROPIC_AUTH_TOKEN=your_key

# 或用 DeepSeek —— 在 https://platform.deepseek.com 申请
export DEEPSEEK_API_KEY=your_key
```

**方式 2：写进 `~/.claude/settings.json`**（用 Claude Code 开发时方便）

```json
{ "env": { "ANTHROPIC_AUTH_TOKEN": "your_key" } }
```

> 变量名说明：智谱 key 优先读 `ANTHROPIC_AUTH_TOKEN`，没有则回退到 `ZHIPUAI_API_KEY`；DeepSeek 读 `DEEPSEEK_API_KEY`。详见 [`.env.example`](.env.example)。

**切换默认引擎**：编辑 `packages/shared/config/engines.yml` 的 `default:` 字段（`bigmodel` 或 `deepseek`）。Web 端也可运行时切换（仅当次有效，重启回默认）。

> ⚠️ 所有命令都**必须在仓库根目录执行**——数据写入相对路径 `data/`，换目录会找不到数据库。

---

## 用法

### 一、写作（CLI）

**一键全自动**（推荐新手）—— bible → 蓝图 → 全部章节 + 质量门槛：

```bash
pnpm write -- auto \
  --title "星海残响" \
  --genre 科幻 \
  --audience 青年男性 \
  --topic "失忆探险者在废弃殖民地醒来" \
  --chapters 12 \
  -y
```

**分步控制**（更灵活）：

```bash
# 1. 创建项目 + 生成 bible 设定集（雪花法 4 步）
pnpm write -- init --title "..." --genre "..." --audience "..." --topic "..." -y
#   → 返回 projectId

# 2. 把 bible 拆成章节蓝图
pnpm write -- outline <projectId> --chapters 12

# 3. 写正文（按范围）
pnpm write -- chapter <projectId> --from 1 --to 5            # 写第 1-5 章
pnpm write -- chapter <projectId> --all --max-revise 2        # 全部 + 质量门槛
```

**中断后续写**（核心特性）：

写作跑到一半随时可以 `Ctrl+C`（建议等当前章写完），已完成的章节自动落盘。下次继续：

```bash
pnpm write -- resume <projectId>
#   → 自动检测断点、跳过已完成章节、修复半成品状态、从下一章续写
```

> 也可以重跑原命令（如再次 `chapter --all`），已写章节会自动跳过、不重复扣费。
> ⚠️ 但带 `--max-revise` 重跑会**重写**已存在章节（质量门槛模式下追求整体质量），想纯省钱续写就别带 `--max-revise`，用 `resume`。

**查看状态**：

```bash
pnpm write -- list                  # 列出所有项目
pnpm write -- status <projectId>    # 查单个项目进度（bible/蓝图/章节）
```

写作产物存进 `data/writer/writer.db`（SQLite），另导出人类可读的 `<projectId>-ch<from>-<to>.txt`。

### 二、评估（CLI）

评估一本小说，输出五维报告：

```bash
pnpm eval -- ./data/spike-samples/sample-novel.txt \
  --genre 都市言情 \
  --audience 青年女性 \
  -y
```

评估前会显示字数、章节数、预估耗时与费用。完成后打开 `data/reports/<taskId>/report.html`。

**改稿对比**——评估两版，生成差异报告：

```bash
# 先评估两版
pnpm eval -- ./book-v1.txt --genre 玄幻 --audience 青年男性 -y
pnpm eval -- ./book-v2.txt --genre 玄幻 --audience 青年男性 -y

# 再对比（拿到两个 result.json 路径）
pnpm compare -- ./data/reports/<task-a>/result.json ./data/reports/<task-b>/result.json --html
```

### 三、Web 端

可视化界面，适合看写作进度、章节内容、质量趋势、配置引擎。

**生产模式**（单服务，需先构建前端）：

```bash
pnpm web:build    # 构建前端到 packages/web/dist/
pnpm web          # 启动 → http://localhost:3000
```

**开发模式**（前端热更新，需开两个终端）：

```bash
pnpm web          # 终端 1：后端 API 在 :3000
pnpm web:dev      # 终端 2：Vite 前端在 :5173（自动代理 /api 到 3000）
```

Web 端能力：新建项目、触发写作、**暂停/继续/取消**任务（章节边界生效）、查看章节网格与进度条、阅读章节正文、查看 bible 与叙事状态、质量趋势图、切换引擎/模型。

---

## 数据目录

```
data/
├── writer/              # 写作数据（SQLite）
│   ├── writer.db        # 所有项目、bible、章节、叙事状态
│   └── <id>-ch*.txt     # 导出的章节正文（人类可读）
├── reports/<taskId>/    # 评估输出
│   ├── result.json
│   └── report.html
└── spike-samples/       # 评估示例样本
    └── sample-novel.txt # README 演示用（已入库）
```

整个 `data/` 默认 gitignore（运行时数据，含真实小说样本），仅 `data/spike-samples/sample-novel.txt` 例外入库。

---

## 开发

```bash
pnpm typecheck    # 全包类型检查
pnpm test:unit    # 单元测试（writer/eval/shared/web）
```

仓库结构：

```
packages/
├── shared/   # 共享底座：引擎适配器、YAML 配置、文本工具
├── writer/   # 写作：bible + outline + chapter + 质量门槛 + 断点续写
├── eval/     # 评估：Map/Reduce 五维评分 + HTML 报告 + 改稿对比
└── web/      # Web：Hono 后端 + React/Vite 前端
```

## License

MIT
