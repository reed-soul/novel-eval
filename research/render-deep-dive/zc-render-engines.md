# 替代 ffmpeg 滤镜图的视频渲染引擎 · 深度调研报告

> 研究员：ZCode（多媒体工程方向）· 调研完成日期：2026-08-30
> 场景：有声书视频，10-18 min、1080p、静态场景图 + Ken Burns 缓推 + 粒子雪 + mov_text 字幕 + AAC 音频；目标机 Apple M4/16GB macOS；低并发（≤2-3 路）串行为主；当前 ffmpeg（zoompan + gbrp blend + h264_videotoolbox，12fps）单集约 8 分钟且无任何视频层缓存。
> 证据分级：**[已验证]** = 官方文档/一手来源/可复查的公开数据；**[社区经验]** = StackOverflow/Reddit/GitHub issue 等非官方实践；**[推断]** = 本研究员基于数据的工程推断。

---

## 0. TL;DR

1. **没有任何一个引擎在「纯速度」上对本场景有碾压性优势**——因为本场景是近静态画面，瓶颈从来不是合成，而是「每集从零全时间线重编码」。任何引擎（包括 ffmpeg 自己）都必须靠**分段缓存 + 增量重渲 + concat** 解决，这与引擎选择正交。[推断]
2. 引擎的真正价值差异在：**画质天花板（subpixel Ken Burns、真 RGB 混合、24fps 免费化）、可编程性（场景图 vs filtergraph 字符串）、与 Web 端「一键出片」的收敛度**。[推断]
3. **Remotion 明确排除**：架构是 headless Chrome 逐帧截图 + ffmpeg 编码，2025-01 有 YC 公司实测「渲染耗时 = 视频时长的 2-4 倍」（8 vCPU + GPU 的云机器）；15 分钟一集在 M4 上预计 30-60 分钟，比现状慢一个数量级。[已验证]
4. **Motion Canvas / Revideo 排除为主力**：Motion Canvas 官方只支持浏览器编辑器 UI 内渲染（无 headless CLI），Revideo 仍是「浏览器逐帧捕获 + ffmpeg」同款架构；且 Motion Canvas 的 ffmpeg exporter 已改 **GPLv3**（商用分发传染风险）。[已验证]
5. **libplacebo/mpv 排除**：macOS 上 ffmpeg 的 libplacebo filter 依赖 MoltenVK 且 Homebrew 版根本不含该 filter（需自编译），mpv 社区还有 macOS Vulkan 渲染 glitch 报告；它是「实时显示」取向的渲染器，不是离线帧服务器。[已验证]
6. **值得认真做 PoC 的两条路线**：
   - **A. AVFoundation + Core Animation/Core Image + AVAssetWriter（Swift CLI）**：画质最好（CALayer float transform 天然 subpixel；VideoToolbox 直连），估计 15min@24fps 渲染 2-4 分钟；最大风险是 CAEmitterCell 离线渲染的时间轴坑（雪粒子建议自写确定性模拟或预渲染循环层）。[已验证+社区经验+推断]
   - **B. WebCodecs + Canvas（Node 侧 @napi-rs/webcodecs 或 headless Chrome）+ mediabunny 混流**：留在 TypeScript monorepo 内，与未来 Web 端出片共用同一套渲染代码；Screen Studio 已在生产中验证「WebGL 合成 + VideoFrame(canvas) 零拷贝 + VideoEncoder 硬编」路线。[已验证]
7. **自写 Metal/MPS compute shader 合成器**：速度上限最高但工程成本最重（文本整形、颜色管理、调试），对本场景属于过度投资；如走 GPU 自研，先用 **Core Image（Metal backend）** 起步。[推断]

---

## 1. AVFoundation + Core Animation 原生渲染（Swift CLI）

### 1.1 两条技术路线

**路线 A1：AVMutableVideoComposition + AVVideoCompositionCoreAnimationTool + AVAssetExportSession**
- `animationTool` 是 Apple 官方定义的「用于 Core Animation 离线渲染的 video composition 工具」，在 AVAssetExportSession 导出时生效。[已验证]（Apple 文档 https://developer.apple.com/documentation/avfoundation/avvideocomposition/animationtool ，访问 2026-08-30）
- CALayer 的 transform/position 全是 CGFloat，Core Animation 的插值天然 subpixel → **Ken Burns 平滑度免费解决**，这正是 ffmpeg zoompan 的死穴（见 §8）。[已验证-机制][推断-效果]
- 教学参考：Kodeco AVFoundation overlays 教程（https://www.kodeco.com/2734-avfoundation-tutorial-adding-overlays-and-animations-to-videos ，访问 2026-08-30）；Svehla/ios-animation-render 示例（https://github.com/Svehla/ios-animation-render ）。

**路线 A2（推荐做 PoC 的）：自驱渲染循环 + AVAssetWriter**
- 结构：CALayer 树（或 Core Image 管线）→ `CARenderer` 渲到 `MTLTexture` → 包成 `CVPixelBuffer` → `AVAssetWriterInputPixelBufferAdaptor` → `AVAssetWriter`（内部走 VideoToolbox 硬编，码率/GOP 全可控）。[社区经验]（StackOverflow「Rendering animated CALayer off-screen using CARenderer with MTLTexture」https://stackoverflow.com/questions/56150363 ；NextLevelSessionExporter 就是 reader+writer 模式的现成参考，https://github.com/NextLevel/NextLevelSessionExporter ）
- Fora Soft 2026 年 Swift 指南仍把 `AVMutableVideoComposition + AVVideoCompositing` 自定义合成器列为 iOS/macOS 视频效果的标准路线，并指出「Core Image 足以实时 60fps 1080p，Metal 是上限」。[已验证]（https://www.forasoft.com/blog/article/how-to-apply-an-effect-to-a-video-in-ios-64 ，标注 2026 guide，访问 2026-08-30）

### 1.2 2024-2026 有人用它做批量渲染吗？速度实测？

- **没有找到公开的「AVFoundation 批量渲染 vs ffmpeg」同工况对比 benchmark**。[已验证-缺失] 这是本次调研最明确的证据空白。
- 速度只能锚定编码端：VideoToolbox 硬编 H.264 1080p 在 M1/M2 级机器上约 **5-10× 实时**；M1 Max 上 HEVC 硬编实测约 8.5× 实时（3 小时视频 21.5 分钟编完）。[已验证]（ffmpeg-cookbook https://ffmpeg-cookbook.com/en/articles/hardware-encode-videotoolbox/ ；CodeTV https://codetv.dev/blog/hardware-acceleration-ffmpeg-apple-silicon ，访问 2026-08-30）
- 社区共识：VideoToolbox 速度跨 M 系世代差异不大（专用编码块），且画质/码率效率略逊 libx264（Apple 开发者论坛 https://developer.apple.com/forums/thread/678210 ）。注意：**这条对 ffmpeg 路线同样成立——所有「引擎」在 Apple Silicon 上最终都调同一个 VideoToolbox，编码器不是差异化点**。[已验证+社区经验]
- HandBrake 社区 2024-04 的 M1/M2/M3 x264/x265 基准数据帖佐证硬编速度与代际关系（https://www.reddit.com/r/handbrake/comments/1c3uf8d/ ）。

**速度推断 [推断]**：15 分钟 @24fps = 21600 帧。GPU 合成（一张纹理 affine 采样 + 一层粒子 + 一层文字）每帧 <1ms，VideoToolbox 编码 1080p24 约 300-600fps → 端到端瓶颈在管线喂帧，预计 **2-4 分钟/集**；即使保守估计也显著低于现状 8 分钟，且从 12fps 升到 24fps 几乎不加成本。

### 1.3 坑（重点）

1. **CAEmitterCell 粒子雪的离线渲染是本路线最大雷区**：
   - CAEmitterLayer 的粒子模拟由 Core Animation 自己的时钟驱动，离线导出按 composition 时间**非顺序**取帧渲染，`beginTime`/`emitterTimeOffset`/`isRemovedOnCompletion` 配置不当就会出现「不发射 / 提前发射 / 只在播放时可见」。[社区经验]（NSHipster CAEmitterLayer https://nshipster.com/caemitterlayer/ ；SO 43096533、SO 53468082、SO 52427597「Can't show animated CALayer in video using AVVideoCompositionCoreAnimationTool」；OpenRadar 17673：导出视频中 overlay 约前 1 秒不出现）
   - 多个开发者最终放弃 emitter 离线渲染，改用自定义逐帧渲染（CGContext/Metal）。[社区经验]
   - **落地建议 [推断]**：雪粒子不要依赖 CAEmitterLayer 的模拟时钟。两种确定性做法：(a) 自写 O(n) 粒子运动方程按帧号直接计算位置（雪是最简单的粒子，无交互）；(b) 预渲染一段（如 60s）无缝循环雪花 alpha 视频当纹理循环铺——与现在的做法等价但混合在 RGB 空间做对。
2. **AVAssetExportSession 的控制力**：preset 导向，码率/像素格式控制不如 AVAssetWriter 直接；社区常用 reader+writer 替代 export session 获得速度与参数控制（NextLevelSessionExporter 的存在本身即证明）。[社区经验]（SO「AVExportSession exporting video super slow」https://stackoverflow.com/questions/64204280 ）
3. **字幕轨**：AVFoundation **没有公开 API 把 SRT 作者化成 MP4 的 tx3g/mov_text 软字幕轨**（AVMutableComposition 只能搬运已有字幕轨道）。[推断-基于 API 面，未找到反例] 落地做法：Swift 只出「视频+音频」MP4，再用 ffmpeg 一条 `-c copy -i subs.srt -c:s mov_text` 的封装命令补字幕（秒级，无重编码）。
4. **无视频源的合成**：animationTool 的经典用法要求 composition 里有视频轨；无视频轨时需用 `additionalLayer:asTrackID:` 路径（Apple 头文件有此初始化器）。[已验证-文档存在][推断-细节]
5. **长视频/内存**：AVAssetWriter 是流式写入，15 分钟 1080p 不会有大内存问题；注意复用 CVPixelBuffer pool、以及自定义 AVVideoCompositing 的 passthrough 优化。[社区经验]（Medium「Building a Real-Time Video Editor with AVFoundation」https://medium.com/@alex_19513/real-time-video-editing-swift-2cc18f198c83 ）
6. **工程成本**：monorepo 里引入 Swift 子进程工具（spawn CLI），跨机器依赖 Xcode 工具链；CI/团队协作成本中等。

### 1.4 killer feature
**画质（subpixel Ken Burns + 真 RGB 混合 + Core Text 字幕渲染质量）与 VideoToolbox 零距离直连**；同一份 Core Animation 代码可上屏预览（AVPlayerLayer 实时看效果），迭代体验远好于「改 filtergraph → 重跑 8 分钟」。

---

## 2. WebCodecs + OffscreenCanvas（headless Chrome 或 Node）

### 2.1 成熟度

- WebCodecs 规范在 Chrome 94+（2021）落地，Safari 16.4+ 支持；Chrome macOS 的 `VideoEncoder` 就是 VideoToolbox 的薄封装，社区实测 FFmpeg+VideoToolbox 4K H.264 约 65-70fps 时 WebCodecs 同级。[已验证]（W3C WebCodecs issue #492 https://github.com/w3c/webcodecs/issues/492 ；Chromium 硬编 issue https://issues.chromium.org/issues/40249559 ；MDN https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API ）
- **Node 侧方案（重要新变量）**：`@napi-rs/webcodecs`（Brooooooklyn/webcodecs-node，Rust+FFmpeg 底座，MIT）：W3C WPT 573 项通过（99.1%）、macOS 走 VideoToolbox「零拷贝 GPU 编码」、AudioEncoder 支持 AAC/Opus/MP3/FLAC、自带 MP4/WebM/MKV 混流解流、可配合 @napi-rs/canvas 画图。项目尚年轻（约 93 stars），但工程质量信号良好（benchmark 套件、限制清单齐全）。[已验证]（https://github.com/Brooooooklyn/webcodecs-node ，访问 2026-08-30）
- **混流生态**：mediabunny（Vanilagy，mp4-muxer/webm-muxer 的继任者，零依赖纯 TS，MP4/WebM/MP3/HLS 读写转，直接对接 WebCodecs），MDN 已把它列为 WebCodecs 配套 muxer 的首选。[已验证]（https://mediabunny.dev/ 、https://github.com/Vanilagy/mediabunny ；Reddit 发布帖 2025 https://www.reddit.com/r/webdev/comments/1m2ivfg/ ）
- headless Chrome 的 WebGPU/硬件加速**默认不可用且会静默失败**（canvas 全黑），需要专门启动参数；three.js 社区 2025 年仍在踩坑。[社区经验]（agent-browser.dev WebGPU 指南 https://agent-browser.dev/webgpu ；three.js forum https://discourse.threejs.org/t/what-is-the-current-state-of-headless-rendering-with-webgpu/82600 ，2025）→ 若走 Chrome 路线，**Canvas2D/WebGL + WebCodecs 比 WebGPU 省心**；纯 GPU 离线渲染可用 Dawn 官方的 `webgpu` npm 包（node 内进程渲染，无需浏览器）。[已验证]（https://github.com/dawn-gpu/node-webgpu ）

### 2.2 实测速度/长视频表现（生产级证据）

- **Screen Studio 导出管线（最好的公开一手案例）**：WebGL 合成 + `new VideoFrame(canvas)`（GPU 级取帧、**绝不 readPixels 回 JS**）+ VideoEncoder 硬编。关键数据：早期版本 readPixels 占单帧 70-80% 时间；HTML5Video seek 每次要等 20-100ms（硬上限 ~50fps）；VideoDecoder 同时只给约 10 个 VideoFrame（GPU 纹理很贵，必须及时 close）；encoder 队列会无界增长需自己做背压；编码后的裸流需自行 mux、音频需另行拼装。结论「永远不要把像素读回 JS 内存」。[已验证]（pietrasiak.com「Fast video rendering and encoding using web APIs」https://pietrasiak.com/fast-video-rendering-and-encoding-using-web-apis ，访问 2026-08-30）
- **对本场景的含义 [推断]**：我们没有输入视频解码/seek 问题（场景图是静态纹理，雪是循环视频或自绘粒子），Canvas2D `drawImage` 的 affine 变换天然 subpixel（浏览器插值），每帧成本毫秒级；21600 帧的合成+编码预计 **1.5-4 分钟/集**（M4）。内存：编码是流式的，只要 (a) 及时 close VideoFrame (b) encoder 队列限深，15 分钟无压力。
- 确定性：完全自控——每个时间步重画整帧（不依赖动画时钟），渲染结果可复现，天然适合按段缓存。[推断]

### 2.3 以 WebCodecs 为核心的渲染框架（2025-2026 新出现）

| 框架 | 定位 | 状态 |
|---|---|---|
| **Helios**（BintzGavin/helios，heliosrender.com） | "Code to Video Engine"：用 CDP `Emulation.setVirtualTimePolicy` 虚拟化浏览器时钟逐帧推进（每帧预算 33.33ms），DOM 路线走 Playwright 截图，Canvas 路线走 WebCodecs VideoEncoder；ffmpeg 子进程负责编码/混流；有 CLI `npx helios render`；渲染确定性可保证 | Beta，约 94 stars，ELv2 协议（不能拿它做托管服务），自述「AI agent 舰队开发、人类审架构」。[已验证]（https://github.com/BintzGavin/helios 、https://www.heliosrender.com/ ，访问 2026-08-30） |
| **diffusion-studio/core** | 浏览器端 TS「视频游戏引擎」，Canvas2D/WebGL，面向交互编辑器与 AI agent | 年轻、面向编辑器场景，非批量渲染。[已验证]（https://github.com/diffusionstudio/core ） |
| **mediabunny** | 不是引擎，是 WebCodecs 时代的「web 版 ffmpeg」mux/demux/convert 库 | 活跃，MDN 推荐。[已验证] |
| 「eternal」「eternity」 | 检索 2024-2026 无名为此名的可用渲染引擎；唯一接近的是 kousun12/eternal——个人向「节点图音频/视觉创作」浏览器实验项目，非本场景可用引擎 | [已验证-缺失]（https://github.com/kousun12/eternal ） |

**注意**：Helios 的「虚拟时间」思路恰好解决了浏览器路线的动画时钟问题（与 §1.3 CAEmitter 的坑同源），值得跟踪，但 beta 状态不建议直接压注生产。[推断]

### 2.4 killer feature
**与未来「Web 端一键出片」共享同一套渲染代码**（浏览器与 Node 都能跑同一份 Canvas/WebCodecs 合成逻辑 + mediabunny 混流）；留在 TS monorepo，无新工具链。

---

## 3. Remotion

- **架构（决定性事实）**：bundle → **headless Chrome 逐帧截图**（JPEG/PNG）→ ffmpeg + Rust compositor 缝合编码。多页签并发截图，`--concurrency` 需要用 `npx remotion benchmark` 调优，过高过低都更慢。[已验证]（Remotion 架构文档/zread 索引 https://zread.ai/remotion-dev/remotion/13-headless-browser-frame-capture 、https://www.remotion.dev/docs/performance ，访问 2026-08-30）
- **长视频实测（2025-01）**：YC S24 公司 Overlap 的 founding engineer 在 issue #4783 报告：在 8 vCPU + 24GB + GPU 的 GCP Cloud Run 上，全片带动画的渲染「耗时约为视频时长的 2-4 倍」，并直指「逐帧截图再串起来本质低效」；issue 已关闭且页面未见官方解答回应。[已验证]（https://github.com/remotion-dev/remotion/issues/4783 ，2025-01-22）
- 换算到本场景 [推断]：15 分钟一集在比 M4 更强的云机器上要 30-60 分钟；M4/16GB 上只会更差（多 Chrome 页签内存压力大，与「低并发」约束冲突）。**比现有 ffmpeg 8 分钟慢一个数量级，直接排除。**
- 官方性能建议也印证瓶颈在架构：云实例无 GPU 时 WebGL/canvas/模糊类效果是瓶颈，建议「用预计算图片替代」——恰好说明它不适合本场景这种「全片都是 canvas 级画面」的输入。[已验证]（https://www.remotion.dev/docs/performance ）
- Lambda 提速与本机无关（用户已排除）；License：个人与 ≤3 人公司免费，更大公司 $25-100/seat/月（Remotion 5.0 起带许可遥测）。[已验证]（https://www.remotion.dev/docs/license/pricing ，访问 2026-08-30）
- **killer feature**：React 模板生态与参数化视频（做营销视频极强），不是速度。对本项目无意义。

---

## 4. Motion Canvas 与其他新引擎

- **Motion Canvas**：渲染**只能在浏览器编辑器 UI 里点 RENDER 按钮**（输出 PNG/JPEG/WebP 序列），无官方 headless CLI；音频在导出时另走 ffmpeg complexFilter 混流。[已验证]（https://motioncanvas.io/docs/rendering 、https://motioncanvas.io/docs/rendering/video ，访问 2026-08-30）→ 与「CLI 批量、低并发队列」的工程形态冲突。
- **许可证警示**：Motion Canvas 的 ffmpeg exporter 包因链接 ffmpeg 改为 **GPLv3**（官方 commit message 确认），只用图片序列导出不受影响。对本项目（自用不分发）风险低，但若未来做 SaaS 分发需注意。[已验证]（zread 索引 https://zread.ai/motion-canvas/motion-canvas/4-latest-updates ）
- **Revideo**（Midrender，YC S23）：Motion Canvas 的 fork，补上了「库化 + 服务端渲染 API + 模板」，但渲染架构仍是浏览器帧捕获 + ffmpeg；作者在 issue #50 澄清定位差异。无 15 分钟级公开基准。[已验证]（https://midrender.com/revideo 、https://github.com/midrender/revideo/issues/50 ；2026 对比文 https://www.pkgpulse.com/guides/remotion-vs-motion-canvas-vs-revideo-programmatic-video-2026 ）
- 社区旁证（Puppeteer 逐帧捕获路线的代价）：Babylon.js 论坛报告服务端 Puppeteer 渲 3 分钟视频可花数小时。[社区经验]（https://forum.babylonjs.com/t/ideas-on-beefy-offline-render/24670 ）
- **结论**：这一族（Remotion/Motion Canvas/Revideo/Helios-DOM 路线）共同短板是「以浏览器为渲染器」，对本场景（近静态、长时长、追求吞吐）都不合身；唯一例外是 Helios 的 **Canvas-to-Video(WebCodecs)** 路线，本质上是 §2 的自研方案加了一层脚手架。[推断]

---

## 5. libplacebo / mpv 渲染管线做帧服务器

- macOS 上 ffmpeg 的 libplacebo filter 需要 Vulkan（经 MoltenVK）后端，且**必须自编译 ffmpeg**：Homebrew 版不含该 filter（用户实测 "No such filter: libplacebo"，MoltenVK issue #2618），libplacebo 官方支持面为 Vulkan(含 MoltenVK)/OpenGL/D3D11（ffmpeg-user 邮件列表 2025-05）。[已验证]（Reddit r/ffmpeg https://www.reddit.com/r/ffmpeg/comments/1n3fzml/ ；https://ffmpeg.org/pipermail/ffmpeg-user/2025-May/059237.html ；https://github.com/KhronosGroup/MoltenVK/issues/2618 ）
- mpv 侧：2025-2026 有 macOS 15 上 gpu-next(Vulkan/MoltenVK) 绿块/闪烁的 glitch 报告（mpv #17258）；且 filter 链还需 `hwupload`/`format=vulkan` 配合（SuperUser 1729993）。[已验证]（https://github.com/mpv-player/mpv/issues/17258 ；https://superuser.com/questions/1729993/ ）
- libplacebo 的强项是高质量缩放/色调映射（如 ewa_lanczos，ffmpeg 8.0 filter 文档），**不是**带粒子/文字/多层的合成场景图；它面向实时显示，离线逐帧确定性服务不是设计目标；用 mpv `--vo=image` 逐帧 dump 做帧服务器属于 hack。[推断]
- **结论：macOS 上投入产出比为负，排除**（Linux/Vulkan 平台上才是好选择）。

---

## 6. Metal/MPS 自写 compute shader 合成器

- 需要自建的件：affine 纹理采样（Ken Burns，一行 fragment shader）、粒子雪（点精灵或 compute 更新位置，或直接预生成一张含运动矢量的粒子表）、**文本渲染（Core Text 光栅化 atlas 或 harfbuzz+自光栅——最大隐性成本）**、RGB→NV12 输出、接 VTCompressionSession/AVAssetWriter。MPS 在此**没有用处**（WWDC25 的 Metal 4 新投资方向是 tensor resource/shader ML，面向 ML；普通采样混合不需要 MPS kernel）。[已验证-Metal4 事实]（WWDC25 session 262 https://developer.apple.com/videos/play/wwdc2025/262/ ；MPS 文档 https://developer.apple.com/documentation/metalperformanceshaders ）[推断-工作量]
- 收益：速度上限最高（合成可到数百 fps，端到端或可压到 ~1-2 分钟/集）、确定性完美、缓存粒度任意。
- 成本：文本整形/抗锯齿/阴影、颜色管理、帧节奏、调试器与测试全自担；社区无现成轮子（最接近的 Loomos-hub/glide-ffmpeg——用 PyTorch `grid_sample` 做 GPU subpixel Ken Burns 替代 zoompan——只有 1 star，且是 CUDA 路线，仅作为「需求真实存在」的佐证）。[已验证-存在]（https://github.com/Loomos-hub/glide-ffmpeg ）
- **务实中间态 [推断]**：用 **Core Image（CIContext with Metal）** 组管线——CILanczosScaleTransform/自定义 CIBlendKernel（screen 混合在 RGB 空间一行搞定）、Core Text 直接出 CIImage 文字——能拿到 Metal 的大部分速度与全部 subpixel 画质，代码量约为纯 Metal 的 1/5。Fora Soft 指南的结论一致（CI 是 fast path，Metal 是 ceiling）。[社区经验]（https://www.forasoft.com/blog/article/how-to-apply-an-effect-to-a-video-in-ios-64 ）

---

## 7. 关键问题：相对「ffmpeg 分段缓存 + concat」有没有碾压性优势？

**逐项对照（本场景=大部分时间近静态）**：

| 维度 | ffmpeg 分段缓存+concat | AVFoundation/CI（路线 A） | WebCodecs+Canvas（路线 B） | Remotion/MC 系 | libplacebo | 纯 Metal |
|---|---|---|---|---|---|---|
| 纯速度（近静态、已缓存时） | concat `-c copy` 秒级组装，**无可超越** | 段级也可缓存；全量重渲 ~2-4min [推断] | 同左 | 30-60min [已验证外推] | n/a | ~1-2min [推断] |
| 画质天花板 | zoompan 整数取整是 filter 级 bug（trac #4298），修抖要 4x supersample，CPU 成本大涨；gbrp 往返 | subpixel 免费、24fps 免费、RGB 混合正确 | 同左（Canvas 插值） | 理论同 Web，但每帧成本高 | 缩放质量最好，但无合成语义 | 最高 |
| 可编程性 | filtergraph 字符串，动态构图痛苦 | CA/CI 场景图，Swift | Canvas/TS 场景图，**与 monorepo 同构** | React 最强表达力 | 弱 | 最强但全自写 |
| 长视频可行性 | 已验证（现役） | AVAssetWriter 流式，OK [社区经验] | 流式+背压，OK [已验证-实践] | 差 | 差 | OK |
| 工程成本 | 最低（现状） | 中（Swift 子进程 + 字幕仍靠 ffmpeg 封装） | 中（TS 内；Node 侧库尚年轻） | 低-中但结果不可用 | 高（自编译） | 最高 |
| 社区活跃度 | 极高 | 高（Apple 生态） | 快速上升（mediabunny/webcodecs-node/Helios） | 高/中 | 中 | 高（但视频合成方向案例少） |

**结论**：
1. 「碾压性优势」不存在于速度维度——**缓存与增量才是速度问题的正解，而任何引擎都要自己实现它**。ffmpeg 分段缓存路线的组装成本（concat `-c copy`）已经是理论下限。[推断]
2. 引engine 的碾压点在**画质与迭代**：(a) subpixel Ken Burns + 真 RGB screen 混合 + 24/30fps 在 CPU ffmpeg 上代价线性上涨、在 GPU 合成器上接近免费；(b) 场景图可编程性让「标题卡/渐变/景深光斑」这类后续需求从 filtergraph 噩梦变成几行代码；(c) 路线 B 额外锁定「Web 端一键出片」的长期目标。[推断]
3. 各引擎 killer feature 一句话：
   - AVFoundation/CA/CI：**VideoToolbox 零距离 + subpixel 画质 + 实时预览（AVPlayerLayer）**
   - WebCodecs+mediabunny：**TS/Web 全栈同构（Node 渲染=浏览器渲染）**
   - Remotion：React 参数化模板生态（速度不可用）
   - Motion Canvas：动画师友好的时间线/编辑器（无 headless CLI、GPLv3 exporter）
   - Helios：CDP 虚拟时间解决确定性（beta）
   - libplacebo：极限缩放/色调映射（macOS 不可用）
   - 纯 Metal：绝对性能上限（文本/颜色管理自担）

---

## 8. 附：ffmpeg 侧的关键锚点（对照用）

- zoompan 抖动根因是**整数像素取整**，官方 bug tracker 确认（trac #4298，https://trac.ffmpeg.org/ticket/4298 ）；社区修法是预放大 supersample（SuperUser 1112617，https://superuser.com/questions/1112617/ ），且有比例变形坑（SO 63896415，https://stackoverflow.com/questions/63896415/ ）。→ 想靠 ffmpeg 把 12fps 升 24fps + supersample 抗抖，CPU 时间会显著增加，**这会进一步拉开 GPU 合成器的相对优势**。[已验证+推断]
- VideoToolbox vs libx264 画质：社区共识 VT 略逊（Apple 论坛 678210）；YouTube 服务端重编码背景下差距可接受。[社区经验]
- 注意：任何新引擎最终都调同一个 VideoToolbox 编码块（Chrome WebCodecs、AVAssetWriter、ffmpeg 三者同源），**编码画质不是选型变量**；差异全在「帧怎么被合成出来」。[已验证-机制]

---

## 9. 我心目中的最终方案（论证版）

**分两步走**：
1. **第一步（1-2 天工作量，立刻止血）**：保持 ffmpeg，实现「(图, 时长桶, 参数) → 段 MP4（closed GOP, `g/2` 间隔 IDR）」缓存 + concat demuxer `-c copy` 组装 + 雪层独立为可循环段或终混段。改一张图只重渲一个 25s 段（~15-30s），单集组装 <10s。这一步与引擎选型无关，且无论如何都要做。[推断]
2. **第二步（画质跃迁 PoC，1-2 周）**：双轨 PoC 后择一：
   - **B（WebCodecs）优先**：Node + `@napi-rs/webcodecs`（或 headless Chrome + WebCodecs）+ Canvas2D 合成 + mediabunny 混流（视频+音频一起出，最后 ffmpeg 秒级补 mov_text 字幕）。理由：留在 TS monorepo、段缓存天然、未来 Web 端复用全部渲染代码；Screen Studio 已验证架构可行性。
   - **A（AVFoundation/Core Image）备选**：若 B 的 Node 侧库成熟度踩雷（93 stars 风险），Swift CLI + CIContext(Metal) + AVAssetWriter 是画质与速度的稳妥兜底；雪用自写确定性粒子或预渲染循环层。
   - 无论 A/B：24fps + subpixel Ken Burns + RGB 空间 screen 混合，预估 2-4 分钟/集全量、段级秒级。[推断]

**风险与不确定项**：
- [推断] 所有速度预估均无本机实测，PoC 需先跑 60s 样段基准（合成 fps + 编码 fps 分开测）。
- @napi-rs/webcodecs（93 stars）与 Helios（beta/ELv2）均年轻，选型前需验证其在 M4 上的 VideoToolbox 硬编可用性与内存曲线。[已验证-风险存在]
- CAEmitterCell 离线渲染不可依赖（若走 AVAssetExportSession 路线）。[社区经验]
- AVFoundation 无 SRT→mov_text 作者化 API，字幕环节永久保留 ffmpeg（成本可忽略）。[推断]
- WebCodecs AudioEncoder 走 AAC 的规格细节（profile/采样率）需在 PoC 中验证 YouTube 接受度。[推断]

---

## 附：本次调研主要来源清单（除文中已注）

- Remotion 性能文档：https://www.remotion.dev/docs/performance （访问 2026-08-30）
- Remotion 许可定价：https://www.remotion.dev/docs/license/pricing （访问 2026-08-30）
- Motion Canvas 渲染文档：https://motioncanvas.io/docs/rendering （访问 2026-08-30）
- Screen Studio 导出管线：https://pietrasiak.com/fast-video-rendering-and-encoding-using-web-apis （访问 2026-08-30）
- @napi-rs/webcodecs：https://github.com/Brooooooklyn/webcodecs-node （访问 2026-08-30）
- mediabunny：https://mediabunny.dev/ 、https://github.com/Vanilagy/mediabunny （2025 发布，访问 2026-08-30）
- Helios：https://github.com/BintzGavin/helios 、https://www.heliosrender.com/ （访问 2026-08-30）
- libplacebo on macOS：Reddit r/ffmpeg 1n3fzml、ffmpeg-user 2025-05/059237、mpv #17258、MoltenVK #2618（访问 2026-08-30）
- VideoToolbox 速度：ffmpeg-cookbook.com、codetv.dev、r/handbrake 1c3uf8d（2024-04）（访问 2026-08-30）
- zoompan 抖动：trac #4298、SuperUser 1112617、SO 63896415（访问 2026-08-30）
- Core Animation 离线渲染坑：SO 56150363 / 52427597 / 43096533 / 53468082、OpenRadar 17673、NSHipster（访问 2026-08-30）
