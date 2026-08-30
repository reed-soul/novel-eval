/**
 * YouTube 上传物料生成：标题/描述/章节时间戳/标签/播放列表，
 * 输出 JSON + 人工上传清单（含 AI 披露与合规检查项）。
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ChapterMark {
  startMs: number;
  label: string;
}

export interface ChapterUploadPlan {
  position: number;
  title: string;
  episodeLabel?: string;  // 分集模式下的集标签（如 EP02｜第3-4章）
  audioFile: string;
  videoFile: string;
  durationMs: number;
  srtFile?: string;
  chapters?: ChapterMark[];  // 章节时间戳（首条必须 0:00，YouTube 章节规则）
}

export interface ChannelBrand {
  channel: string;          // e.g. 悬疑借阅室
  introLine: string;        // 固定片头语模板，{book} 占位
  bookTagline: string;      // 本书一句话钩子
  disclosure: string;       // AI 配音披露
  extraTags: string[];      // 频道级标签
}

export const DEFAULT_BRAND: ChannelBrand = {
  channel: '悬疑借阅室',
  introLine: '欢迎光临悬疑借阅室。今晚借出的这本，叫《{book}》。借阅时间，到天亮为止。',
  bookTagline: '',
  disclosure: '本节目配音由 AI 语音合成生成，故事内容为原创虚构作品。',
  extraTags: ['悬疑', '有声书', '悬疑小说', '有声小说', '中文有声书', '犯罪悬疑'],
};

export function buildUploadPlan(
  bookTitle: string,
  chapters: ChapterUploadPlan[],
  brand: ChannelBrand = DEFAULT_BRAND
) {
  return chapters.map((c) => {
    const displayTitle = c.title.replace(/^第[一二三四五六七八九十百\d]+章\s*/, '');
    return {
      file: c.videoFile,
      srt: c.srtFile,
      playlist: `${brand.channel}｜${bookTitle}`,
      title: c.episodeLabel
        ? `【有声书】${bookTitle} ${c.episodeLabel}`
        : `【有声书】${bookTitle} 第${c.position}章 ${displayTitle}`,
      description: [
        brand.introLine.replace('{book}', bookTitle),
        '',
        `《${bookTitle}》第 ${c.position} 章：${displayTitle}`,
        brand.bookTagline,
        '',
        `⏱ 全长 ${fmtDur(c.durationMs)}`,
        `📚 播放列表：${brand.channel}｜${bookTitle}`,
        ...chapterBlock(c.chapters),
        '',
        `— ${brand.channel} —`,
        '订阅即视为办理借阅证。睡不着，不算我们的责任。',
        '',
        brand.disclosure,
        '',
        '#悬疑 #有声书 #悬疑小说',
      ].join('\n'),
      tags: [...brand.extraTags, bookTitle, `第${c.position}章`],
      categoryId: '24', // Entertainment；纯朗读可考虑 27 Education 或留空
      // YouTube 完全忽略 MP4 内封字幕轨（mov_text 仅本地播放器可用）：
      // 必须在 Studio「字幕」页或 captions.insert API 单独上传 SRT，语言码 zh-Hans（裸 zh 无效）
      captions: c.srtFile ? { file: c.srtFile, language: 'zh-Hans' } : undefined,
    };
  });
}

export async function writeUploadBundle(outDir: string, plan: ReturnType<typeof buildUploadPlan>): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const json = join(outDir, 'youtube-upload.json');
  await writeFile(json, JSON.stringify(plan, null, 2), 'utf-8');
  const md = join(outDir, 'UPLOAD.md');
  await writeFile(md, uploadChecklist(plan), 'utf-8');
  return json;
}

/** 章节时间戳块（YouTube 章节规则：首条必须 0:00、≥3 条才生效、每章 ≥10s） */
function chapterBlock(marks?: ChapterMark[]): string[] {
  if (!marks || marks.length < 3) return [];
  const lines = ['', '📖 章节导航：'];
  for (const m of marks) lines.push(`${fmtTs(m.startMs)} ${m.label}`);
  return lines;
}

/** 章节时间戳格式：mm:ss 或 h:mm:ss（首条由调用方保证 0:00） */
function fmtTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function uploadChecklist(plan: ReturnType<typeof buildUploadPlan>): string {
  return `# 上传清单（${plan.length} 集）

> 物料在 youtube-upload.json；逐集核对后上传。

## 每集必查
1. 上传时勾选 **"Altered content / 含 AI 生成内容"** 披露（合成语音必勾）
2. 加入播放列表（每本书一个列表）
3. 描述首行已含频道片头语（勿删）
4. 结尾画面/信息卡指向下一集
5. **字幕**：YouTube 会忽略 MP4 内封字幕轨——成片上传后，在 Studio「字幕」页
   上传 SRT（语言选"中文（简体）"），或走 captions.insert API（language=zh-Hans）。
   各集 SRT 见 youtube-upload.json 的 captions.file 字段

## 发布节奏建议
- 每本书首批连发 3 集测完播率，之后日更或隔日更
- 第 1 集标题可加"全本连载中"后缀

## 集列表
${plan.map((p, i) => `${i + 1}. ${p.title}\n   文件：${p.file}\n   字幕：${p.captions?.file ?? '（无）'}`).join('\n')}
`;
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}
