/**
 * 台本标注：把章节正文切成合成友好的片段（旁白/对白/信件），
 * 附带 edge-tts 可直接消费的 rate/pitch/voice 参数。
 *
 * 规则版零成本零延迟；说话人→音色映射通过 config.voiceBySpeaker 覆盖。
 */

export type SegmentKind = 'narration' | 'dialogue' | 'letter';

export interface Segment {
  id: string;          // c{pos}-s{n}
  kind: SegmentKind;
  speaker?: string;    // 对白归属人（识别失败为 undefined）
  text: string;
  voice: string;       // edge-tts voice
  rate: string;        // e.g. "-4%"
  pitch: string;       // e.g. "+0Hz"
  gapAfterMs: number;  // 片段后停顿，控制节奏
}

export interface VoiceConfig {
  narrator: string;
  defaultSpeaker: string;
  /** 角色名（含）→ 音色；按数组顺序首个命中生效 */
  voiceBySpeaker: { match: string; voice: string }[];
  /** rate/pitch 微调，per kind */
  narrationRate: string;
  dialogueRate: string;
  narrationPitch: string;
  dialoguePitch: string;
}

// ── 豆包侧音色班底（volcengine 引擎；tts/volcengine.ts 的 VOICE_MAP 同步维护，
//    2026-08-27 全班底 plan 路线试音放行）──
//   zh-CN-YunjianNeural（低沉旁白）  → 悬疑解说（用户选定）
//   zh-CN-YunxiNeural（默认对白/男主/警察）→ 高冷沉稳
//   zh-CN-YunyangNeural（中年男/领导）→ 霸气青叔
//   zh-CN-YunyeNeural（沉郁老者）    → 深夜播客
//   zh-CN-YunzeNeural（年轻男配）    → 云舟
//   zh-CN-XiaoyiNeural（女主）       → 知性女声
//   zh-CN-XiaomoNeural（泼辣/东北女）→ 直率英子
//   zh-CN-XiaohanNeural（温柔女性）  → 温柔淑女
//   zh-CN-YunxiaNeural（少年男）     → 少年梓辛
//   zh-CN-XiaoxiaoNeural（儿童）     → 天才童声
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  // 云健：低沉男声，悬疑旁白首选；云希：清爽男声，默认对白
  narrator: 'zh-CN-YunjianNeural',
  defaultSpeaker: 'zh-CN-YunxiNeural',
  voiceBySpeaker: [
    { match: '苏野', voice: 'zh-CN-XiaoyiNeural' },
    { match: '程砚秋', voice: 'zh-CN-YunyangNeural' },
    { match: '周宇轩', voice: 'zh-CN-YunyangNeural' },
  ],
  narrationRate: '-12%',
  dialogueRate: '-2%',
  narrationPitch: '-2Hz',
  dialoguePitch: '+0Hz',
};

const SPEAK_VERBS = ['说', '道', '问', '喊', '答', '低声', '吼', '骂', '念', '嘀咕', '开口', '回复', '接话', '喊道', '笑道', '叹'];

/** 中文引号（含原稿直引号）内的内容视为对白 */
const DIALOGUE_RE = /(["「][^"」\n]{1,300}["」])/g;

function detectSpeaker(before: string, cfg: VoiceConfig): string | undefined {
  // 取引号前的短上下文，找 "XX说/道/问" 模式
  const m = before.match(/([\u4e00-\u9fff]{2,4})(?:低声|冷冷|淡淡)?(?:地)?(?:说|道|问|喊|答|骂|念|嘀咕|吼)/);
  if (!m) return undefined;
  const name = m[1];
  if (['他的', '她的', '父亲', '父亲', '自己', '然后', '突然', '接着', '没有', '一句'].includes(name)) return undefined;
  return name;
}

function voiceFor(speaker: string | undefined, cfg: VoiceConfig): string {
  if (!speaker) return cfg.defaultSpeaker;
  for (const rule of cfg.voiceBySpeaker) {
    if (speaker.includes(rule.match) || rule.match.includes(speaker)) return rule.voice;
  }
  return cfg.defaultSpeaker;
}

export function annotateChapter(
  position: number,
  title: string,
  content: string,
  cfg: VoiceConfig = DEFAULT_VOICE_CONFIG
): Segment[] {
  const segs: Segment[] = [];
  let n = 0;
  const push = (kind: SegmentKind, text: string, speaker?: string, before = '') => {
    text = text.trim();
    if (!text) return;
    // 无可发音字符的段落（如独立的 "——" 场景分隔符）：不合成，把停顿加给前一段
    if (!/[\u4e00-\u9fff\w]/.test(text)) {
      if (segs.length) segs[segs.length - 1].gapAfterMs += 600;
      return;
    }
    n += 1;
    segs.push({
      id: `c${position}-s${n}`,
      kind,
      speaker,
      text,
      voice: kind === 'narration' ? cfg.narrator : voiceFor(kind === 'dialogue' ? detectSpeaker(before, cfg) : undefined, cfg),
      rate: kind === 'narration' ? cfg.narrationRate : cfg.dialogueRate,
      pitch: kind === 'narration' ? cfg.narrationPitch : cfg.dialoguePitch,
      gapAfterMs: kind === 'narration' ? 350 : 250,
    });
  };

  // 章节头归一化：markdown 标题行（# 第X章…）去掉 # 与分隔标点再朗读——
  // 井号绝不能进 TTS（2026-08-26 用户听检 EP02 实锤被念成"井号第四章"）。
  // 短且不以句读结尾才算标题行，避免误吞正文首句。
  const headingBody = (p: string): string | null => {
    const stripped = p.replace(/^#{1,6}\s*/, '');
    const m = stripped.match(/^(第[一二三四五六七八九十百0-9]{1,4}章)([\s，,、：:]?)(.*)$/);
    if (!m) return null;
    const rest = m[3].trim();
    if (rest.length > 24 || /[。！？…""」]/.test(rest)) return null;
    return rest ? `${m[1]} ${rest}` : m[1];
  };
  const numToCn = (v: number): string => {
    const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (v < 10) return d[v];
    if (v < 20) return '十' + (v % 10 ? d[v % 10] : '');
    return d[Math.floor(v / 10)] + '十' + (v % 10 ? d[v % 10] : '');
  };

  const paragraphs = content.split(/\n+/);
  // 正文本章没有标题行时（如第 2/15 章），用 DB 章节标题补朗读一个
  if (!paragraphs.some((para) => headingBody(para.trim()) !== null)) {
    const cleanTitle = title.replace(/^#{1,6}\s*/, '').trim();
    push('narration', `第${numToCn(position)}章 ${cleanTitle}`.trim());
    if (segs.length) segs[segs.length - 1].gapAfterMs = 800;
  }
  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;

    const heading = headingBody(p);
    if (heading) {
      push('narration', heading);
      if (segs.length) segs[segs.length - 1].gapAfterMs = 800;
      continue;
    }

    // 信件/遗书段（原稿用 **…** 标记）：整段低语速旁白
    if (p.startsWith('**') && p.endsWith('**')) {
      const t = p.slice(2, -2);
      n += 1;
      segs.push({
        id: `c${position}-s${n}`,
        kind: 'letter',
        speaker: undefined,
        text: t,
        voice: cfg.narrator,
        rate: '-12%',
        pitch: '-4Hz',
        gapAfterMs: 500,
      });
      continue;
    }

    let last = 0;
    for (const m of p.matchAll(DIALOGUE_RE)) {
      const before = p.slice(last, m.index);
      push('narration', before);
      push('dialogue', m[0].slice(1, -1), undefined, before);
      last = (m.index ?? 0) + m[0].length;
    }
    const tail = p.slice(last);
    if (tail.trim()) push('narration', tail);
    // 段落间停顿加长
    if (segs.length) segs[segs.length - 1].gapAfterMs += 400;
  }
  return segs;
}
