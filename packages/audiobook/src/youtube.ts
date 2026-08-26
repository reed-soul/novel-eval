/**
 * YouTube 上传物料生成：标题/描述/章节时间戳/标签/播放列表，
 * 输出 JSON + 人工上传清单（含 AI 披露与合规检查项）。
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ChapterUploadPlan {
  position: number;
  title: string;
  episodeLabel?: string;  // 分集模式下的集标签（如 EP02｜第3-4章）
  audioFile: string;
  videoFile: string;
  durationMs: number;
  srtFile?: string;
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

function uploadChecklist(plan: ReturnType<typeof buildUploadPlan>): string {
  return `# 上传清单（${plan.length} 集）

> 物料在 youtube-upload.json；逐集核对后上传。

## 每集必查
1. 上传时勾选 **"Altered content / 含 AI 生成内容"** 披露（合成语音必勾）
2. 加入播放列表（每本书一个列表）
3. 描述首行已含频道片头语（勿删）
4. 结尾画面/信息卡指向下一集

## 发布节奏建议
- 每本书首批连发 3 集测完播率，之后日更或隔日更
- 第 1 集标题可加"全本连载中"后缀

## 集列表
${plan.map((p, i) => `${i + 1}. ${p.title}\n   文件：${p.file}`).join('\n')}
`;
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}
