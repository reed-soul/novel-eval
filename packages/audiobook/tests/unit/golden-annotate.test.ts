/**
 * 画本 golden 回归：真实章节（森铁 ch01/ch03，人工抽验过归属）冻结期望输出。
 * 任何切分/归属/发音表规则的改动都会在此炸红——改规则必须重新人工抽验后
 * 重生成 golden（tsx tests/golden/gen.ts）。
 * 哨兵值同步冻结：归属率下跌、漏对话（spanCoverage<1）都会拦截。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateChapter, annotateSentinels, DEFAULT_VOICE_CONFIG, type VoiceConfig } from '../../src/annotate.ts';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../golden');
const GOLDEN_FILES = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'));

// 2026-08-30 人工抽验后冻结（ch01：11/11 归属核对正确；ch03：11/11）
const FROZEN_SENTINELS: Record<string, { segmentsTotal: number; dialogue: number; attributed: number; attributionRate: number; spanCoverage: number }> = {
  'sentie-ch01.json': { segmentsTotal: 143, dialogue: 37, attributed: 11, attributionRate: 0.297, spanCoverage: 1 },
  'sentie-ch03.json': { segmentsTotal: 150, dialogue: 46, attributed: 11, attributionRate: 0.239, spanCoverage: 1 },
};

for (const file of GOLDEN_FILES) {
  test(`golden：${file} 切分/归属/文本全量一致`, () => {
    const g = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf-8')) as {
      position: number; title: string; content: string;
      cfg: Pick<VoiceConfig, 'cast' | 'voiceBySpeaker'>;
      expected: { kind: string; speaker?: string; text: string }[];
    };
    const cfg: VoiceConfig = {
      ...DEFAULT_VOICE_CONFIG,
      cast: g.cfg.cast,
      voiceBySpeaker: g.cfg.voiceBySpeaker,
    };
    const segs = annotateChapter(g.position, g.title, g.content, cfg);
    const actual = segs.map((s) => ({ kind: s.kind, ...(s.speaker ? { speaker: s.speaker } : {}), text: s.text }));
    assert.deepEqual(actual, g.expected);
  });

  test(`哨兵：${file} 冻结指标不回退`, () => {
    const g = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf-8')) as {
      position: number; title: string; content: string;
      cfg: Pick<VoiceConfig, 'cast' | 'voiceBySpeaker'>;
    };
    const cfg: VoiceConfig = { ...DEFAULT_VOICE_CONFIG, cast: g.cfg.cast, voiceBySpeaker: g.cfg.voiceBySpeaker };
    const s = annotateSentinels(g.content, annotateChapter(g.position, g.title, g.content, cfg));
    const frozen = FROZEN_SENTINELS[file];
    if (!frozen) return; // 未冻结哨兵的新 golden 只跑全量一致测试
    assert.equal(s.segmentsTotal, frozen.segmentsTotal, '段总数变化（规则改动，请人工抽验后更新冻结值）');
    assert.equal(s.dialogue, frozen.dialogue, '对白段数变化');
    assert.equal(s.attributed, frozen.attributed, '归属数变化（下跌=回归；上涨=改进，更新冻结值并抽验）');
    assert.equal(s.attributionRate, frozen.attributionRate);
    assert.equal(s.spanCoverage, frozen.spanCoverage, '漏对话绊线：引号 span 未全部切成对白');
  });
}
