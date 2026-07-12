#!/usr/bin/env node
/**
 * Novel Writer CLI — 写作模块入口（阶段 2 M1）
 *
 *   novel-eval write init   --title ... --genre ... --audience ... --topic ...
 *   novel-eval write status <projectId>
 *   novel-eval write list
 *
 * M1 只实现 init（生成 bible）、status（查看项目）、list（列出项目）。
 * M2 起增加 outline / chapter 命令；M3 增加 auto 命令。
 */
import { createEngine, type AIAgentAdapter } from '@novel-eval/shared';
import { loadWriterConfig } from './config.ts';
import { openDb, closeDb, writerDataDir } from './db.ts';
import { createProject, getProject, listProjects, updateProjectStatus, type Project } from './project.ts';
import { generateBible } from './bible/generator.ts';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

interface InitArgs {
  command: 'init';
  title: string;
  genre: string;
  audience: string;
  topic: string;
  yes?: boolean;
}

interface StatusArgs {
  command: 'status';
  projectId: string;
}

type CliArgs = InitArgs | StatusArgs | { command: 'list' } | { command: 'help' };

function parseArgs(argv: string[]): CliArgs {
  const [, , , command, ...rest] = argv;
  // 兼容 `write init` 和直接 `init`（根 script 传 write 子命令）
  const cmd = command === 'write' ? rest.shift() : command;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    return { command: 'help' };
  }

  if (cmd === 'list') return { command: 'list' };

  if (cmd === 'status') {
    const projectId = rest.find((a) => !a.startsWith('--'));
    if (!projectId) return { command: 'help' };
    return { command: 'status', projectId };
  }

  if (cmd === 'init') {
    const args: InitArgs = { command: 'init', title: '', genre: '', audience: '', topic: '' };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--title') args.title = rest[++i];
      else if (a === '--genre') args.genre = rest[++i];
      else if (a === '--audience') args.audience = rest[++i];
      else if (a === '--topic') args.topic = rest[++i];
      else if (a === '-y' || a === '--yes') args.yes = true;
    }
    return args;
  }

  return { command: 'help' };
}

function printHelp(): void {
  console.log(`Novel Writer — AI 驱动的小说写作工具（M1：bible 生成）

用法：
  novel-eval write init   --title <书名> --genre <类型> --audience <受众> --topic <主题>
  novel-eval write status <projectId>
  novel-eval write list

init 选项（全部必填）：
  --title <书名>      书名
  --genre <类型>      小说类型（如「玄幻」「都市言情」「悬疑」）
  --audience <受众>   目标受众（如「青年男性」「青年女性」）
  --topic <主题>      核心创意/主题（一句话描述你想写的故事）
  -y, --yes           跳过确认屏

示例：
  novel-eval write init --title "无尽星海" --genre 科幻 --audience 青年男性 \\
    --topic "一个失忆的星际探险者在废弃殖民地醒来，发现自己是唯一幸存者"

注意：M1 只生成 bible（设定集）。章节生成（write chapter）在 M2 实现。`);
}

async function confirmProceed(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`${message}\nProceed? [Y/n] `);
  rl.close();
  const t = answer.trim();
  return t === '' || /^y(es)?$/i.test(t);
}

async function runInit(args: InitArgs): Promise<void> {
  // 校验必填
  const missing: string[] = [];
  if (!args.title) missing.push('--title');
  if (!args.genre) missing.push('--genre');
  if (!args.audience) missing.push('--audience');
  if (!args.topic) missing.push('--topic');
  if (missing.length) {
    console.error(`错误：缺少必填参数：${missing.join(', ')}`);
    process.exit(1);
  }

  const config = loadWriterConfig();
  console.log('Novel Writer — 初始化写作项目\n');
  console.log(`  书名：${args.title}`);
  console.log(`  类型：${args.genre} · 受众：${args.audience}`);
  console.log(`  主题：${args.topic}`);
  console.log(`  引擎：${config.engineName}（${config.engine.model}）`);
  console.log('');

  if (!args.yes) {
    const ok = await confirmProceed('将生成完整 bible（雪花法 4 步，约 ¥0.05-0.1）');
    if (!ok) { console.log('已取消'); return; }
  }

  console.log('\n开始生成 bible...\n');

  const db = openDb();
  try {
    const project = createProject(db, {
      title: args.title, genre: args.genre, audience: args.audience, topic: args.topic,
    });
    const engine: AIAgentAdapter = createEngine(config.engine);

    const { bible, usage } = await generateBible({
      engine, db, projectId: project.id,
      topic: args.topic, genre: args.genre, audience: args.audience,
      onProgress: (step, msg) => console.log(`  [${step}] ${msg}`),
    });

    updateProjectStatus(db, project.id, 'bible_done');

    console.log('\n✓ Bible 生成完成');
    console.log(`  项目 ID：${project.id}`);
    console.log(`  数据库：${writerDataDir()}/writer.db`);
    console.log(`  费用：¥${usage.costRmb.toFixed(4)}（in ${usage.inputTokens} / out ${usage.outputTokens} tok）`);
    console.log(`  角色：${bible.characterDynamics.length} 个`);
    console.log(`  伏笔：${bible.plotArchitecture.foreshadows.length} 个`);
    console.log(`  设定全文：${bible.fullText.length} 字`);
    console.log(`\n下一步（M2）：novel-eval write outline ${project.id}`);
  } finally {
    closeDb(db);
  }
}

function runStatus(args: StatusArgs): void {
  const db = openDb();
  try {
    const project = getProject(db, args.projectId);
    if (!project) {
      console.error(`未找到项目：${args.projectId}`);
      process.exit(1);
    }
    printProject(project, db);
  } finally {
    closeDb(db);
  }
}

function runList(): void {
  const db = openDb();
  try {
    const projects = listProjects(db);
    if (!projects.length) {
      console.log('暂无项目。用 novel-eval write init 创建。');
      return;
    }
    console.log('写作项目列表：\n');
    for (const p of projects) {
      console.log(`  ${p.id.slice(0, 8)}  ${p.title.padEnd(20)} ${p.status.padEnd(12)} ${p.createdAt.slice(0, 10)}`);
    }
  } finally {
    closeDb(db);
  }
}

function printProject(p: Project, db: ReturnType<typeof openDb>): void {
  console.log(`项目：${p.title}（${p.id}）`);
  console.log(`  类型：${p.genre} · 受众：${p.audience}`);
  console.log(`  主题：${p.topic}`);
  console.log(`  状态：${p.status}`);
  console.log(`  创建：${p.createdAt}`);
  const bibleRow = db.prepare('SELECT * FROM bible WHERE project_id = ?').get(p.id) as
    | { core_seed: string | null; character_dynamics: string | null; character_state: string | null; world_building: string | null; plot_architecture: string | null; full_text: string | null }
    | undefined;
  if (bibleRow) {
    console.log('\n  Bible：');
    console.log(`    核心种子：${bibleRow.core_seed ? '✓' : '✗'}`);
    console.log(`    角色动力学：${bibleRow.character_dynamics ? '✓' : '✗'}`);
    console.log(`    角色状态：${bibleRow.character_state ? '✓' : '✗'}`);
    console.log(`    世界观：${bibleRow.world_building ? '✓' : '✗'}`);
    console.log(`    情节架构：${bibleRow.plot_architecture ? '✓' : '✗'}`);
    console.log(`    设定全文：${bibleRow.full_text ? bibleRow.full_text.length + ' 字' : '✗'}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.command === 'help') { printHelp(); return; }
  if (args.command === 'list') { runList(); return; }
  if (args.command === 'status') { runStatus(args); return; }
  await runInit(args);
}

main().catch((e) => {
  console.error('失败:', (e as Error).message);
  process.exit(1);
});
