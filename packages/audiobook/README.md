# @novel-eval/audiobook

原创小说 → 有声书成品的自动化管线：**writer.db 章节 → 台本标注 → TTS 合成 → 音频装配 → 视频渲染 → YouTube 上传物料**。

一条命令：

```bash
pnpm audiobook build --project 最后一班森铁 --chapters 1 --chars 600   # 试产（约 30s）
pnpm audiobook build --project 最后一班森铁 --chapters 1-15            # 整本（15 章 × ~4min 音频）
```

## 管线阶段

| 阶段 | 模块 | 说明 |
|------|------|------|
| 取稿 | `db.ts` | 从 writer.db 读 active_revision 定稿（只读） |
| 项目配置 | `project-config.ts` | per-project 发音表+角色班底（见下）；自动发现 `data/audiobook/projects/<书名>.json` |
| 标注 | `annotate.ts` | 段落→旁白/对白/信件（`**…**`）三类；说话人识别（"XX说"前/后两式 + cast 名单校验 + 段内唯一归属传播）；每段带 voice/rate/pitch/gap。台本落盘为 `script.json` 工件，**可人工审校后单独重跑合成** |
| 合成 | `tts/` | 可插拔引擎（见下）；edge/volcengine 均带**段级落盘缓存**（断点续跑，换图重渲不重烧配额） |
| 装配 | `audio.ts` | 片段拼接+呼吸停顿 → 两遍 loudnorm 归一到 **-16 LUFS / TP -1.5**（YouTube 播放标准） |
| **审听** | `listen.ts` | **行业 proofer 的机器版**：whisper 转写章音频 → 按装配时间窗切回逐段 → CER 字错率打点；`--fix` 删坏段缓存触发重合成、`--srt` 用 ASR 实测时间戳重对齐整集字幕 |
| 视频 | `video.ts` | 封面居中 + 模糊放大背景 + Ken Burns 缓推，1080p25 h264，faststart |
| 物料 | `youtube.ts` | 生成 `youtube-upload.json` + `UPLOAD.md`（标题/描述/标签/播放列表/AI 披露检查单） |

## per-project 配置（发音表 + 角色班底）

`data/audiobook/projects/<书名>.json`（或 `--config` 指定）。对应行业 prep 的 pronunciation guide / character sheet：

```jsonc
{
  "pron": [                          // 发音表：字面短语→朗读替换，长词优先；替换同时进字幕
    { "match": "110", "read": "幺幺零", "note": "防念一百一十" },
    { "match": "柈子", "read": "绊子", "note": "东北话柴火 bàn zi" }
  ],
  "cast": ["程砚秋", "周德厚", "老周头", "苏野"],   // 角色名单（含别名，长名在前）：归属校验+假名过滤
  "voiceBySpeaker": [                // 角色→音色（长名/别名各配一行）
    { "match": "苏野", "voice": "zh-CN-XiaoyiNeural" }
  ]
}
```

新增错读词的工作流：跑 `listen` 看 suspect/bad 打点 → 人耳确认 → 加 pron 条目 → 重跑 build（缓存保证只重合成受影响段）。

## 审听（proof-listen）

```bash
pnpm audiobook listen --out dist/audiobook-v4 --ep 01              # 报告模式（不动任何文件）
pnpm audiobook listen --out dist/audiobook-v4 --ep 01 --srt        # + 字幕真实时间戳重对齐（原稿备份 .bak）
pnpm audiobook listen --out dist/audiobook-v4 --ep 01 --fix        # + 删 bad/missing/silent 段缓存 → 重跑 build 只补这些段
```

- 判级：`ok` / `suspect`（CER>0.10，默认）/ `bad`（≥0.30）/ `missing`（合成失败段，对应 tts-failures.json）/ `silent`（有音频但 ASR 没听见）。
- ASR 结果缓存在 `chNN/listen/asr.json`（音频不变不重转写）；改判级阈值重跑是纯重算，秒级。
- 比对归一已处理 whisper 两大假阳性：繁体输出（繁简映射）、数字转写差异（一九九八↔1998）；邻窗救援用半全局对齐吞掉「一行吞多段」的时序伪影。残余 suspect 多为 whisper 小模型近音听岔（如 皱眉→咒梅），报告是**给人耳排优先级的雷达**，不是自动改稿器。

## 画本 golden set

`tests/golden/sentie-ch*.json` 冻结真实章节（人工抽验过归属）的期望输出；哨兵冻结归属率与漏对话绊线（spanCoverage 必须=1）。**改画本规则 → 重生成（`tsx tests/golden/gen.ts`）→ 人工抽验归属清单 → 才许提交**。

## TTS 引擎

| 引擎 | 质量 | 成本 | 状态 |
|------|------|------|------|
| `edge`（默认） | 中上，多音色，无情感控制 | 免费 | ✅ 已实测 |
| `volcengine` | 高（Seed-TTS-2.0，情绪参数，悬疑解说班底） | Agent Plan 配额 | ✅ 已实测；段级缓存+3 次退避重试+失败清单（tts-failures.json，不炸长跑） |
| `minimax` | 第一梯队（speech-02-hd，情感+自训音色） | ~¥1-2/万字 | ⚠️ 按 t2a_v2 文档编写，**未实测**——填 `MINIMAX_API_KEY`/`MINIMAX_GROUP_ID` 后先跑 `--chars 300` 验证 |
| `local`（CosyVoice/GPT-SoVITS sidecar） | 取决于音色 | 免费+GPU | 📋 本机 M4 无 NVIDIA GPU，CPU 推理慢（MPS 比 CPU 还慢，官方 issue 确认），不建议在此机器部署；如有 GPU 机器，起 HTTP 服务后照 `TtsEngine` 接口加适配器即可 |

音色映射在 `annotate.ts` 的 `DEFAULT_VOICE_CONFIG`（edge 音色名 ↔ 各引擎音色名在各适配器 VOICE_MAP 对应）。**角色班底按书配置**在 `data/audiobook/projects/`，代码里只留默认值——换书零改码。

## 生产升级路径

1. **音色专属化**（频道资产）：GPT-SoVITS 用 1 分钟样音微调自有音色 → 或 MiniMax voice clone → 换 `VOICE_MAP`
2. **情感标注 LLM 化**：`annotate.ts` 的规则标注可换/可叠加上游 LLM 按句打情感标签（rate/pitch/停顿三参已预留）
3. **字幕**：edge 引擎天然支持 `--write-subtitles`（词级时间戳），需要时在 `tts/edge.ts` 打开即可产出 srt
4. **自动上传**：用 `youtube-upload.json` 对接 YouTube Data API（需 OAuth）；当前版本为半自动（人工上传 + 物料核对）

## 平台合规（YouTube Inauthentic Content 政策，2025-07 生效）

- ✅ 内容为**原创小说**（最大护城河，非批量搬运）
- ✅ 每集上传时勾选 **"含 AI 生成内容"** 披露
- ✅ 视频带模糊底+缓推等加工，非纯静态图
- ✅ `UPLOAD.md` 内置逐集检查单；建议每集开头保留 30-60s 真人开场（最强人类参与信号）

## 开发

```bash
pnpm --filter @novel-eval/audiobook typecheck
pnpm --filter @novel-eval/audiobook test        # 标注器单元测试
```

依赖：ffmpeg/ffprobe、uv（edge-tts 经 uvx 调用）。所有 CLI 输入在入口净化（路径锁仓库根内、参数白名单）。
