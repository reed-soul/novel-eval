#!/usr/bin/env node
/**
 * Novel Eval CLI
 *
 *   novel-eval evaluate <file.txt> [options]
 *   novel-eval compare <baseline.json> <current.json> [--html]
 */
import { evaluate } from './core/evaluator.ts';
import { generateReport } from './report/html-generator.ts';
import { generateCompareReport } from './report/compare-html.ts';
import { runPreflight, formatPreflightSummary } from './core/preflight.ts';
import { loadResultJson, compareResults, formatCompareTerminal } from './core/compare.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { NovelMetadata } from './types.ts';

import '../spike/load-env.mjs';

interface EvaluateArgs {
  command: 'evaluate';
  filePath: string;
  profile?: string;
  title?: string;
  author?: string;
  genre?: string;
  audience?: string;
  platform?: string;
  yes?: boolean;
  baseline?: string;
}

interface CompareArgs {
  command: 'compare';
  baselinePath: string;
  currentPath: string;
  html?: boolean;
  outDir?: string;
}

type CliArgs = EvaluateArgs | CompareArgs | { command: 'help' };

function parseArgs(argv: string[]): CliArgs {
  const [, , command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help' };
  }

  if (command === 'compare') {
    const positional: string[] = [];
    let html = false;
    let outDir: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--html') html = true;
      else if (a === '--out') outDir = rest[++i];
      else if (!a.startsWith('--')) positional.push(a);
    }
    if (positional.length < 2) return { command: 'help' };
    return { command: 'compare', baselinePath: positional[0], currentPath: positional[1], html, outDir };
  }

  const args: EvaluateArgs = { command: 'evaluate', filePath: '' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--profile') args.profile = rest[++i];
    else if (a === '--title') args.title = rest[++i];
    else if (a === '--author') args.author = rest[++i];
    else if (a === '--genre') args.genre = rest[++i];
    else if (a === '--audience') args.audience = rest[++i];
    else if (a === '--platform') args.platform = rest[++i];
    else if (a === '--baseline') args.baseline = rest[++i];
    else if (a === '-y' || a === '--yes') args.yes = true;
    else if (!a.startsWith('--') && !args.filePath) args.filePath = a;
  }
  return args;
}

function printHelp(): void {
  console.log(`Novel Eval — 中文网文 AI 改稿评估器

用法：
  novel-eval evaluate <文件.txt> [选项]
  novel-eval compare <基线.json> <当前.json> [--html] [--out 目录]

evaluate 选项：
  --genre <类型>       小说类型（建议必填，如「都市言情」）
  --audience <受众>    目标受众（建议必填）
  --platform <平台>    发行平台（可选）
  --profile <name>     评估模式：default | revision | submission
  --title / --author   书名与作者
  --baseline <taskId>  关联基线任务 ID（改稿对比用）
  -y, --yes            跳过确认屏

compare 选项：
  --html               生成 compare.html
  --out <目录>         HTML 输出目录（默认当前目录）

示例：
  novel-eval evaluate ./book.txt --genre 玄幻 --audience 青年男性
  novel-eval compare ./reports/a/result.json ./reports/b/result.json --html`);
}

async function confirmProceed(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`${message}\nProceed? [Y/n] `);
  rl.close();
  const t = answer.trim();
  return t === '' || /^y(es)?$/i.test(t);
}

function resolveMetadata(args: EvaluateArgs): NovelMetadata {
  const genre = args.genre?.trim() || '未指定';
  const targetAudience = args.audience?.trim() || '未指定';
  return {
    genre,
    targetAudience,
    platform: args.platform?.trim() || undefined,
  };
}

async function runEvaluate(args: EvaluateArgs): Promise<void> {
  if (!args.filePath) {
    console.error('错误：缺少文件路径');
    process.exit(1);
  }

  const metadata = resolveMetadata(args);
  if (!args.genre || !args.audience) {
    console.warn('提示：建议提供 --genre 与 --audience，以提升市场潜力评估质量');
  }

  const preflight = runPreflight(args.filePath);
  console.log(formatPreflightSummary(preflight, metadata));
  console.log('');

  if (!args.yes) {
    const ok = await confirmProceed('');
    if (!ok) {
      console.log('已取消');
      return;
    }
  }

  console.log('Novel Eval — 开始评估\n');

  const { task, result } = await evaluate({
    filePath: args.filePath,
    profile: args.profile,
    title: args.title,
    author: args.author,
    metadata,
    baselineTaskId: args.baseline,
    onProgress: (msg) => console.log(`  ${msg}`),
  });

  const outDir = resolve('data', 'reports', task.id);
  mkdirSync(outDir, { recursive: true });
  const resultPath = resolve(outDir, 'result.json');
  writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');

  const { htmlPath } = generateReport(result, outDir);

  console.log('');
  console.log('✓ 完成');
  console.log(`  总分：${result.overall.totalScore}（${result.overall.grade}）`);
  console.log(`  费用：¥${task.cost.totalRmb.toFixed(4)}`);
  console.log(`  结果：${resultPath}`);
  console.log(`  报告：${htmlPath}`);
  console.log(`  打开：open "${htmlPath}"`);
}

function runCompare(args: CompareArgs): void {
  const baseline = loadResultJson(args.baselinePath);
  const current = loadResultJson(args.currentPath);
  const result = compareResults(baseline, current);
  console.log(formatCompareTerminal(result));

  if (args.html) {
    const outDir = args.outDir ?? dirname(resolve(args.currentPath));
    const htmlPath = generateCompareReport(result, outDir);
    console.log(`\n  对比报告：${htmlPath}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.command === 'help') {
    printHelp();
    return;
  }
  if (args.command === 'compare') {
    runCompare(args);
    return;
  }
  await runEvaluate(args);
}

main().catch((e) => {
  console.error('失败:', (e as Error).message);
  process.exit(1);
});
