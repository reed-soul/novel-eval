/**
 * Spike Step 4：R2 五维评分验证
 *
 * 流程：读 Map 结果 → 构造 R2 prompt → 单次调用 LLM → 校验五维输出完整性
 *       → 跑 quotes 回链 → 统计命中率 → 记录 token/费用
 *
 * 验证点②：单次调用输出是否完整（五维齐全、各含 analysis+quotes）、是否截断
 * 验证点③：quotes 回链命中率（精确/模糊/null 占比）
 */
import './load-env.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM, loadPrompt } from '../src/llm.ts';
import { parseJSONRobust } from '../src/json-util.ts';
import { linkQuotes } from '../src/quote-linker.ts';
import { splitChapters } from '../src/chapter-splitter.ts';
import type { DimensionKey, R2Output, TokenUsage } from '../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'output');

const DIMENSIONS: DimensionKey[] = [
  'storyStructure', 'characterization', 'writingQuality',
  'emotionalResonance', 'marketPotential',
];

const DIM_LABELS: Record<DimensionKey, string> = {
  storyStructure: '故事架构',
  characterization: '人物塑造',
  writingQuality: '文笔质量',
  emotionalResonance: '情感共鸣',
  marketPotential: '市场潜力',
};

interface R2Validation {
  ok: boolean;
  errors: string[];
  truncated: boolean;
}

/** 校验 R2 输出：五维齐全、各维度有 score/analysis/quotes、未截断 */
function validateR2(out: unknown): R2Validation {
  const errors: string[] = [];
  if (typeof out !== 'object' || out === null) return { ok: false, errors: ['输出不是对象'], truncated: false };
  const dims = (out as { dimensions?: unknown }).dimensions;
  if (typeof dims !== 'object' || dims === null) return { ok: false, errors: ['缺 dimensions'], truncated: false };

  const d = dims as Record<string, unknown>;
  for (const key of DIMENSIONS) {
    if (!d[key]) {
      errors.push(`缺维度 ${key}`);
      continue;
    }
    const dim = d[key] as Record<string, unknown>;
    if (typeof dim.score !== 'number' || dim.score < 0 || dim.score > 100) {
      errors.push(`${key}.score 异常: ${dim.score}`);
    }
    if (typeof dim.analysis !== 'string' || dim.analysis.length < 30) {
      errors.push(`${key}.analysis 过短或缺失 (len=${String(dim.analysis).length})`);
    }
    if (!Array.isArray(dim.quotes) || dim.quotes.length < 1) {
      errors.push(`${key}.quotes 缺失或为空`);
    }
  }

  // 截断检测：如果 marketPotential（最后一个维度）缺失或不完整，很可能是截断
  const truncated = !d.marketPotential || typeof (d.marketPotential as { score?: unknown }).score !== 'number';

  return { ok: errors.length === 0, errors, truncated };
}

async function runR2(): Promise<{
  output: R2Output | null;
  validation: R2Validation;
  usage: TokenUsage;
  rawOutput: string;
  attempts: number;
}> {
  // 读 Map 结果
  const mapData = JSON.parse(readFileSync(resolve(OUT_DIR, 'map-results.json'), 'utf-8')) as {
    results: Array<{ id: string; title: string; summary: string; emotionalTension: number; keyEvents: string[]; characters: string[] }>;
  };

  // 构造各章记录（给 R2 看的证据）
  const chaptersBlock = mapData.results.map((r) =>
    `【${r.id} ${r.title}】\n  摘要: ${r.summary}\n  情绪张力: ${r.emotionalTension}\n  关键事件: ${r.keyEvents.map((e, i) => `\n    ${i + 1}. ${e}`).join('')}\n  出场角色: ${r.characters.join('、')}`,
  ).join('\n\n');

  const promptTemplate = loadPrompt('reduce-r2');
  const userPrompt = promptTemplate.replace('{CHAPTERS}', chaptersBlock);

  // R2 的 outputSchema（对齐 10.3）
  const r2Schema = {
    type: 'object',
    properties: {
      dimensions: {
        type: 'object',
        properties: {
          storyStructure: { type: 'object' },
          characterization: { type: 'object' },
          writingQuality: { type: 'object' },
          emotionalResonance: { type: 'object' },
          marketPotential: { type: 'object' },
        },
      },
    },
  };

  // 重试
  const MAX_ATTEMPTS = 3;
  let lastError = '';
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, costRmb: 0, model: '', durationMs: 0 };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let prompt = userPrompt;
    if (attempt > 1 && lastError) {
      prompt += `\n\n——\n⚠️ 你上次的输出有问题：${lastError}\n请修正后完整输出 JSON。`;
    }

    console.log(`R2 第 ${attempt} 次调用...`);
    const { text, usage } = await callLLM({
      systemPrompt: '你是资深小说总编，做全局五维评判。只输出 JSON，不要任何额外文字。每个维度的 analysis 至少 100 字，quotes 至少 1 条且必须逐字摘录原文。',
      userPrompt: prompt,
      outputSchema: r2Schema,
      temperature: 0.4,
      maxTokens: 8192, // R2 输出大，给足
      timeoutMs: 180_000,
    });

    totalUsage = {
      inputTokens: totalUsage.inputTokens + usage.inputTokens,
      outputTokens: totalUsage.outputTokens + usage.outputTokens,
      costRmb: totalUsage.costRmb + usage.costRmb,
      model: usage.model,
      durationMs: totalUsage.durationMs + usage.durationMs,
    };

    let parsed: R2Output;
    let validation: R2Validation;
    try {
      parsed = parseJSONRobust(text) as R2Output;
      validation = validateR2(parsed);
    } catch (e) {
      parsed = null as unknown as R2Output;
      validation = { ok: false, errors: [(e as Error).message], truncated: true };
    }

    if (validation.ok) {
      console.log(`  ✓ 第 ${attempt} 次成功（输出 ${usage.outputTokens} tokens）`);
      return { output: parsed, validation, usage: totalUsage, rawOutput: text, attempts: attempt };
    }

    lastError = validation.errors.join('; ').slice(0, 200);
    console.log(`  ✗ 第 ${attempt} 次失败: ${lastError.slice(0, 80)}`);
    if (validation.truncated) console.log(`    ⚠️ 疑似截断（末维度不完整）`);
  }

  return { output: null, validation: { ok: false, errors: [lastError], truncated: true }, usage: totalUsage, rawOutput: '', attempts: MAX_ATTEMPTS };
}

async function main() {
  console.log('═══ Spike Step 4: R2 五维评分验证 ═══');

  const { output, validation, usage, rawOutput, attempts } = await runR2();

  console.log('');
  console.log('──────── 五维评分 ────────');

  if (!output || !validation.ok) {
    console.log('✗ R2 校验失败，无法输出评分');
    console.log(`  错误: ${validation.errors.join('; ')}`);
    console.log(`  截断: ${validation.truncated ? '是' : '否'}`);
    console.log(`  重试次数: ${attempts}`);
    console.log(`  rawOutput 长度: ${rawOutput.length}`);
    writeFileSync(resolve(OUT_DIR, 'r2-raw-failed.txt'), rawOutput, 'utf-8');
    process.exit(1);
  }

  // 读章节正文（用于 quotes 回链）
  const sampleRaw = readFileSync(resolve(__dirname, '..', 'data', 'spike-samples', 'sample-novel.txt'), 'utf-8');
  const { chapters } = splitChapters(sampleRaw);
  const chapterMap = new Map(chapters.map((c) => [c.id, c.content]));

  // 展示评分 + 收集所有 quotes 跑回链
  const allQuotes: Array<{ dimension: DimensionKey } & R2Output['dimensions']['storyStructure']['quotes'][number]> = [];
  for (const key of DIMENSIONS) {
    const dim = output.dimensions[key];
    console.log(`\n${DIM_LABELS[key]} (${key}): ${dim.score} 分`);
    if (dim.subscores) {
      console.log(`  子项: ${Object.entries(dim.subscores).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    }
    console.log(`  分析: ${dim.analysis}`);
    console.log(`  引用 (${dim.quotes.length} 条):`);
    dim.quotes.forEach((q, i) => {
      console.log(`    ${i + 1}. [${q.chapterId}] "${q.text.slice(0, 40)}${q.text.length > 40 ? '...' : ''}"`);
      allQuotes.push({ dimension: key, ...q });
    });
  }

  // quotes 回链
  console.log('');
  console.log('──────── quotes 回链统计 ────────');
  const { linked, stats } = linkQuotes(allQuotes, chapterMap);
  console.log(`总 quotes: ${stats.total}`);
  console.log(`  精确命中: ${stats.exact} (${pct(stats.exact, stats.total)})`);
  console.log(`  模糊命中: ${stats.fuzzy} (${pct(stats.fuzzy, stats.total)})`);
  console.log(`  未命中:   ${stats.none} (${pct(stats.none, stats.total)})`);
  const hitRate = pct(stats.exact + stats.fuzzy, stats.total);
  console.log(`  总命中率: ${hitRate}`);

  if (stats.none > 0) {
    console.log('  未命中的 quotes:');
    linked.filter((l) => l.matchedBy === 'none').forEach((l) => {
      console.log(`    [${l.chapterId}] "${l.text.slice(0, 40)}..."`);
    });
  }

  console.log('');
  console.log('──────── 成本 ────────');
  console.log(`R2 总 token: 输入 ${usage.inputTokens} / 输出 ${usage.outputTokens}`);
  console.log(`R2 费用: ${usage.costRmb.toFixed(4)} 元 (${usage.model})`);
  console.log(`R2 重试: ${attempts} 次`);

  // 写入
  mkdirSync(OUT_DIR, { recursive: true });
  const summary = {
    timestamp: new Date().toISOString(),
    model: usage.model,
    validation: { ok: validation.ok, truncated: validation.truncated, attempts },
    usage,
    output,
    quoteLinkStats: stats,
    quoteLinkHitRate: hitRate,
    linkedQuotes: linked,
  };
  writeFileSync(resolve(OUT_DIR, 'r2-results.json'), JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n已写入 ${resolve(OUT_DIR, 'r2-results.json')}`);

  process.exit(validation.ok ? 0 : 1);
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${((n / total) * 100).toFixed(0)}%`;
}

main().catch((e) => {
  console.error('R2 验证失败:', e);
  process.exit(2);
});
