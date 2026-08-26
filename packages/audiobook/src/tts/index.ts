/**
 * TTS 适配器统一接口。合成器可插拔：
 *  - edge       免费基线（微软神经音，uvx edge-tts，零 key）
 *  - minimax    生产级（speech-02，情感最好，需 MINIMAX_API_KEY）
 *  - volcengine 火山豆包 Seed-TTS-2.0（悬疑解说音色+情绪，需 ARK_API_KEY）
 *  - local      本地 CosyVoice/GPT-SoVITS HTTP sidecar（见 README）
 */
import type { Segment } from '../annotate.ts';

export interface SynthResult {
  segmentId: string;
  file: string;
  durationMs: number;
  srtFile?: string;   // 词级时间戳字幕（引擎支持时）
}

export interface TtsEngine {
  readonly name: string;
  /** 逐片段合成并落盘，返回有序结果 */
  synthesize(segments: Segment[], outDir: string): Promise<SynthResult[]>;
}

export async function createEngine(kind: string): Promise<TtsEngine> {
  switch (kind) {
    case 'edge':
      return (await import('./edge.ts')).engine;
    case 'minimax':
      return (await import('./minimax.ts')).engine;
    case 'volcengine':
      return (await import('./volcengine.ts')).engine;
    default:
      throw new Error(`未知 TTS 引擎：${kind}（可选 edge | minimax | volcengine）`);
  }
}
