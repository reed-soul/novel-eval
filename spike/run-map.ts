/**
 * Spike Step 3：Map 阶段验证
 *
 * 流程：读样本 → 正则分章 → 取前 N 章 → 并发调用 LLM → 校验每章输出
 *       → 记录 token/费用 → 写入 spike/output/map-results.json
 *
 * 验证点①：N 次调用是否都产出符合 schema 的 JSON
 * 验证点④（成本）：记录每章 token 与费用
 */
import './load-env.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM, loadPrompt } from '../src/llm.ts';
import { splitChapters, wordCount } from '../src/chapter-splitter.ts';
import { parseJSONRobust } from '../src/json-util.ts';
import type { MapChapterOutput, MapResult, TokenUsage } from '../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'output');
const SAMPLE_PATH = resolve(__dirname, '..', 'data', 'spike-samples', 'sample-novel.txt');
const CONCURRENCY = parseInt(process.env.SPIKE_CHAPTERS ?? '5', 10);

interface MapValidation {
  ok: boolean;
  errors: string[];
}

/** 校验 Map 输出是否符合 10.1 schema 约束 */
function validateMap(out: unknown): MapValidation {
  const errors: string[] = [];
  if (typeof out !== 'object' || out === null) {
    return { ok: false, errors: ['输出不是对象'] };
  }
  const o = out as Record<string, unknown>;
  if (typeof o.summary !== 'string') errors.push('summary 不是字符串');
  else if (o.summary.length < 20) errors.push(`summary 过短(${o.summary.length}字符)，期望 40-400`);
  if (typeof o.emotionalTension !== 'number') errors.push('emotionalTension 不是数字');
  else if (o.emotionalTension < 0 || o.emotionalTension > 100) errors.push(`emotionalTension 越界: ${o.emotionalTension}`);
  if (!Array.isArray(o.keyEvents)) errors.push('keyEvents 不是数组');
  else if (o.keyEvents.length < 1 || o.keyEvents.length > 8) errors.push(`keyEvents 数量异常: ${o.keyEvents.length}`);
  else if (!o.keyEvents.every((e) => typeof e === 'string')) errors.push('keyEvents 含非字符串元素');
  if (!Array.isArray(o.characters)) errors.push('characters 不是数组');
  else if (!o.characters.every((c) => typeof c === 'string')) errors.push('characters 含非字符串元素');
  return { ok: errors.length === 0, errors };
}

async function mapOneChapter(
  chapter: { id: string; title: string; content: string },
  promptTemplate: string,
): Promise<MapResult & { validation: MapValidation; rawOutput: string; attempts: number }> {
  const mapSchema = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      emotionalTension: { type: 'integer' },
      keyEvents: { type: 'array', items: { type: 'string' } },
      characters: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'emotionalTension', 'keyEvents', 'characters'],
  };

  // 重试机制（对齐设计文档修订12：校验失败→拼回错误重试，最多2次，共3次尝试）
  const MAX_ATTEMPTS = 3;
  let lastError = '';
  const allNotes: string[] = [];
  let totalUsage: TokenUsage = {
    inputTokens: 0, outputTokens: 0, costRmb: 0, model: '', durationMs: 0,
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let userPrompt = promptTemplate
      .replace('{TITLE}', chapter.title)
      .replace('{CONTENT}', chapter.content);

    // 重试时把上次错误拼进去
    if (attempt > 1 && lastError) {
      userPrompt += `\n\n——\n⚠️ 你上次的输出有问题：${lastError}\n请修正后重新输出 JSON。`;
    }

    const { text, usage, notes } = await callLLM({
      systemPrompt: '你是资深小说编辑，做逐章细读。只输出 JSON，不要任何额外文字。',
      userPrompt,
      outputSchema: mapSchema,
      temperature: attempt === 1 ? 0.3 : 0.2, // 重试时降温
      maxTokens: 1500,
      timeoutMs: 120_000,
    });

    totalUsage = {
      inputTokens: totalUsage.inputTokens + usage.inputTokens,
      outputTokens: totalUsage.outputTokens + usage.outputTokens,
      costRmb: totalUsage.costRmb + usage.costRmb,
      model: usage.model,
      durationMs: totalUsage.durationMs + usage.durationMs,
    };
    if (attempt === 1) allNotes.push(...notes);

    let parsed: MapChapterOutput;
    let validation: MapValidation;
    let parseError: string | undefined;
    try {
      parsed = parseJSONRobust(text) as MapChapterOutput;
      validation = validateMap(parsed);
    } catch (e) {
      parsed = { summary: '', emotionalTension: 0, keyEvents: [], characters: [] };
      validation = { ok: false, errors: [(e as Error).message] };
      parseError = (e as Error).message;
    }

    if (validation.ok) {
      return {
        ...chapter,
        summary: parsed.summary,
        emotionalTension: parsed.emotionalTension,
        keyEvents: parsed.keyEvents,
        characters: parsed.characters,
        usage: totalUsage,
        validation,
        rawOutput: text,
        attempts: attempt,
        llmNotes: allNotes,
      };
    }

    // 失败：记录错误，进入下一次重试
    lastError = parseError ?? validation.errors.join('; ');
    console.log(`    [${chapter.id}] 第 ${attempt} 次尝试失败，重试... (${lastError.slice(0, 60)})`);
  }

  // 全部重试失败
  return {
    ...chapter,
    summary: '',
    emotionalTension: 0,
    keyEvents: [],
    characters: [],
    usage: totalUsage,
    validation: { ok: false, errors: [`${MAX_ATTEMPTS} 次尝试均失败: ${lastError}`] },
    rawOutput: '',
    attempts: MAX_ATTEMPTS,
    llmNotes: allNotes,
  };
}

// ─── 主流程 ──────────────────────────────────────────────────────

async function main() {
  console.log('═══ Spike Step 3: Map 阶段验证 ═══');
  const raw = readFileSync(SAMPLE_PATH, 'utf-8');
  const { chapters, fallback } = splitChapters(raw);
  console.log(`分章: ${fallback ? '兜底单章' : `${chapters.length} 章`}`);

  const targets = chapters.slice(0, CONCURRENCY);
  console.log(`取前 ${targets.length} 章，并发评估：`);
  targets.forEach((c) =>
    console.log(`  ${c.id}  ${c.title}  (${wordCount(c.content)} 字)`),
  );
  console.log('');

  const promptTemplate = loadPrompt('map');

  // 并发调用
  const startedAt = Date.now();
  const results = await Promise.all(targets.map((c) => mapOneChapter(c, promptTemplate)));
  const elapsedMs = Date.now() - startedAt;

  // 汇总
  const allValid = results.every((r) => r.validation.ok);
  const totalUsage: TokenUsage = {
    inputTokens: results.reduce((s, r) => s + r.usage.inputTokens, 0),
    outputTokens: results.reduce((s, r) => s + r.usage.outputTokens, 0),
    costRmb: results.reduce((s, r) => s + r.usage.costRmb, 0),
    model: results[0]?.usage.model ?? 'unknown',
    durationMs: elapsedMs,
  };

  console.log('──────── 结果 ────────');
  results.forEach((r) => {
    const status = r.validation.ok ? '✓' : '✗';
    const retryTag = r.attempts > 1 ? ` (重试${r.attempts - 1}次)` : '';
    console.log(
      `${status} ${r.id} ${r.title} | 张力=${r.emotionalTension} | 角色=[${r.characters.join(',')}] | in=${r.usage.inputTokens} out=${r.usage.outputTokens} ${r.usage.costRmb.toFixed(4)}元${retryTag}`,
    );
    if (!r.validation.ok) console.log(`    校验错误: ${r.validation.errors.join('; ')}`);
    if (r.llmNotes?.length) console.log(`    兼容层 notes: ${r.llmNotes.join('; ')}`);
    console.log(`    摘要: ${r.summary.slice(0, 60)}...`);
  });

  console.log('');
  console.log('──────── 汇总 ────────');
  console.log(`全部校验通过: ${allValid ? '✓ 是' : '✗ 否（有章节不符合 schema）'}`);
  console.log(`总 token: 输入 ${totalUsage.inputTokens} / 输出 ${totalUsage.outputTokens}`);
  console.log(`总费用: ${totalUsage.costRmb.toFixed(4)} 元 (${totalUsage.model})`);
  console.log(`总耗时: ${(elapsedMs / 1000).toFixed(1)}s（${targets.length} 章并发）`);
  console.log(`平均每章: 输入 ${Math.round(totalUsage.inputTokens / targets.length)} / 输出 ${Math.round(totalUsage.outputTokens / targets.length)} / ${(totalUsage.costRmb / targets.length).toFixed(4)} 元`);

  // 写入输出（供 R2 使用）
  mkdirSync(OUT_DIR, { recursive: true });
  const summary = {
    timestamp: new Date().toISOString(),
    model: totalUsage.model,
    chapterCount: targets.length,
    concurrency: targets.length,
    allValid,
    totalUsage,
    results,
  };
  writeFileSync(resolve(OUT_DIR, 'map-results.json'), JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n已写入 ${resolve(OUT_DIR, 'map-results.json')}`);

  // 退出码：校验全过 = 0
  process.exit(allValid ? 0 : 1);
}

main().catch((e) => {
  console.error('Map 验证失败:', e);
  process.exit(2);
});
