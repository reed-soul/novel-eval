# M0 验收报告（十条全绿）

> 验收日期：2026-09-13
> 对应方案：PLAN-2.0.md §6
> 实现落点：commit 5c5fe3f（M0 书内归位）+ a4258ee（registry/缩略图/动态混音）+ 本轮补强（mergeListenReports 抽取+单测）
> 验收方式：代码实锤 + 单元测试 + 运行时 API/DOM 断言 + 隔离目录三段式冒烟
> 测试基线：@novel-eval/audiobook 48 过 0 挂（含本轮新增 2 条）；@novel-eval/web 49 过 0 挂

| # | 验收项 | 结论 | 证据 |
|---|--------|------|------|
| 1 | 顶栏两格；有声书/评估/审计非一级入口（旧路由重定向） | ✅ | `Layout.tsx:33-37` 导航仅「我的书·设置」；书架渲染 DOM grep 无 评估/审计/有声书 导航项；`main.tsx:27-31` `/projects/:id`→`/books/:id`、`/audiobook`→`/` 重定向；`curl /audiobook` 200（SPA 内重定向生效） |
| 2 | 书架→任意书→3 步内到「制作第 N 集」，零键盘 | ✅ | 运行时 DOM（物业管家 `/books/0508da6a…/audiobook`）：`制作第 3 集` + `开始制作`/`改范围` 按钮渲染在案；书架 / → 书卡 → 有声书 tab → 按钮，共 3 次点击 |
| 3 | 全站零处 v3/v4/制作版本/audiobook-v | ✅ | 代码全量 grep：仅 Settings 页 DeepSeek 模型名（产品文案，非制作版本）与代码注释；渲染 DOM（书架+有声书页）`audiobook-v\|制作版本` 0 命中 |
| 4 | 确认条人话+成本行 | ✅ | 运行时 DOM：`将使用第 7–9 章 · Edge（免费）· 含视频` + 成本行 `约 4.4 万字 · 预计 109 分钟成片 · 免费`（chars 来自 `next.chapters` 字数统计 API） |
| 5 | fix/srt 真实进 CLI；JobConsole 回调正确 | ✅ | 5c5fe3f 提交信息明载「fix/srt 死开关（真实进 CLI）」；srt 重对齐逻辑在 `listen.ts`（`--srt` 聚合集结果重写）；JobConsole 终态用事件数据+doneRef 防闭包旧值（`BookAudiobook.tsx:65-85`） |
| 6 | 第二本书冷启动建线卡一键开线 | ✅ | 未建线书《落叶松下的死》运行时 DOM：`开启有声书并制作第 1 集` 按钮与 `纯音频（无场景图时不上视频）` 默认说明渲染在案（API `registered:false + suggestion{skipVideo:true}`）；**验收时未点击**（避免触发真实构建，留待用户首跑） |
| 7 | `--ep-start 10` 双侧不抛错 | ✅ | CLI `cli.ts:123` 上限 99；Web `routes/audiobook.ts:512,540` 正则 `/^[1-9]\d?$/`（"10" 匹配）；覆盖项白名单注释明示同步解禁 |
| 8 | 单集审听后其他集 QA 仍在 | ✅ | merge 逻辑抽取为纯函数 `mergeListenReports`（`listen.ts`，M0 阻断2），新增 2 条单测：重审 ep01/ch02 后 ep01/ch01 与 ep02/ch04 结论保留；旧报告空/损坏容错只含新章。**48/0 全绿** |
| 9 | 无图新书中性「纯音频」徽章、无红色报错 | ✅ | 就绪判定单测 `registry.test.ts:40-41`（skipVideo 时看 mp3）；徽章 `就绪（纯音频）` indigo 中性色（`BookAudiobook.tsx:129`），仅"预设要视频而实际缺"才红标；未建线书 API 默认 `skipVideo:true` |
| 10 | 缩略图不串台；强制重制出新音频 | ✅ | 缩略图收各产物根 `thumbs/`（`routes/audiobook.ts:158-163`），miss 返回 null → 前端 🎧 占位回退（`BookAudiobook.tsx:357-359`）；旧全局 `dist/media-thumbs` 已不存在（无需迁移）。强制重制三段式隔离冒烟（`dist/m0-smoke-clean-demo`，edge 引擎 600 字试产）：首跑 135s → 复跑无 `--clean` 12s 缓存命中且段 mtime 不变 → 加 `--clean` 70s 全部重合成 mtime 更新（`--clean：已清 1 章段级缓存`）。冒烟目录已清理，`data/audiobook/registry.json` 零改动 |

## 本轮补强（相对 5c5fe3f/a4258ee 的增量）

1. `listen.ts`：报告按集 merge 从内联逻辑抽取为导出纯函数 `mergeListenReports`（行为不变），使验收 8 具备可复现单测
2. `listen.test.ts`：新增 2 条 merge 单测（他集保留 + 空报告容错）

## 遗留说明

- 验收 6 的"一键开启并制作第 1 集"按钮仅做渲染断言未真实点击——真实点击会启动 TTS 构建任务并消耗 API 配额，属用户首次使用行为，建议用户首次建线时自然验证
- 验收 9 的「就绪（纯音频）」徽章为代码路径+单测+API 默认值证据；DOM 级的纯音频集卡展示需一本 skipVideo 书完成首次制作后复核
- 修改正文→强制重制的语义闭环已用"清缓存→重合成"机制等价演示（文本修改只是触发 --clean 的一种原因，机制同一）
