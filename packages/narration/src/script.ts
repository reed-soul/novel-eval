/**
 * S2 解说文案生成器：四阶段（图谱→map→序列规划→beat），内容哈希缓存。
 * 输出 NarrationScript（shared DTO），落 script.json + script.md。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createEngine, loadEngineConfig, callWithValidation,
  type SchemaSpec, type AIAgentAdapter, type EngineConfig,
  type NarrationScript, type NarrationAct, type NarrationSequence, type NarrationBeat,
  type CharacterRef, type BeatKind, type ShotKind,
} from '@novel-eval/shared';
import { clueGraphPrompt, mapPrompt, sequencePlanPrompt, beatsPrompt } from './prompts.ts';

const CHARS_PER_SEC = 3.8; // 中文口播语速（2026-09-16《物业管家》实测校准：3632 字 / 952s）

export interface ChapterInput { no: number; title: string; text: string }

export interface ScriptOptions {
  repoRoot: string;
  bookId: string;
  bookTitle: string;
  chapters: ChapterInput[];
  targetMinutes: number;
  outDir: string;               // dist/derivatives/<slug>/narration
}

interface ClueGraph {
  clues: Array<{ name: string; plantChapters: number[]; payoffChapter: number; desc: string }>;
  reversals: Array<{ layer: number; desc: string; payoffChapter: number; dependsOn: string[] }>;
  characters: Array<{ name: string; promptDesc: string; moralityLock: string }>;
  endingImage?: string;
}

interface ChapterMap {
  summary: string;
  facts: Array<{ subject: string; action: string; object: string }>;
  clueHits: string[];
  emotionWeight: number;
}

interface SequencePlan {
  acts: NarrationAct[];
  sequences: Array<{
    id: string; actId: string; title: string; puzzleLabel?: string;
    budgetChars: number; tension: string; sourceChapters: number[]; beatCountHint: number;
  }>;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** 内容哈希缓存（改章只重跑该章；digest 先例） */
class StageCache {
  private mem: Record<string, unknown>;
  constructor(private file: string) {
    try { this.mem = JSON.parse(readFileSync(file, 'utf-8')); } catch { this.mem = {}; }
  }
  get<T>(key: string): T | undefined {
    return (this.mem[key] !== undefined ? this.mem[key] : undefined) as T | undefined;
  }
  put(key: string, value: unknown): void {
    this.mem[key] = value;
    writeFileSync(this.file, JSON.stringify(this.mem, null, 2));
  }
}

const schemaOf = (spec: SchemaSpec) => spec;

export async function generateScript(opts: ScriptOptions): Promise<{ script: NarrationScript; usage: { llmCalls: number } }> {
  mkdirSync(opts.outDir, { recursive: true });
  const cache = new StageCache(join(opts.outDir, '.script-cache.json'));
  const engineCfg = loadEngineConfig(join(opts.repoRoot, 'packages/shared/config'));
  const engine: AIAgentAdapter = createEngine(engineCfg.engine);
  let llmCalls = 0;

  const run = async <T>(prompt: string, schema: SchemaSpec, tag: string): Promise<T> => {
    const res = await callWithValidation<T>(engine, prompt, {
      systemPrompt: (await import('./prompts.ts')).systemPrompt(),
      schema, maxAttempts: 3, disableThinking: true, maxTokens: 16000, timeoutMs: 300_000,
    });
    llmCalls++;
    if (!res.ok || res.data === null) throw new Error(`[${tag}] 生成失败（3 次重试后仍不合规）：${res.errors.join('; ')}`);
    return res.data;
  };

  // ── P0 全书物证-反转图谱 ──
  // 超长全书分两截喂给图谱：优先保证物证完整性（图谱是总纲，不是逐句精读）
  const fullText = opts.chapters
    .slice(0, 24) // 图谱输入截前 24 章（长书防上下文爆）
    .map((c) => `【第${c.no}章 ${c.title}】\n${c.text.length > 12000 ? c.text.slice(0, 12000) + '…（截断）' : c.text}`)
    .join('\n\n');
  const graphKey = `p0:${hash(opts.bookId + fullText.length + opts.chapters.length)}`;
  const graph = cache.get<ClueGraph>(graphKey) ??
    await run<ClueGraph>(
      clueGraphPrompt(opts.bookTitle, fullText),
      schemaOf({
        clues: { type: 'array', min: 4, max: 40, required: true, itemSpec: { type: 'object', fields: {
          name: { type: 'string', min: 2, max: 40, required: true },
          plantChapters: { type: 'array', required: true },
          payoffChapter: { type: 'number', required: true },
          desc: { type: 'string', min: 6, max: 120, required: true },
        } } },
        reversals: { type: 'array', min: 2, max: 8, required: true, itemSpec: { type: 'object', fields: {
          layer: { type: 'number', required: true }, desc: { type: 'string', min: 8, max: 200, required: true },
          payoffChapter: { type: 'number', required: true }, dependsOn: { type: 'array', required: true },
        } } },
        characters: { type: 'array', min: 2, max: 12, required: true, itemSpec: { type: 'object', fields: {
          name: { type: 'string', min: 1, max: 20, required: true },
          promptDesc: { type: 'string', min: 40, max: 600, required: true },
          moralityLock: { type: 'string', min: 10, max: 200, required: true },
        } } },
        endingImage: { type: 'string', min: 8, max: 200 },
      }),
      'P0-图谱',
    );
  cache.put(graphKey, graph);

  // ── P1 逐章 map（物证锁注入）──
  const graphJson = JSON.stringify({ clues: graph.clues, reversals: graph.reversals });
  const maps: Array<ChapterMap & { no: number }> = [];
  for (const ch of opts.chapters) {
    const key = `p1:${ch.no}:${hash(ch.text)}`;
    const hit = cache.get<ChapterMap>(key);
    if (hit) { maps.push({ ...hit, no: ch.no }); continue; }
    const m = await run<ChapterMap>(
      mapPrompt(ch.no, ch.text, graphJson),
      schemaOf({
        summary: { type: 'string', min: 100, max: 600, required: true },
        facts: { type: 'array', min: 2, max: 30, required: true, itemSpec: { type: 'object', fields: {
          subject: { type: 'string', min: 1, max: 30, required: true },
          action: { type: 'string', min: 2, max: 60, required: true },
          object: { type: 'string', min: 1, max: 30, required: true },
        } } },
        clueHits: { type: 'array', required: true },
        emotionWeight: { type: 'number', required: true },
      }),
      `P1-第${ch.no}章`,
    );
    cache.put(key, m);
    maps.push({ ...m, no: ch.no });
  }

  // ── P2 序列规划（张力预算）──
  const mapsJson = JSON.stringify(maps.map(({ no, summary, facts, emotionWeight }) => ({ no, summary, facts, emotionWeight })));
  const planKey = `p2:${hash(graphJson + mapsJson + opts.targetMinutes)}`;
  const plan = cache.get<SequencePlan>(planKey) ??
    await run<SequencePlan>(
      sequencePlanPrompt(opts.bookTitle, opts.targetMinutes, graphJson, mapsJson),
      schemaOf({
        acts: { type: 'array', min: 3, max: 3, required: true, itemSpec: { type: 'object', fields: {
          id: { type: 'string', required: true }, name: { type: 'string', min: 2, max: 12, required: true },
        } } },
        sequences: { type: 'array', min: 4, max: 9, required: true, itemSpec: { type: 'object', fields: {
          id: { type: 'string', required: true }, actId: { type: 'string', required: true },
          title: { type: 'string', min: 4, max: 24, required: true },
          puzzleLabel: { type: 'string', min: 4, max: 40 },
          budgetChars: { type: 'number', required: true },
          tension: { type: 'string', required: true },
          sourceChapters: { type: 'array', required: true },
          beatCountHint: { type: 'number', required: true },
        } } },
      }),
      'P2-序列',
    );
  cache.put(planKey, plan);

  // ── 角色（图谱 characters → CharacterRef）──
  const characters: CharacterRef[] = graph.characters.map((c) => ({
    id: `c-${hash(c.name).slice(0, 8)}`,
    name: c.name,
    status: 'draft',
    promptDesc: c.promptDesc,
    // moralityLock 不进 DTO：留给 S3 因果门用
  }));

  // ── P3 序列内 beat（逐序列独立生成）──
  const beatsBySeq: Record<string, NarrationBeat[]> = {};
  let beatSeq = 0, sentSeq = 0;
  const beatSchema: SchemaSpec = {
    beats: { type: 'array', min: 3, max: 20, required: true, itemSpec: { type: 'object', fields: {
      id: { type: 'string', required: true },
      kind: { type: 'string', required: true },
      sentences: { type: 'array', min: 1, max: 12, required: true, itemSpec: { type: 'object', fields: {
        id: { type: 'string', required: true },
        text: { type: 'string', min: 6, max: 80, required: true },
      } } },
      visual: { type: 'object', required: true, fields: {
        prompt: { type: 'string', min: 60, max: 900, required: true },
        characterIds: { type: 'array', required: true },
        shot: { type: 'string', required: true },
      } },
      sfxHint: { type: 'string' },
    } } },
  };
  for (let qi = 0; qi < plan.sequences.length; qi++) {
    const seq = plan.sequences[qi];
    const seqMaps = maps.filter((m) => seq.sourceChapters.includes(m.no));
    const seqKey = `p3:${seq.id}:${hash(JSON.stringify(seq) + JSON.stringify(seqMaps.map(m => m.summary)) + graphJson)}`;
    type RawBeats = { beats: Array<{ id: string; kind: string; sentences: Array<{ id: string; text: string; quote?: { voice: string; eq?: string } }>; visual: { prompt: string; characterIds: string[]; shot: string }; sfxHint?: string }> };
    const raw = cache.get<RawBeats>(seqKey) ??
      await run<RawBeats>(
        beatsPrompt({
          bookTitle: opts.bookTitle,
          sequenceJson: JSON.stringify(seq),
          sequenceMapsJson: JSON.stringify(seqMaps),
          clueGraphJson: graphJson,
          characters,
          actName: seq.title,
          isFirstSequence: qi === 0,
          isLastSequence: qi === plan.sequences.length - 1,
          endingImage: graph.endingImage,
        }),
        beatSchema,
        `P3-${seq.id}`,
      );
    cache.put(seqKey, raw);

    // id 全书重排（LLM 的局部编号不可信）+ 引语标签透传（eq 收窄到合法枚举）
    const EQS = ['recorder', 'phone'] as const;
    beatsBySeq[seq.id] = raw.beats.map((b) => ({
      id: `b${String(++beatSeq).padStart(3, '0')}`,
      kind: (['hook', 'turn', 'peak', 'close', 'coda'] as BeatKind[]).includes(b.kind as BeatKind) ? (b.kind as BeatKind) : 'turn',
      sentences: b.sentences.flatMap((s) => {
        const chunks = splitLongSentence(s.text);
        return chunks.map((text) => ({
          id: `s${String(++sentSeq).padStart(4, '0')}`,
          text,
          quote: s.quote?.voice
            ? { voice: s.quote.voice, eq: EQS.includes(s.quote.eq as (typeof EQS)[number]) ? (s.quote.eq as (typeof EQS)[number]) : undefined }
            : undefined,
        }));
      }),
      visual: {
        prompt: b.visual.prompt,
        characterIds: b.visual.characterIds.filter((id) => characters.some((c) => c.id === id)),
        shot: (['prop', 'env', 'back', 'hands', 'face'] as ShotKind[]).includes(b.visual.shot as ShotKind) ? (b.visual.shot as ShotKind) : 'env',
      },
      sfxHint: (['stinger', 'heartbeat', 'tick', 'none'] as const).includes(b.sfxHint as never) ? (b.sfxHint as NarrationBeat['sfxHint']) : undefined,
    }));
  }

  const script: NarrationScript = {
    bookId: opts.bookId,
    bookTitle: opts.bookTitle,
    targetMinutes: opts.targetMinutes,
    generatedAt: new Date().toISOString(),
    characters,
    acts: plan.acts,
    sequences: plan.sequences.map((s) => ({
      id: s.id, actId: s.actId, title: s.title, puzzleLabel: s.puzzleLabel,
      budgetChars: s.budgetChars, beats: beatsBySeq[s.id] ?? [],
    })),
  };

  writeFileSync(join(opts.outDir, 'script.json'), JSON.stringify(script, null, 2));
  writeScriptMd(script, maps, join(opts.outDir, 'script.md'));
  // 因果门对照源：maps 事实表 + 道德锁单独存档
  writeFileSync(join(opts.outDir, '.maps-facts.json'), JSON.stringify({
    facts: maps.flatMap((m) => m.facts.map((f) => ({ ch: m.no, ...f }))),
    moralityLocks: graph.characters.map((c) => ({ name: c.name, lock: c.moralityLock })),
    clueGraph: graph,
  }, null, 2));

  return { script, usage: { llmCalls } };
}

/** 超长句确定性切分：>42 字按 ，；、 边界切成 ≤36 字段（结构门对 LLM 长句的兜底） */
export function splitLongSentence(text: string): string[] {
  if (text.length <= 42) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 42) {
    let cut = -1;
    for (let i = 30; i >= 12; i--) {
      const ch = rest[i];
      if (ch === '，' || ch === '；' || ch === '、' || ch === '：') { cut = i + 1; break; }
    }
    if (cut <= 0) cut = 36; // 无标点可切则硬切
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length) {
    // 碎尾并入前段（避免 <8 字残句）
    if (parts.length && rest.length < 8) parts[parts.length - 1] += rest;
    else parts.push(rest);
  }
  return parts;
}

function writeScriptMd(script: NarrationScript, maps: Array<ChapterMap & { no: number }>, file: string): void {
  const lines: string[] = [`# 《${script.bookTitle}》解说脚本（${script.targetMinutes} 分钟版）`, ''];
  for (const seq of script.sequences) {
    const act = script.acts.find((a) => a.id === seq.actId);
    lines.push(`## [${act?.name ?? seq.actId}] ${seq.title}${seq.puzzleLabel ? `（${seq.puzzleLabel}）` : ''}　预算 ${seq.budgetChars} 字`);
    for (const b of seq.beats) {
      const tag = [b.kind, b.visual.shot, b.sfxHint && b.sfxHint !== 'none' ? `♪${b.sfxHint}` : ''].filter(Boolean).join('/');
      lines.push(`- **${b.id}**（${tag}）${b.sentences.map((s) => s.text).join('')}`);
      lines.push(`  - 🖼 ${b.visual.prompt}${b.visual.characterIds.length ? `　[角色: ${b.visual.characterIds.join(',')}]` : ''}`);
    }
    lines.push('');
  }
  const total = script.sequences.reduce((n, q) => n + q.beats.reduce((m, b) => m + b.sentences.reduce((k, s) => k + s.text.length, 0), 0), 0);
  lines.push(`---`, `总口播字数：${total}　预估时长：${(total / CHARS_PER_SEC / 60).toFixed(1)} 分钟`);
  writeFileSync(file, lines.join('\n'));
}

export { CHARS_PER_SEC };
export type { ChapterMap };
