#!/usr/bin/env node
/**
 * Novel Eval CLI 入口（对齐设计文档 v2.2 第八章）
 *
 * 用法：novel-eval evaluate ./book.txt [--profile default|revision|submission] [--title 标题] [--author 作者]
 */
import { evaluate } from './core/evaluator.ts';
import { generateReport } from './report/html-generator.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// 加载环境变量（兼容从 ~/.claude/settings.json 读取的开发环境）
import '../spike/load-env.mjs';

interface CliArgs {
  command: string;
  filePath?: string;
  profile?: string;
  title?: string;
  author?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const [, , command, ...rest] = argv;
  const args: CliArgs = { command: command ?? 'help' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--profile') args.profile = rest[++i];
    else if (a === '--title') args.title = rest[++i];
    else if (a === '--author') args.author = rest[++i];
    else if (!a.startsWith('--') && !args.filePath) args.filePath = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    console.log(`Novel Eval — AI 小说五维评估系统

用法：
  novel-eval evaluate <文件路径> [选项]

选项：
  --profile <name>   评估模式：default | revision | submission（默认 default）
  --title <标题>     指定小说标题
  --author <作者>    指定作者

示例：
  novel-eval evaluate ./book.txt
  novel-eval evaluate ./book.txt --profile revision --title "我的小说"`);
    return;
  }

  if (args.command !== 'evaluate') {
    console.error(`未知命令: ${args.command}。用 'novel-eval help' 查看用法。`);
    process.exit(1);
  }

  if (!args.filePath) {
    console.error('错误：缺少文件路径。用法：novel-eval evaluate <文件路径>');
    process.exit(1);
  }

  console.log(`Novel Eval — 开始评估`);
  console.log(`文件：${args.filePath}`);
  console.log(`模式：${args.profile ?? 'default'}`);
  console.log('');

  const { task, result } = await evaluate({
    filePath: args.filePath,
    profile: args.profile,
    title: args.title,
    author: args.author,
    onProgress: (msg) => console.log(`  ${msg}`),
  });

  // 写结果 JSON
  const outDir = resolve('data', 'reports', task.id);
  mkdirSync(outDir, { recursive: true });
  const resultPath = resolve(outDir, 'result.json');
  writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');

  // 生成 HTML 报告
  const { htmlPath } = generateReport(result, outDir);

  console.log('');
  console.log(`✓ 完成`);
  console.log(`  总分：${result.overall.totalScore}（${result.overall.grade}）`);
  console.log(`  费用：¥${task.cost.totalRmb.toFixed(4)}`);
  console.log(`  结果：${resultPath}`);
  console.log(`  报告：${htmlPath}`);
  console.log(`  打开：open "${htmlPath}"`);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
