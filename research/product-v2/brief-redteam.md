# 任务书：NovelEval 2.0 方案红队评审（Cursor 新模型）

## 背景

`/Users/reed_soul/code/novel-eval` 的产品 2.0 方案已经过一轮会诊并合成：
- `research/product-v2/PLAN-2.0.md` —— 合成拍板版（你要攻击的主目标）
- `research/product-v2/zcode.md` —— ZCode 自诊
- `research/product-v2/cursor-grok.md` —— Cursor 上一轮会诊（42KB）
- `research/product-v2/brief.md` —— 原始任务书（背景与用户痛点原话）

用户（独立小说作者+独立开发者，单人本地工具）已认可大方向但尚未拍板 M0 范围。

## 你的任务：红队

**先读上述四个文档 + 关键代码**（Layout.tsx / main.tsx / Audiobook.tsx / audiobook.ts / ProjectDetail.tsx），然后专门做三件事：

1. **攻击 PLAN-2.0**：哪些决策是错的/想当然的？哪些被过早排除的替代方案其实更好？「书→衍生→集」四层 drilling 在单人 10 本书规模下是否过度设计？M0 范围是否切得对（太大/太小/顺序错）？工期估计靠谱吗？
2. **补盲区**：三位会诊者（含上一轮的你）都漏掉了什么？至少给出 3 个没人提过的风险或机会（可从：数据迁移与旧产物兼容、状态机实现成本、本地单人工具的"任务"全局化必要性、作者实际工作节奏（写书期 vs 制作期分离）、成本可见性（LLM/TTS 计费）等角度，但不限于这些）。
3. **给出你的修正案**：对 PLAN-2.0 的具体修改建议（页级），以及你独立排的 M0 任务清单（若与原案不同，说明为什么）。

## 规则

- 尖锐直接，不要客气；上一轮 cursor-grok.md 的结论也在可攻击范围（允许自我推翻）
- 只写你自己的输出文件：`research/product-v2/cursor-redteam.md`
- 除该文件外不得修改仓库任何文件；不写业务代码
- 中文输出，800-1500 行，结构化
