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
| 标注 | `annotate.ts` | 段落→旁白/对白/信件（`**…**`）三类；说话人启发式识别（"XX说"）；每段带 voice/rate/pitch/gap。台本落盘为 `script.json` 工件，**可人工审校后单独重跑合成** |
| 合成 | `tts/` | 可插拔引擎（见下） |
| 装配 | `audio.ts` | 片段拼接+呼吸停顿 → 两遍 loudnorm 归一到 **-16 LUFS / TP -1.5**（YouTube 播放标准） |
| 视频 | `video.ts` | 封面居中 + 模糊放大背景 + Ken Burns 缓推，1080p25 h264，faststart |
| 物料 | `youtube.ts` | 生成 `youtube-upload.json` + `UPLOAD.md`（标题/描述/标签/播放列表/AI 披露检查单） |

## TTS 引擎

| 引擎 | 质量 | 成本 | 状态 |
|------|------|------|------|
| `edge`（默认） | 中上，多音色，无情感控制 | 免费 | ✅ 已实测 |
| `minimax` | 第一梯队（speech-02-hd，情感+自训音色） | ~¥1-2/万字 | ⚠️ 按 t2a_v2 文档编写，**未实测**——填 `MINIMAX_API_KEY`/`MINIMAX_GROUP_ID` 后先跑 `--chars 300` 验证 |
| `local`（CosyVoice/GPT-SoVITS sidecar） | 取决于音色 | 免费+GPU | 📋 本机 M4 无 NVIDIA GPU，CPU 推理慢（MPS 比 CPU 还慢，官方 issue 确认），不建议在此机器部署；如有 GPU 机器，起 HTTP 服务后照 `TtsEngine` 接口加适配器即可 |

音色映射在 `annotate.ts` 的 `DEFAULT_VOICE_CONFIG`（edge 音色名 ↔ minimax 音色名在 `tts/minimax.ts` 对应）。

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
