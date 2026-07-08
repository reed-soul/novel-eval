# Node.js / JavaScript 文档解析库调研

> 调研时间：2026-07-08
> 目标场景：小说/文档格式解析，支持中文

---

## 一、总览对比表

| 库名 | 格式 | npm 周下载量 | GitHub ⭐ | 最后更新 | 中文支持 | 章节提取 | 推荐度 | 备注 |
|------|------|-------------|-----------|----------|---------|---------|--------|------|
| `mammoth` | docx | **517 万** | ⭐6,254 | 2026-03 | ✅ 良好 | ❌ 无原生支持 | ✅ **推荐** | docx→HTML/Markdown，稳定成熟 |
| `pdf-parse` | pdf | **548 万** | ⭐205 | 2025-10 | ✅ 良好 | ❌ 按页分割 | ✅ **推荐** | 纯 JS，无原生依赖，基于 pdf.js |
| `epub` | epub | 6,691 | ⭐361 | 2026-02 | ✅ UTF-8 | ✅ 有 chapter API | ✅ **推荐** | 轻量 Node.js epub 解析器 |
| `epub2md` | epub | 306 | ⭐310 | 2026-04 | ✅ 好 | ✅ 按章节转 Markdown | ✅ **推荐** | epub→Markdown，含章节结构 |
| `iconv-lite` | 编码转换 | **2.5 亿** | ⭐3,176 | 2026-07 | ✅ GBK/GB2312/GB18030 | N/A | ✅ **推荐** | txt 编码检测必选搭配 |
| `chardet` (node-chardet) | 编码检测 | **4,934 万** | ⭐310 | 2026-06 | ✅ GBK/GB2312 | N/A | ✅ **推荐** | 自动检测字符编码 |
| `unpdf` | pdf | **143 万** | ⭐1,175 | 2026-04 | ✅ | ❌ 按页提取 | ⚠️ **可用** | unjs 出品，Cloudflare 兼容，边缘友好 |
| `epub2` | epub | 15.9 万 | ⭐26 | 2026-07 | ✅ | ✅ chapter/manifest | ⚠️ **可用** | epub 增强版，含更多元数据/图片提取 |
| `pdf2json` | pdf | 48 万 | ⭐2,205 | 2026-04 | ⚠️ 一般 | ❌ 结构化输出 | ⚠️ **可用** | PDF→JSON/文本，可提取表格 |
| `jschardet` | 编码检测 | 124 万 | ⭐740 | 2024-09 | ✅ 中文编码 | N/A | ⚠️ **可用** | Python chardet 移植版，中文检测准确 |
| `iconv-jschardet` | 编码检测+转换 | 945 | ⭐26 | 2026-03 | ✅ 中文 | N/A | ⚠️ **可用** | iconv-lite + jschardet 一体化 |
| `any-text` | 多格式 | 4,002 | ⭐65 | 2021-03 | ⚠️ 未知 | ❌ | ⚠️ **可用** | 一站式提取（pdf/docx/epub/txt），已 3 年未更新 |
| `pdfreader` | pdf | 7.7 万 | — | 2025-11 | ⚠️ | ❌ | ⚠️ **可用** | 支持表格解析，面向数据场景 |
| `novel-epub` | epub (制作) | 低 | ⭐16 | 2023-09 | ✅ 中文简繁 | ✅（制作方向） | ❌ 不推荐 | 制作 epub，非解析 |
| `epub-iconv` | epub 简繁转换 | 低 | — | 2023-09 | ✅ 简繁互换 | N/A | ❌ 不推荐 | 辅助工具，非解析器 |

---

## 二、按格式详细分析

### 1. EPUB 解析

#### ✅ `epub` — 首选
- **npm**: [epub](https://www.npmjs.com/package/epub) v2.1.1
- **GitHub**: <https://github.com/nicbarker/epub> 之前为 julien-c/epub，后归 nicbarker 维护，⭐361
- **功能**：解析 EPUB 元数据、封面、章节文本、图片
- **用法**：`new EPUB(path)` → `epub.on('end', ...)` 获取元数据和章节
- **章节提取**：有 `epub.flow` 章节列表，通过 `epub.getChapter(id)` 获取正文 HTML
- **中文支持**：✅ EPUB 内容为 UTF-8/XHTML，解析无编码问题
- **缺点**：输出为 HTML，需自行剥离标签获取纯文本；Stream-based API 偏老式

#### ✅ `epub2md` — epub 转 Markdown（含章节）
- **npm**: [epub2md](https://www.npmjs.com/package/epub2md) v1.6.3
- **GitHub**: <https://github.com/uxiew/epub2MD> ⭐310
- **功能**：EPUB → Markdown，保留章节结构，支持 CLI
- **章节提取**：✅ 按章节拆分输出，保留标题层级
- **优势**：直接输出结构化 Markdown，减少后处理工作
- **中文支持**：✅ UTF-8 原生支持

#### ⚠️ `epub2` — epub 增强版
- **npm**: [epub2](https://www.npmjs.com/package/epub2) v3.0.2
- **GitHub**: <https://github.com/bluelovers/ws-epub> (monorepo)
- **功能**：增强版 EPUB 解析，支持 manifest、metadata、raw 文件提取
- **章节提取**：✅ 有 chapter/manifest API
- **下载量高**（16 万/周）但文档稀疏，API 稳定性存疑

---

### 2. PDF 解析（小说场景）

#### ✅ `pdf-parse` — 首选
- **npm**: [pdf-parse](https://www.npmjs.com/package/pdf-parse) v2.4.5
- **GitHub**: <https://github.com/mehmet-kozan/pdf-parse> ⭐205
- **功能**：纯 JS 文本提取，基于 pdf.js，无需编译
- **中文支持**：✅ 基于 pdf.js，CJK 字体嵌入即可提取
- **输出**：返回 `text`（全文）、`numpages`、`info`（元数据）
- **章节提取**：❌ 按页分割，无原生章节识别
- **缺点**：对扫描版 PDF 无能为力；需要额外实现章节分隔逻辑
- **安装**：`npm i pdf-parse`

#### ⚠️ `unpdf` — 边缘运行时友好
- **npm**: [unpdf](https://www.npmjs.com/package/unpdf) v1.6.2
- **GitHub**: <https://github.com/unjs/unpdf> ⭐1,175
- **功能**：跨运行时 PDF 文本提取（Node/Deno/Cloudflare Workers）
- **中文支持**：✅ 基于 pdf.js
- **场景**：如需部署到边缘函数（如 Cloudflare），选此替代 pdf-parse

#### ⚠️ `pdf2json` — 结构化提取
- **npm**: [pdf2json](https://www.npmjs.com/package/pdf2json) v4.0.3
- **GitHub**: <https://github.com/modesty/pdf2json> ⭐2,205
- **功能**：PDF → JSON（含文本位置、字体、表格）
- **中文支持**：⚠️ 可提取但需测试具体 PDF 字体嵌入情况
- **适用**：需要保留文字位置信息或解析表格时使用

---

### 3. TXT / 纯文本（编码检测）

中文 TXT 文件的核心问题是 **编码检测**。常见编码：GBK、GB2312、GB18030、Big5、UTF-8、UTF-16。

#### ✅ `chardet` + `iconv-lite` — 标准组合
- **`chardet`** ([node-chardet](https://github.com/runk/node-chardet)) ⭐310：自动检测字符编码
  - 支持中文编码：✅ GB2312、GBK、GB18030、Big5、UTF-8
  - 用法：`const detected = chardet.detect(buffer)`
- **`iconv-lite`** ([pillarjs/iconv-lite](https://github.com/pillarjs/iconv-lite)) ⭐3,176：纯 JS 编码转换
  - 支持中文编码：✅ GBK、GB18030、Big5、EUC-CN 等
  - 用法：`iconv.decode(buffer, detectedEncoding)`

**推荐工作流**：
```javascript
import chardet from 'chardet';
import iconv from 'iconv-lite';
import fs from 'fs';

const buffer = fs.readFileSync('novel.txt');
const encoding = chardet.detect(buffer) || 'utf-8';
const text = iconv.decode(buffer, encoding);
```

#### ⚠️ `jschardet` — 备选
- **GitHub**: <https://github.com/aadsm/jschardet> ⭐740
- Python chardet 的 JS 移植，中文检测准确率可能更高
- 2024 年后未更新，但对中文场景仍可靠

#### ⚠️ `iconv-jschardet` — 一体化
- **npm**: [iconv-jschardet](https://www.npmjs.com/package/iconv-jschardet) v2.0.36
- 同时打包了 iconv-lite 和 jschardet，API 一体化
- 适合不想分别引入两个包的场景

---

### 4. DOCX 解析

#### ✅ `mammoth` — 首选（也是唯一成熟选择）
- **npm**: [mammoth](https://www.npmjs.com/package/mammoth) v1.12.0
- **GitHub**: <https://github.com/mwilliamson/mammoth.js> ⭐6,254
- **功能**：DOCX → HTML 或 Markdown
- **中文支持**：✅ 纯 XML 解析，无编码问题
- **章节提取**：❌ 不识别章节结构（基于标题级别可自行实现）
- **用法**：
```javascript
import mammoth from 'mammoth';
const result = await mammoth.extractRawText({path: 'novel.docx'});
// or markdown
const md = await mammoth.convertToMarkdown({path: 'novel.docx'});
```
- **优势**：周下载 517 万，极其成熟稳定；BSD-2-Clause 开源许可

---

### 5. 综合文档处理库

#### ⚠️ `any-text` — 一站式提取
- **npm**: [any-text](https://www.npmjs.com/package/any-text) v1.2.0
- **GitHub**: <https://github.com/abhinaba-ghosh/any-text> ⭐65
- **支持格式**：PDF、DOCX、TXT、EPUB、HTML、RTF 等
- **中文支持**：⚠️ 未明确说明
- **章节提取**：❌
- **问题**：最后更新 2021-03，已 3+ 年未维护，**不推荐用于新项目**
- **底层依赖**：内部调用 pdf-parse、mammoth 等库

> **结论**：综合文档库在 Node.js 生态中尚无成熟的"一站式"方案。推荐按格式选择专门的库，自行封装统一接口。

#### Apache Tika Node.js 封装
- npm 上有 `tika-server`、`node-tika` 等包
- **问题**：都需要 Java 运行时 + Tika 服务端，部署复杂
- **不推荐**：对于纯文本提取场景，过于重量级

---

### 6. 网文/小说专用解析库

#### 调研结论：**没有找到成熟的中文小说解析 npm 库**

搜索结果分析：
- `novels-raw-scraper`：中文小说网站爬虫（非本地文件解析），已停更
- `pixiv-novel-parser`：Pixiv 小说专用，与中文网文无关
- `@node-novel/*` 系列：台湾开发者 bluelovers 的系列工具，偏向 epub 制作，非解析
- `epub-iconv`：epub 简繁转换工具，非解析器
- GitHub 搜索 "chinese novel chapter parser" / "web novel parser"：无成熟 Node.js 项目

> **中文小说的章节提取需要自建逻辑**。常见章节标题模式：
> - `第X章 标题` / `第X回 标题`
> - `Chapter X: Title`
> - `卷X 标题`
> - 正则表达式即可覆盖绝大多数情况

---

## 三、推荐技术栈

```
┌─────────────────────────────────────────────────────────────┐
│                    统一解析接口层                              │
├─────────┬──────────┬──────────┬──────────┬──────────────────┤
│  EPUB   │   PDF    │  DOCX    │   TXT    │   章节分割       │
│ epub    │pdf-parse │ mammoth  │ chardet  │  正则匹配       │
│ epub2md │          │          │iconv-lite│  "第X章/回"     │
└─────────┴──────────┴──────────┴──────────┴──────────────────┘
```

**各格式推荐**：
| 格式 | 首选库 | 备选 |
|------|--------|------|
| EPUB | `epub`（轻量）+ HTML→Text 后处理 | `epub2md`（直接转 Markdown） |
| PDF | `pdf-parse` | `unpdf`（边缘部署） |
| DOCX | `mammoth` | 无 |
| TXT | `chardet` + `iconv-lite` | `iconv-jschardet`（一体化） |
| 章节分割 | 自建正则引擎 | — |

---

## 四、关键参考链接

- [epub (npm)](https://www.npmjs.com/package/epub) | [GitHub](https://github.com/nicbarker/epub)
- [epub2md (npm)](https://www.npmjs.com/package/epub2md) | [GitHub](https://github.com/uxiew/epub2MD)
- [pdf-parse (npm)](https://www.npmjs.com/package/pdf-parse) | [GitHub](https://github.com/mehmet-kozan/pdf-parse)
- [unpdf (npm)](https://www.npmjs.com/package/unpdf) | [GitHub](https://github.com/unjs/unpdf)
- [mammoth (npm)](https://www.npmjs.com/package/mammoth) | [GitHub](https://github.com/mwilliamson/mammoth.js)
- [chardet (npm)](https://www.npmjs.com/package/chardet) | [GitHub](https://github.com/runk/node-chardet)
- [iconv-lite (npm)](https://www.npmjs.com/package/iconv-lite) | [GitHub](https://github.com/pillarjs/iconv-lite)
- [jschardet (npm)](https://www.npmjs.com/package/jschardet) | [GitHub](https://github.com/aadsm/jschardet)
- [epub2 (npm)](https://www.npmjs.com/package/epub2) | [GitHub](https://github.com/bluelovers/ws-epub)
- [pdf2json (npm)](https://www.npmjs.com/package/pdf2json) | [GitHub](https://github.com/modesty/pdf2json)
- [any-text (npm)](https://www.npmjs.com/package/any-text) | [GitHub](https://github.com/abhinaba-ghosh/any-text)
