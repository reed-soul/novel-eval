# HANDOFF — short-drama 管线付费门禁交接（2026-09-13）

> 状态：管线、skills、3 集剧本、角色圣经全部就位，停在「付费门禁前」。
> 下一动作者：用户（提供凭据）→ agent（跑 character_lock 肖像生成 + 资产探针）。

## 已完成（全部零成本）

| 交付物 | 位置 |
|---|---|
| 短剧管线定义（7 阶段，通过 pipeline_loader 校验） | `pipeline_defs/short-drama.yaml` |
| 8 个导演 skills（总制片+7 阶段手艺规范） | `skills/pipelines/short-drama/` |
| 3 集工作区 + checkpoint 状态机（停在 screenplay awaiting_human） | `projects/wuye-drama-ep0{1,2,3}/` |
| 3 集 source_packet + drama_script（60-90s，钩子/转折/悬念齐） | 各项目 `artifacts/` |
| 系列角色圣经（4 张待生成肖像 + 音色池；EP1 两个角色免露脸省成本） | `projects/wuye-drama-ep01/artifacts/character_bible.json` |

## 需要用户做的（按优先级）

1. **审剧本**：`projects/wuye-drama-ep0{1,2,3}/artifacts/drama_script.json`（或看本目录 SCREENPLAYS.md 速览）。过目后口头发话即视为 approval，agent 写回 checkpoint。
2. **提供凭据（二选一起步）**：
   - **路线 A（推荐，最便宜）**：火山引擎控制台开通「即梦视频生成/智能创作云」→ 拿 `VOLC_ACCESSKEY` + `VOLC_SECRETKEY`（IAM AccessKey 对，visual.volcengineapi.com 用）。720P 0.28 元/秒。
   - **路线 B**：火山方舟 ARK 的 **控制台 API Key**（注意：现用的 Agent Plan key 只实测过文本+语音，视频模型未验证）→ `ARK_API_KEY`（只要 key 本体，不带 Bearer）。走 `seedance_ark`。
   - 生图（定妆照 4 张）：即梦生图或方舟 Seedream，同账号体系；edge-tts/豆包语音沿用现有。
   - key 注入方式：`export` 到跑 agent 的 shell（沿用「绝不落盘」惯例）。
3. **确认预算上限**：默认单集 $8（≈¥60-200）。3 集样片全算上 ≤ ¥1000。探针（1 个 5 秒 720P 镜头 ≈ ¥1.4）先行。

## 凭据就绪后的执行序（agent 接手）

```bash
# 1. 探针（验证凭据+连通，成本约 ¥1.4）
#    用 seedance_ark 或 jimeng_video 生成一个 5s 720P 测试镜头到 projects/wuye-drama-ep01/assets/video/probe.mp4
# 2. 定妆照 4 张（陈默×2 张、周芸、张磊、陆队 → 共 6 张含全身）→ character_lock checkpoint
# 3. EP01 storyboard（10 镜 shot_list，逐镜竖屏 prompt）→ storyboard checkpoint（人工审）
# 4. EP01 assets：先 TTS（约 10 句，几乎免费）→ 再非对白镜头 → 再对白镜头
# 5. EP01 compose：ffmpeg concat + CJK 字幕 + 双轨记录 → render_report
# 6. EP01 publish 包：标题/描述/清单（用户上传，勾 AI 披露）
```

## 风险提示

- Agent Plan key 若探不通视频模型，别反复试（每次都是钱/配额）——直接转路线 A。
- 短剧管线与 OpenMontage 上游同步：本管线为本地新增文件，`git pull` 上游无冲突风险（新增路径）。
- 与另一路并发 AI 的分工：本仓工作全部圈在 `research/OpenMontage/`（克隆副本）+ `research/openmontage-drama/`，未触碰 novel-eval 主仓任何文件。
