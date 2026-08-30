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
  /** 角色名单（含别名，长名在前）：说话人归属校验用，防「转过身说」类假名 */
  cast?: string[];
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
  // 角色音色按书配置：data/audiobook/projects/<书名>.json 的 voiceBySpeaker
  // （书本数据不进代码——换书零改码）
  voiceBySpeaker: [],
  narrationRate: '-12%',
  dialogueRate: '-2%',
  narrationPitch: '-2Hz',
  dialoguePitch: '+0Hz',
};

const SPEAK_VERBS = ['说', '道', '问', '喊', '答', '低声', '吼', '骂', '念', '嘀咕', '开口', '回复', '接话', '喊道', '笑道', '叹'];

/** 发音表条目：字面短语 → 朗读替换（如 "110"→"幺幺零"、"柈子"→"绊子"） */
export interface PronEntry {
  match: string;
  read: string;
  note?: string;
}

/**
 * 发音表替换（行业 prep 的 pronunciation guide 对应物）。
 * 字面全词替换、长词优先（"98.11.20" 先于 "98"）；命中回传供日志统计。
 * 注意：替换同时作用于字幕文本——条目应写成「听众希望看到的读法」。
 */
export function applyPron(text: string, entries: PronEntry[]): { text: string; hits: { entry: PronEntry; count: number }[] } {
  const usable = entries
    .filter((e) => e.match && e.read && e.match !== e.read)
    .sort((a, b) => b.match.length - a.match.length);
  let out = text;
  const hits: { entry: PronEntry; count: number }[] = [];
  for (const e of usable) {
    const n = out.split(e.match).length - 1;
    if (n > 0) {
      out = out.split(e.match).join(e.read);
      hits.push({ entry: e, count: n });
    }
  }
  return { text: out, hits };
}

/** 中文引号（含原稿直引号）内的内容视为对白 */
const DIALOGUE_RE = /(["「][^"」\n]{1,300}["」])/g;

// 说话人归属：支持「XX说："…"」（前）与「"…"XX说/问」（后）两种体例；
// 名单校验把捕获名归一到 cast 规范名（老周头→名单项），无名单时退回停用词保守表
const SPEECH_VERB_RE = /([\u4e00-\u9fff]{2,4})(?:低声|冷冷|淡淡)?(?:地)?(?:说|道|问|喊|答|骂|念|嘀咕|吼|开口|回复|接话|喊道|笑道|叹)/;
const STOP_NAMES = ['他的', '她的', '父亲', '自己', '然后', '突然', '接着', '没有', '一句', '声音', '对方', '这个', '那个', '什么'];

function resolveSpeakers(
  quotes: { before: string; after: string; atParaStart: boolean }[],
  cast: string[] | undefined
): (string | undefined)[] {
  const validate = (raw: string): string | undefined => {
    if (cast && cast.length) {
      return cast.find((c) => c.includes(raw) || raw.includes(c));
    }
    return STOP_NAMES.some((s) => raw.includes(s)) ? undefined : raw;
  };
  const out = quotes.map((q) => {
    const m = SPEECH_VERB_RE.exec(q.before.slice(-24)) ?? SPEECH_VERB_RE.exec(q.after.slice(0, 24));
    if (m) {
      const v = validate(m[1]);
      if (v) return v;
    }
    // 段首引号 + 后文 20 字内出现名单角色（「"…"张三…动作」体例）
    if (q.atParaStart && cast) {
      const seg = q.after.slice(0, 20);
      const hit = cast.find((c) => seg.includes(c));
      if (hit) return hit;
    }
    return undefined;
  });
  // 段内唯一归属传播：单说话人被动作句隔开的续话（"…"老周头也不抬，"…"）
  const distinct = [...new Set(out.filter((x): x is string => !!x))];
  if (distinct.length === 1) return out.map((x) => x ?? distinct[0]);
  return out;
}

export function annotateChapter(
  position: number,
  title: string,
  content: string,
  cfg: VoiceConfig = DEFAULT_VOICE_CONFIG
): Segment[] {
  const segs: Segment[] = [];
  let n = 0;
  const push = (kind: SegmentKind, text: string, speaker?: string) => {
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
      voice: kind === 'narration' ? cfg.narrator : voiceFor(speaker, cfg),
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
    const matches = [...p.matchAll(DIALOGUE_RE)];
    const speakers = resolveSpeakers(
      matches.map((m, i) => ({
        before: p.slice(i === 0 ? 0 : (matches[i - 1].index ?? 0) + matches[i - 1][0].length, m.index),
        after: p.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 24),
        atParaStart: (m.index ?? 0) === 0,
      })),
      cfg.cast
    );
    const paraStartIdx = segs.length;
    matches.forEach((m, i) => {
      push('narration', p.slice(last, m.index));
      push('dialogue', m[0].slice(1, -1), speakers[i]);
      last = (m.index ?? 0) + m[0].length;
    });
    const tail = p.slice(last);
    if (tail.trim()) push('narration', tail);

    // 悬念收尾（省略号/破折号/问叹号结尾的旁白）多给一拍
    const paraSegs = segs.slice(paraStartIdx);
    const lastPara = paraSegs[paraSegs.length - 1];
    if (lastPara && lastPara.kind === 'narration' && /(…|--|——|[？！])$/.test(lastPara.text)) {
      lastPara.gapAfterMs += 160;
    }
    // 段落间停顿加长
    if (segs.length) segs[segs.length - 1].gapAfterMs += 400;
  }
  // 对白连发收紧（跨段也生效：中文小说的快速对垒常是"走。"\n"不走。"分行体）
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i].kind === 'dialogue' && segs[i + 1].kind === 'dialogue') {
      segs[i].gapAfterMs = 180;
    }
  }
  return segs;
}

/** 试产字数截断：优先在限额内最后一个句终标点（。！？…」"）后收口；无句读才硬切 */
export function truncateAtSentence(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const window = content.slice(0, limit);
  const end = Math.max(
    window.lastIndexOf('。'),
    window.lastIndexOf('！'),
    window.lastIndexOf('？'),
    window.lastIndexOf('…'),
    window.lastIndexOf('」'),
    window.lastIndexOf('"'),
  );
  return end >= limit * 0.5 ? window.slice(0, end + 1) : window;
}

/** 说话人 → 音色（导出供 LLM 归因后重映射音色） */
export function voiceFor(speaker: string | undefined, cfg: VoiceConfig): string {
  if (!speaker) return cfg.defaultSpeaker;
  for (const rule of cfg.voiceBySpeaker) {
    if (speaker.includes(rule.match) || rule.match.includes(speaker)) return rule.voice;
  }
  return cfg.defaultSpeaker;
}

// ── 画本哨兵：golden set 回归用的代理指标 ─────────────────────
export interface AnnotateSentinels {
  segmentsTotal: number;
  narration: number;
  dialogue: number;
  letter: number;
  /** 对白归属率（画本质量核心指标；体例决定规则上限，LLM 归因可继续提升） */
  attributed: number;
  attributionRate: number;
  /** 漏对话绊线：非信件段里的引号 span 数 vs 实际切出的对白段数（必须相等） */
  quoteSpans: number;
  spanCoverage: number;
}

const QUOTE_SPAN_RE = () => new RegExp(DIALOGUE_RE.source, 'g');

export function annotateSentinels(content: string, segments: Segment[]): AnnotateSentinels {
  const dialogue = segments.filter((s) => s.kind === 'dialogue').length;
  const attributed = segments.filter((s) => s.kind === 'dialogue' && s.speaker).length;
  let quoteSpans = 0;
  for (const raw of content.split(/\n+/)) {
    const p = raw.trim();
    if (p.startsWith('**') && p.endsWith('**')) continue; // 信件段整段低语，不切对白（by design）
    quoteSpans += [...p.matchAll(QUOTE_SPAN_RE())].length;
  }
  return {
    segmentsTotal: segments.length,
    narration: segments.filter((s) => s.kind === 'narration').length,
    letter: segments.filter((s) => s.kind === 'letter').length,
    dialogue,
    attributed,
    attributionRate: dialogue ? Number((attributed / dialogue).toFixed(3)) : 0,
    quoteSpans,
    spanCoverage: quoteSpans ? Number((dialogue / quoteSpans).toFixed(3)) : 1,
  };
}
