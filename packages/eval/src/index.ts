#!/usr/bin/env node
/**
 * Novel Eval CLI（评估子命令入口）
 *
 *   novel-eval evaluate <file.txt> [options]
 *   novel-eval compare <baseline.json> <current.json> [--html]
 *   novel-eval golden check|slice|run [options]
 */
import { evaluate } from './evaluator.ts';
import { generateReport } from './report/html-generator.ts';
import { generateCompareReport } from './report/compare-html.ts';
import { runPreflight, formatPreflightSummary } from './preflight.ts';
import { loadResultJson, compareResults, formatCompareTerminal } from './compare.ts';
import { runGoldenCheck, runGoldenEvaluate, runGoldenSlice } from './golden/run-golden.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { NovelMetadata } from './types.ts';
import { loadEnv } from './load-env.ts';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function resolveEvalDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.EVAL_DATA_DIR?.trim();
  return configured ? resolve(configured) : resolve(PACKAGE_ROOT, 'data');
}

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

interface GoldenArgs {
  command: 'golden';
  subcommand: 'check' | 'slice' | 'run' | 'help';
  caseIds?: string[];
  dryRun?: boolean;
  forceAssert?: boolean;
  yes?: boolean;
  vcrMode?: 'record' | 'replay';
}

type CliArgs = EvaluateArgs | CompareArgs | GoldenArgs | { command: 'help' };

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

  if (command === 'golden') {
    const sub = rest[0];
    if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
      return { command: 'golden', subcommand: 'help' };
    }
    if (sub !== 'check' && sub !== 'slice' && sub !== 'run') {
      return { command: 'golden', subcommand: 'help' };
    }
    const args: GoldenArgs = { command: 'golden', subcommand: sub };
    const caseIds: string[] = [];
    for (let i = 1; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--case') caseIds.push(rest[++i]);
      else if (a === '--dry-run') args.dryRun = true;
      else if (a === '--force-assert') args.forceAssert = true;
      else if (a === '--vcr-record') args.vcrMode = 'record';
      else if (a === '--vcr-replay') args.vcrMode = 'replay';
      else if (a === '-y' || a === '--yes') args.yes = true;
    }
    if (args.vcrMode === 'record' && args.dryRun) {
      // dry-run wins for safety; run-golden logs a note
    }
    if (caseIds.length) args.caseIds = caseIds;
    return args;
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
  novel-eval golden check|slice|run [选项]

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

golden 选项：
  --case <id>          只跑指定 case（可重复）
  --dry-run            run 时只 check+slice，不调 LLM
  --vcr-record         录制 LLM 响应到 tests/golden/cassettes/<id>/
  --vcr-replay         仅回放 cassette（缺卡带则失败，不打网）
  --force-assert       对 pending_annotation 也强制校验分数带
  -y, --yes            评估时跳过确认（golden run 默认跳过）

示例：
  novel-eval evaluate ./book.txt --genre 玄幻 --audience 青年男性
  novel-eval compare ./reports/a/result.json ./reports/b/result.json --html
  novel-eval golden check
  novel-eval golden run --dry-run
  novel-eval golden run --vcr-replay --case literary-bailuyuan
  novel-eval golden run --case literary-bailuyuan`);
}

function printGoldenHelp(): void {
  console.log(`novel-eval golden — 真实长篇评估基准

子命令：
  check   检查语料是否存在、能否切分
  slice   生成 tests/golden/slices/<id>.txt
  run     评估切片；对 status=active|seeded_baseline 校验分数带

VCR：
  --vcr-record  首次/刷新录制（需 API key）
  --vcr-replay  无网回放（需已有 cassettes）

详见 tests/golden/README.md`);
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

  const reportsDir = resolve(resolveEvalDataRoot(), 'reports');
  const outDir = resolve(reportsDir, task.id);
  mkdirSync(outDir, { recursive: true });
  const resultPath = resolve(outDir, 'result.json');
  writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');

  const { htmlPath } = generateReport(result, outDir);

  console.log('');
  console.log('✓ 完成');
  console.log(`  总分：${result.overall.totalScore}（${result.overall.grade}）`);
  if (result.coverage && !result.coverage.complete) {
    console.log(`  ⚠ 覆盖不完整：${(result.coverage.incompleteReasons ?? []).join('; ')}`);
    console.log(
      `  证据回链：${result.coverage.evidenceLinkedCount ?? 0}/${result.coverage.excerptCount}` +
        (result.coverage.evidenceLinkRate !== undefined
          ? `（${(result.coverage.evidenceLinkRate * 100).toFixed(0)}%）`
          : ''),
    );
  }
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

async function runGolden(args: GoldenArgs): Promise<void> {
  if (args.subcommand === 'help') {
    printGoldenHelp();
    return;
  }

  const common = {
    caseIds: args.caseIds,
    dryRun: args.dryRun,
    forceAssert: args.forceAssert,
    yes: args.yes ?? true,
    vcrMode: args.vcrMode,
    onLog: (msg: string) => console.log(msg),
  };

  if (args.subcommand === 'check') {
    const result = runGoldenCheck(common);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (args.subcommand === 'slice') {
    const result = runGoldenSlice(common);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const result = await runGoldenEvaluate(common);
  process.exitCode = result.ok ? 0 : 1;
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv);
  if (args.command === 'help') {
    printHelp();
    return;
  }
  if (args.command === 'compare') {
    runCompare(args);
    return;
  }
  if (args.command === 'golden') {
    await runGolden(args);
    return;
  }
  await runEvaluate(args);
}

main().catch((e) => {
  console.error('失败:', (e as Error).message);
  process.exit(1);
});
