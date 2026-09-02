/**
 * LLM 说话人归因——画本的最后一公里。
 *
 * 规则版（annotate.resolveSpeakers）对「引号在前、归属在后」「纯动作暗示」体例
 * 有天花板（森铁实测 ~30%）。本模块对未归属对白批量 asks LLM：
 *   输入：每条对白的局部上下文（前 180 字 + 对白 + 后 60 字）+ 全书角色名单
 *   输出：逐条 speaker（限 cast 名单内或 unknown）
 * 归属后按 voiceFor 重映射音色；结果缓存（上下文哈希 → speaker），重跑不重复计费。
 *
 * 引擎复用应用同款：engines.yml（bigmodel glm-5.3 / deepseek），key 走
 * ANTHROPIC_AUTH_TOKEN / ZHIPUAI_API_KEY / DEEPSEEK_API_KEY。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, loadEngineConfig, parseJSONRobust, type AIAgentAdapter } from '@novel-eval/shared';
import { voiceRuleFor, type Segment, type VoiceConfig } from './annotate.ts';

const SHARED_CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'shared', 'config');
const BATCH = 8;
const BEFORE_CHARS = 180;
const AFTER_CHARS = 60;

export interface AttributeOptions {
  engine?: AIAgentAdapter;      // 注入则不自建（测试用）
  engineName?: string;          // engines.yml 里的引擎名；缺省用 default
  cast: string[];               // 角色名单（含别名，长名在前）
  voiceCfg: VoiceConfig;
  cacheFile?: string;           // 缓存 JSON 路径；缺省不缓存
  onProgress?: (done: number, total: number) => void;
}

type Cache = Record<string, string>;

function loadCache(file?: string): Cache {
  if (!file || !existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Cache;
  } catch {
    return {};
  }
}

function cacheKey(context: string): string {
  return createHash('sha256').update(context).digest('hex').slice(0, 24);
}

interface BatchItem { seg: Segment; key: string; context: string }

/** 组装上下文摘录：前文取尾部、后文取头部，对白本体加【】标出 */
function buildExcerpt(segments: Segment[], idx: number): string {
  const before: string[] = [];
  let n = 0;
  for (let i = idx - 1; i >= 0 && n < BEFORE_CHARS; i--) {
    before.unshift(segments[i].text);
    n += segments[i].text.length;
  }
  const after: string[] = [];
  n = 0;
  for (let i = idx + 1; i < segments.length && n < AFTER_CHARS; i++) {
    after.push(segments[i].text);
    n += segments[i].text.length;
  }
  return `${before.join('').slice(-BEFORE_CHARS)}【${segments[idx].text}】${after.join('').slice(0, AFTER_CHARS)}`;
}

function normalizeName(raw: string, cast: string[]): string | null {
  const name = raw.trim().replace(/^["「']|["」']$/g, '');
  if (!name || /^(unknown|未知|无|旁白|narrator)$/i.test(name)) return null;
  if (cast.length) {
    return cast.find((c) => c.includes(name) || name.includes(c)) ?? null;
  }
  return name;
}

/** 用注入/自建引擎跑一批归因请求，返回 {序号→speaker|null} */
async function attributeBatch(
  engine: AIAgentAdapter,
  items: BatchItem[],
  cast: string[],
): Promise<Map<number, string | null>> {
  const castLine = cast.length ? `角色名单（只能从中选择）：${cast.join('、')}` : '角色名单不限定，可给出任何出场人物名。';
  const listing = items
    .map((it, i) => `${i + 1}. ${it.context.replace(/\n/g, ' ')}`)
    .join('\n');
  const prompt = [
    '以下是一部中文小说同一章里的若干段摘录。每段摘录中【】标出的是一句角色台词，请根据上下文判断这句话是谁说的。',
    castLine,
    '上下文不足以判断时填 "unknown"。只输出 JSON 数组，不要解释：',
    '[{"i":1,"speaker":"角色名或unknown"}, ...]',
    '',
    listing,
  ].join('\n');

  const result = await engine.run(prompt, {
    systemPrompt: '你是中文小说有声书制作的画本助手，擅长根据上下文判断台词的说话人。只输出严格 JSON。',
    temperature: 0.1,
    maxTokens: 800,
    disableThinking: true,
  });

  const out = new Map<number, string | null>();
  let arr: unknown;
  try {
    arr = parseJSONRobust(result.text);
  } catch {
    arr = null;
  }
  if (!Array.isArray(arr)) return out;
  for (const entry of arr) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { i, speaker } = entry as { i?: unknown; speaker?: unknown };
    if (typeof i !== 'number' || i < 1 || i > items.length) continue;
    out.set(i, typeof speaker === 'string' ? normalizeName(speaker, cast) : null);
  }
  return out;
}

/**
 * 就地补全 segments 中未归属对白的 speaker/voice。
 * 返回 { attributed, llmCalls }；cacheFile 提供时读写缓存。
 */
export async function attributeMissingSpeakers(
  segments: Segment[],
  opts: AttributeOptions,
): Promise<{ attributed: number; llmCalls: number }> {
  const missing = segments.filter((s) => s.kind === 'dialogue' && !s.speaker);
  if (missing.length === 0) return { attributed: 0, llmCalls: 0 };

  const cache = loadCache(opts.cacheFile);
  const engine = opts.engine ?? await defaultEngine(opts.engineName);

  // 先过缓存：空串 = 已知不可归属（unknown/cast 外），同样命中缓存避免重复计费
  const pending: BatchItem[] = [];
  for (const seg of missing) {
    const idx = segments.indexOf(seg);
    const context = buildExcerpt(segments, idx);
    const key = cacheKey(context);
    const hit = cache[key];
    if (hit !== undefined) {
      if (hit) applySpeaker(seg, hit, opts.voiceCfg);
    } else {
      pending.push({ seg, key, context });
    }
  }

  let llmCalls = 0;
  // 缓存命中即视为已处理（含空串=已知不可归属）；attributed 只统计真正拿到名字的
  let attributed = missing.length - pending.length;
  for (let start = 0; start < pending.length; start += BATCH) {
    const batch = pending.slice(start, start + BATCH);
    const resolved = await attributeBatch(engine, batch, opts.cast);
    llmCalls += 1;
    for (let i = 0; i < batch.length; i++) {
      const speaker = resolved.get(i + 1) ?? null;
      cache[batch[i].key] = speaker ?? ''; // unknown/被滤也缓存：同上下文不重复计费
      if (speaker) {
        applySpeaker(batch[i].seg, speaker, opts.voiceCfg);
        attributed += 1;
      }
    }
    opts.onProgress?.(Math.min(start + BATCH, pending.length), pending.length);
  }

  if (opts.cacheFile && llmCalls > 0) {
    writeFileSync(opts.cacheFile, JSON.stringify(cache, null, 1), 'utf-8');
  }
  return { attributed, llmCalls };
}

function applySpeaker(seg: Segment, speaker: string, cfg: VoiceConfig): void {
  seg.speaker = speaker;
  const rule = voiceRuleFor(speaker, cfg);
  seg.voice = rule?.voice ?? cfg.defaultSpeaker;
  if (rule?.rate) seg.rate = rule.rate;
  if (rule?.pitch) seg.pitch = rule.pitch;
}

async function defaultEngine(engineName?: string): Promise<AIAgentAdapter> {
  const { engine, engines } = loadEngineConfig(SHARED_CONFIG_DIR);
  const cfg = engineName ? engines[engineName] : engine;
  if (!cfg) throw new Error(`未知引擎：${engineName}`);
  return createEngine(cfg);
}
