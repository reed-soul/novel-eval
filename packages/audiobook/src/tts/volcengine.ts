/**
 * 火山引擎豆包 Seed-TTS-2.0 适配器（Agent Plan 路线，2026-08-26 实测打通）。
 * 端点：openspeech.bytedance.com/api/v3/plan/tts/unidirectional
 *  - 鉴权：X-Api-Key（env ARK_API_KEY）+ X-Api-Resource-Id: seed-tts-2.0
 *  - ⚠️ 音色参数名是 req_params.speaker（不是 voice_type，写错报 55000000）
 *  - operation:"query" 提交合成；响应是 chunked JSON 行流，逐行解析：
 *      {"code":0,"message":"","data":"<base64>"}×N   音频片段，base64 拼接解码
 *      {"code":0,"data":null,"sentence":{…}}          句级元数据（words 为空，无词级时间戳）
 *      {"code":20000000,"message":"OK","data":null}   结束标记
 *    → 无词级时间戳，不产 srtFile（字幕由 episode 级整轨兜底）。
 * 环境变量：ARK_API_KEY（仅从 env 读，绝不落盘）
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Segment } from '../annotate.ts';
import type { SynthResult, TtsEngine } from './index.ts';
import { ffprobeDurationMs } from '../ffmpeg.ts';

// SSRF 防护：端点为字面量常量；请求前断言协议+域名白名单；禁跟随重定向
const ENDPOINT = 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional';
const ALLOWED_HOST = 'openspeech.bytedance.com';
const RESOURCE_ID = 'seed-tts-2.0';

function assertSafeEndpoint(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('仅允许 https');
  if (u.hostname !== ALLOWED_HOST) throw new Error('TTS 域名不在白名单');
}

/** 音色不可用（plan 路线 resource mismatch），可降级重试 */
class VolcVoiceMismatchError extends Error {
  constructor(readonly apiCode: number, message: string) {
    super(message);
    this.name = 'VolcVoiceMismatchError';
  }
}

// —— 音色映射（与 annotate.ts DEFAULT_VOICE_CONFIG 的 edge 音色对应）——
// 2026-08-27 全班底逐一经 plan 路线试音放行（此前 55000000 封锁已放宽）；
// 官方 2.0 全表 volcengine.com/docs/6561/1257544
const NARRATOR_SPEAKER = 'zh_male_xuanyijieshuo_uranus_bigtts'; // 悬疑解说：旁白（用户选定）
const VOICE_MAP: Record<string, string> = {
  'zh-CN-YunjianNeural': NARRATOR_SPEAKER,                        // 低沉旁白 → 悬疑解说
  'zh-CN-YunxiNeural': 'zh_male_gaolengchenwen_uranus_bigtts',    // 默认对白/男主/警察 → 高冷沉稳
  'zh-CN-YunyangNeural': 'zh_male_baqiqingshu_uranus_bigtts',     // 中年男/领导/长辈 → 霸气青叔
  'zh-CN-YunyeNeural': 'zh_male_shenyeboke_uranus_bigtts',        // 沉郁老者 → 深夜播客
  'zh-CN-YunzeNeural': 'zh_male_m191_uranus_bigtts',              // 年轻男配 → 云舟
  'zh-CN-XiaoyiNeural': 'zh_female_zhixingnv_uranus_bigtts',      // 女主 → 知性女声
  'zh-CN-XiaomoNeural': 'zh_female_zhishuaiyingzi_uranus_bigtts', // 泼辣/东北女性 → 直率英子
  'zh-CN-XiaohanNeural': 'zh_female_wenroushunv_uranus_bigtts',   // 温柔女性 → 温柔淑女
  'zh-CN-YunxiaNeural': 'zh_male_shaonianzixin_uranus_bigtts',    // 少年男 → 少年梓辛
  'zh-CN-XiaoxiaoNeural': 'zh_male_tiancaitongsheng_uranus_bigtts', // 儿童 → 天才童声
};

/** Segment.rate（"-12%" 格式）→ speech_rate 数值，接口范围 [-50, 100] */
function speechRate(rate: string): number {
  const m = rate.match(/^([+-]?\d+(?:\.\d+)?)%$/);
  const v = m ? Number(m[1]) : 0;
  return Math.max(-50, Math.min(100, Math.round(v)));
}

/** 情绪启发式：对白按标点+关键词；信件低沉；旁白保持悬疑解说的自然腔不加情绪 */
function emotionFor(seg: Segment): { emotion: string; emotion_scale: number } | undefined {
  const t = seg.text;
  if (seg.kind === 'letter') return { emotion: 'sad', emotion_scale: 3 };
  if (seg.kind !== 'dialogue') return undefined;
  if (/[！!]/.test(t) && /(滚|住手|闭嘴|疯|杀|畜生|混蛋|放肆|胡说|骗子)/.test(t)) {
    return { emotion: 'angry', emotion_scale: 4 };
  }
  if (/(别过来|不要|救命|我怕|别杀)/.test(t)) return { emotion: 'fearful', emotion_scale: 3 };
  if (/[！!]/.test(t) && /(哈哈|太好了|好耶|成了|好极了)/.test(t)) return { emotion: 'happy', emotion_scale: 3 };
  if (/[？?]/.test(t) && /(什么|怎么会|怎么可能|你是谁|居然|竟然|难道)/.test(t)) {
    return { emotion: 'surprised', emotion_scale: 3 };
  }
  return undefined;
}

interface PlanLine {
  code?: number;
  message?: string;
  data?: string | null;
}

/** 单段合成：提交 plan query，逐行读 chunked JSON 流，拼接 base64 音频 */
async function callPlanTts(
  text: string,
  speaker: string,
  rate: string,
  emotion: { emotion: string; emotion_scale: number } | undefined,
  apiKey: string,
): Promise<Buffer> {
  assertSafeEndpoint(ENDPOINT);
  const audioParams: Record<string, unknown> = {
    format: 'mp3',
    sample_rate: 24000,
    speech_rate: speechRate(rate),
    ...(emotion ? { emotion: emotion.emotion, emotion_scale: emotion.emotion_scale } : {}),
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    redirect: 'error', // 不跟随重定向，杜绝被引导至内网
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': RESOURCE_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user: { uid: 'novel-eval' },
      operation: 'query',
      req_params: { text, speaker, audio_params: audioParams },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`volcengine ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }

  const chunks: Buffer[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    let msg: PlanLine;
    try {
      msg = JSON.parse(line) as PlanLine;
    } catch {
      throw new Error(`volcengine 响应行非 JSON：${line.slice(0, 120)}`);
    }
    const code = msg.code ?? -1;
    if (code === 20000000) return; // 结束标记（OK）
    if (code !== 0) {
      throw new VolcVoiceMismatchError(code, `volcengine ${code}: ${msg.message ?? 'unknown'}`);
    }
    if (typeof msg.data === 'string' && msg.data.length > 0) chunks.push(Buffer.from(msg.data, 'base64'));
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? ''; // 末段可能不完整，留到下一轮
    for (const l of lines) handleLine(l);
  }
  buf += decoder.decode();
  if (buf) handleLine(buf);

  const out = Buffer.concat(chunks);
  if (out.length === 0) throw new Error('volcengine 返回空音频');
  return out;
}

export const engine: TtsEngine = {
  name: 'volcengine',
  async synthesize(segments, outDir) {
    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) throw new Error('需要 ARK_API_KEY（火山 Agent Plan key，仅从环境变量读取）');
    await mkdir(outDir, { recursive: true });
    // 音色被 plan 路线拒绝（55000000）时降级到旁白音色并记牢，后续段落不再试错
    const demoted = new Set<string>();
    const out: SynthResult[] = [];
    for (const seg of segments) {
      let speaker = VOICE_MAP[seg.voice] ?? NARRATOR_SPEAKER;
      if (demoted.has(speaker)) speaker = NARRATOR_SPEAKER;
      let buf: Buffer;
      try {
        buf = await callPlanTts(seg.text, speaker, seg.rate, emotionFor(seg), apiKey);
      } catch (e) {
        if (e instanceof VolcVoiceMismatchError && e.apiCode === 55000000 && speaker !== NARRATOR_SPEAKER) {
          demoted.add(speaker);
          console.warn(`    ⚠ 音色 ${speaker} 在 plan 路线不可用，降级悬疑解说`);
          speaker = NARRATOR_SPEAKER;
          buf = await callPlanTts(seg.text, speaker, seg.rate, emotionFor(seg), apiKey);
        } else {
          throw e;
        }
      }
      const file = join(outDir, `${seg.id}.mp3`);
      await writeFile(file, buf);
      out.push({ segmentId: seg.id, file, durationMs: await ffprobeDurationMs(file) });
    }
    return out;
  },
};
