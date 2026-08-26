/**
 * MiniMax 适配器（生产级，情感表现当前 CN TTS 第一梯队）。
 * ⚠️ 未实测：按 t2a_v2 开放接口编写（GroupId 走 body；若 API 要求 query
 *    参数，请在保持字面量端点与 assertSafeEndpoint 校验的前提下调整）。
 *    首次使用先跑 `pnpm audiobook build --chars 300 --engine minimax` 验证。
 * 环境变量：MINIMAX_API_KEY、MINIMAX_GROUP_ID
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Segment } from '../annotate.ts';
import type { SynthResult, TtsEngine } from './index.ts';
import { ffprobeDurationMs } from '../ffmpeg.ts';

// SSRF 防护：端点为字面量常量；请求前断言协议+域名白名单；禁跟随重定向
const ENDPOINT = 'https://api.minimax.chat/v1/t2a_v2';
const ALLOWED_HOST = 'api.minimax.chat';

function assertSafeEndpoint(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('仅允许 https');
  if (u.hostname !== ALLOWED_HOST) throw new Error('TTS 域名不在白名单');
}

const MODEL = 'speech-02-hd';
// 与 edge 侧 DEFAULT_VOICE_CONFIG 对应的 MiniMax 音色（system 换成自训音色即得专属声）
const VOICE_MAP: Record<string, string> = {
  'zh-CN-YunjianNeural': 'patient_male_9n_turb',     // 低沉稳重旁白
  'zh-CN-YunxiNeural': 'cheerful_male_9n_turb',       // 默认对白
  'zh-CN-YunyangNeural': 'gentle_male_9n_turb',       // 中年男角
  'zh-CN-XiaoyiNeural': 'lovely_female_9n_turb',      // 女主
};

const RATE_MAP: Record<string, number> = { '-6%': 0.9, '-2%': 0.95, '-12%': 0.8 };

async function callApi(text: string, voice: string, rate: string, apiKey: string, groupId: string): Promise<Buffer> {
  assertSafeEndpoint(ENDPOINT);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    redirect: 'error', // 不跟随重定向，杜绝被引导至内网
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      group_id: groupId,
      model: MODEL,
      text,
      stream: false,
      voice_setting: { voice_id: voice, speed: RATE_MAP[rate] ?? 1, vol: 1.0, pitch: 0 },
      audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128 },
    }),
  });
  if (!res.ok) throw new Error(`minimax ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { data?: { audio?: string }; base_resp?: { status_msg?: string } };
  if (!data.data?.audio) throw new Error(`minimax 返回无音频: ${data.base_resp?.status_msg ?? 'unknown'}`);
  return Buffer.from(data.data.audio, 'hex'); // t2a_v2 非 stream 返回 hex 编码音频
}

export const engine: TtsEngine = {
  name: 'minimax',
  async synthesize(segments, outDir) {
    const apiKey = process.env.MINIMAX_API_KEY;
    const groupId = process.env.MINIMAX_GROUP_ID;
    if (!apiKey || !groupId) throw new Error('需要 MINIMAX_API_KEY 和 MINIMAX_GROUP_ID');
    await mkdir(outDir, { recursive: true });
    const out: SynthResult[] = [];
    for (const seg of segments) {
      const voice = VOICE_MAP[seg.voice] ?? 'patient_male_9n_turb';
      const buf = await callApi(seg.text, voice, seg.rate, apiKey, groupId);
      const file = join(outDir, `${seg.id}.mp3`);
      await writeFile(file, buf);
      out.push({ segmentId: seg.id, file, durationMs: await ffprobeDurationMs(file) });
    }
    return out;
  },
};
