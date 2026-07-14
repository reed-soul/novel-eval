#!/usr/bin/env node
/**
 * Novel Writer CLI — 写作模块入口（阶段 2）
 *
 *   novel-eval write init     --title ... --genre ... --audience ... --topic ...
 *   novel-eval write outline  <projectId> [--chapters N]
 *   novel-eval write chapter  <projectId> --number N | --from A --to B | --all
 *   novel-eval write status   <projectId>
 *   novel-eval write list
 */
import { createEngine, type AIAgentAdapter } from '@novel-eval/shared';
import { loadWriterConfig } from './config.ts';
import { loadEnv } from './load-env.ts';
import { openDb, closeDb, writerDataDir } from './db.ts';
import { createProject, getProject, listProjects, updateProjectStatus, type Project } from './project.ts';
import { generateBible } from './bible/generator.ts';
import { generateBlueprint } from './chapter/blueprint.ts';
import { generateChapter, generateRange } from './chapter/generator.ts';
import { ensureChapterConsistency } from './chapter/consistency.ts';
import { getBibleForChapter } from './chapter/store.ts';
import { getAllOutlines, countOutlines, countChapters, getChapter } from './chapter/store.ts';
import type { CharacterDynamic } from './bible/types.ts';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { isServerRunning, startApiJob, streamJobEvents } from './api-client.ts';

interface InitArgs {
  command: 'init';
  title: string;
  genre: string;
  audience: string;
  topic: string;
  yes?: boolean;
  engine?: string;          // 覆盖 engines.yml 默认引擎
}

interface OutlineArgs {
  command: 'outline';
  projectId: string;
  chapters?: number;
  yes?: boolean;
  engine?: string;
}

interface ChapterArgs {
  command: 'chapter';
  projectId: string;
  number?: number;
  from?: number;
  to?: number;
  all?: boolean;
  maxRevise?: number;       // 质量门槛：最大重写次数
  passGrade?: string;       // 质量门槛：通过等级
  engine?: string;
  wordCount?: number;       // 覆盖 writer.yml 的 chapterWordCount
}

interface AutoArgs {
  command: 'auto';
  title: string;
  genre: string;
  audience: string;
  topic: string;
  chapters: number;
  maxRevise?: number;
  passGrade?: string;
  yes?: boolean;
  engine?: string;
}

interface StatusArgs {
  command: 'status';
  projectId: string;
}

interface ResumeArgs {
  command: 'resume';
  projectId: string;
  maxRevise?: number;       // 可选：续写时启用质量门槛
  engine?: string;
}

type CliArgs = InitArgs | OutlineArgs | ChapterArgs | AutoArgs | StatusArgs | ResumeArgs | { command: 'list' } | { command: 'help' };

function parseArgs(argv: string[]): CliArgs {
  // argv = [node, script, ('write'), ('--'), command, ...rest]
  // drop 前两个（node + script），再丢掉 'write' 子命令和 '--' 分隔符（pnpm 转发时保留）
  const positional = argv.slice(2).filter((a) => a !== 'write' && a !== '--');
  const [cmd, ...rest] = positional;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    return { command: 'help' };
  }

  if (cmd === 'list') return { command: 'list' };

  if (cmd === 'status') {
    const projectId = rest.find((a) => !a.startsWith('--'));
    if (!projectId) return { command: 'help' };
    return { command: 'status', projectId };
  }

  if (cmd === 'resume') {
    const projectId = rest.find((a) => !a.startsWith('--'));
    if (!projectId) return { command: 'help' };
    const args: ResumeArgs = { command: 'resume', projectId };
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--max-revise') args.maxRevise = parseInt(rest[++i], 10);
      else if (rest[i] === '--engine') args.engine = rest[++i];
    }
    return args;
  }

  if (cmd === 'outline') {
    const projectId = rest.find((a) => !a.startsWith('--'));
    if (!projectId) return { command: 'help' };
    const args: OutlineArgs = { command: 'outline', projectId };
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--chapters') args.chapters = parseInt(rest[++i], 10);
      else if (rest[i] === '--engine') args.engine = rest[++i];
      else if (rest[i] === '-y' || rest[i] === '--yes') args.yes = true;
    }
    return args;
  }

  if (cmd === 'chapter') {
    const projectId = rest.find((a) => !a.startsWith('--'));
    if (!projectId) return { command: 'help' };
    const args: ChapterArgs = { command: 'chapter', projectId };
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--number') args.number = parseInt(rest[++i], 10);
      else if (rest[i] === '--from') args.from = parseInt(rest[++i], 10);
      else if (rest[i] === '--to') args.to = parseInt(rest[++i], 10);
      else if (rest[i] === '--all') args.all = true;
      else if (rest[i] === '--max-revise') args.maxRevise = parseInt(rest[++i], 10);
      else if (rest[i] === '--pass-grade') args.passGrade = rest[++i];
      else if (rest[i] === '--engine') args.engine = rest[++i];
      else if (rest[i] === '--word-count') args.wordCount = parseInt(rest[++i], 10);
    }
    return args;
  }

  if (cmd === 'auto') {
    const args: AutoArgs = { command: 'auto', title: '', genre: '', audience: '', topic: '', chapters: 30 };
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--title') args.title = rest[++i];
      else if (rest[i] === '--genre') args.genre = rest[++i];
      else if (rest[i] === '--audience') args.audience = rest[++i];
      else if (rest[i] === '--topic') args.topic = rest[++i];
      else if (rest[i] === '--chapters') args.chapters = parseInt(rest[++i], 10);
      else if (rest[i] === '--max-revise') args.maxRevise = parseInt(rest[++i], 10);
      else if (rest[i] === '--pass-grade') args.passGrade = rest[++i];
      else if (rest[i] === '--engine') args.engine = rest[++i];
      else if (rest[i] === '-y' || rest[i] === '--yes') args.yes = true;
    }
    return args;
  }

  if (cmd === 'init') {
    const args: InitArgs = { command: 'init', title: '', genre: '', audience: '', topic: '' };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--title') args.title = rest[++i];
      else if (a === '--genre') args.genre = rest[++i];
      else if (a === '--audience') args.audience = rest[++i];
      else if (a === '--topic') args.topic = rest[++i];
      else if (a === '--engine') args.engine = rest[++i];
      else if (a === '-y' || a === '--yes') args.yes = true;
    }
    return args;
  }

  return { command: 'help' };
}

function printHelp(): void {
  console.log(`Novel Writer — AI 驱动的小说写作工具

用法：
  novel-eval write init     --title <书名> --genre <类型> --audience <受众> --topic <主题>
  novel-eval write outline  <projectId> [--chapters N]
  novel-eval write chapter  <projectId> --number N | --from A --to B | --all [--max-revise N]
  novel-eval write resume   <projectId>           从上次断点续写（自动检测已写章节 + 修复半成品状态）
  novel-eval write auto     --title ... --genre ... --audience ... --topic ... --chapters N
  novel-eval write status   <projectId>
  novel-eval write list

init（创建项目 + 生成 bible 设定集）：
  --title/--genre/--audience/--topic   必填
  -y, --yes           跳过确认屏

outline（把 bible 拆成章节蓝图）：
  <projectId>         write init 返回的项目 ID
  --chapters <N>      目标章数（默认 50）

chapter（按蓝图生成章节正文）：
  --number <N>        生成第 N 章
  --from <A> --to <B> 生成第 A 到 B 章
  --all               生成全部章节
  --max-revise <N>    启用质量门槛，最大重写次数（默认不启用）
  --word-count <N>    覆盖每章字数（默认读 writer.yml 的 chapterWordCount）

resume（断点续写 — 中断/暂停后继续）：
  <projectId>         write init 返回的项目 ID
  --max-revise <N>    可选：续写时启用质量门槛
  自动检测：已完成章节跳过，半成品章节（正文已存但状态落后）自动补全叙事状态

auto（全自动：bible → 蓝图 → 章节 + 质量门槛）：
  --title/--genre/--audience/--topic   必填
  --chapters <N>      目标章数（默认 30）
  --max-revise <N>    质量门槛重写上限（默认 2）
  -y, --yes           跳过确认屏

通用选项（适用于 init/outline/chapter/resume/auto）：
  --engine <name>     指定引擎覆盖 engines.yml 默认值（如 bigmodel | deepseek）
                      不传则读 engines.yml 的 default

示例：
  novel-eval write auto --title "星海残响" --genre 科幻 --audience 青年男性 \\
    --topic "失忆探险者在废弃殖民地醒来" --chapters 12 -y
  ANTHROPIC_AUTH_TOKEN=<key> novel-eval write auto --engine bigmodel --title "..." ... -y`);
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

  const config = loadWriterConfig(args.engine ? { engine: args.engine } : undefined);
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

  const serverActive = await isServerRunning();
  if (serverActive) {
    console.log(`[API] 探测到 Web 服务正在运行，将通过 Web 后端发起任务以保持进度同步...`);
    try {
      const res = await fetch('http://localhost:3000/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: args.title,
          genre: args.genre,
          audience: args.audience,
          topic: args.topic,
          generate: true,
          engineName: args.engine,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown API error' })) as { error?: string };
        throw new Error(err.error || `HTTP error ${res.status}`);
      }
      const data = await res.json() as { project: { id: string }, jobId: string };
      console.log(`\n✓ 项目创建成功，ID：${data.project.id}`);
      console.log(`开始生成 bible...\n`);
      await streamJobEvents(data.jobId);
      console.log(`\n下一步（M2）：novel-eval write outline ${data.project.id}`);
      return;
    } catch (e) {
      console.error(`[API] 转发任务失败: ${(e as Error).message}，将降级为本地直接运行模式。`);
    }
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
  // M2：章节进度
  const outlineN = countOutlines(db, p.id);
  const chapterN = countChapters(db, p.id);
  if (outlineN > 0) {
    console.log(`\n  章节：蓝图 ${outlineN} 章 · 已写 ${chapterN} 章`);
    if (chapterN > 0) {
      const last = getChapter(db, p.id, chapterN);
      if (last) console.log(`    最新：第 ${last.number} 章《${last.title}》${last.wordCount} 字`);
    }
  }
}

async function runOutline(args: OutlineArgs): Promise<void> {
  const config = loadWriterConfig(args.engine ? { engine: args.engine } : undefined);
  const db = openDb();
  try {
    const project = getProject(db, args.projectId);
    if (!project) { console.error(`未找到项目：${args.projectId}`); process.exit(1); }

    const { plotArchitecture, characterState: _ } = getBibleForChapter(db, args.projectId);
    void _;
    // 读 character_dynamics（蓝图生成需要角色列表）
    const bibleRow = db.prepare('SELECT character_dynamics FROM bible WHERE project_id = ?').get(args.projectId) as
      | { character_dynamics: string | null } | undefined;
    if (!bibleRow?.character_dynamics) {
      console.error('bible 未完成，无法生成蓝图。请先运行 write init。');
      process.exit(1);
    }
    const characters = (JSON.parse(bibleRow.character_dynamics) as { characters: CharacterDynamic[] }).characters;
    const totalChapters = args.chapters ?? config.generation.defaultChapters;

    const existing = countOutlines(db, args.projectId);
    console.log(`Novel Writer — 生成章节蓝图\n  项目：${project.title}（${args.projectId}）`);
    console.log(`  目标：${totalChapters} 章${existing ? `（已有 ${existing} 章，将跳过）` : ''}\n`);

    if (!args.yes && existing === 0) {
      const ok = await confirmProceed('将生成章节蓝图（两层拆分，约 ¥0.03）');
      if (!ok) { console.log('已取消'); return; }
    }

    const serverActive = await isServerRunning();
    if (serverActive) {
      console.log(`[API] 探测到 Web 服务正在运行，将通过 Web 后端发起任务以保持进度同步...`);
      try {
        const jobId = await startApiJob(`/api/projects/${args.projectId}/outline/generate`, {
          chapters: totalChapters,
          engineName: args.engine,
        });
        await streamJobEvents(jobId);
        console.log(`\n下一步：novel-eval write chapter ${args.projectId} --from 1 --to 3`);
        return;
      } catch (e) {
        console.error(`[API] 转发任务失败: ${(e as Error).message}，将降级为本地直接运行模式。`);
      }
    }

    const engine: AIAgentAdapter = createEngine(config.engine);
    const { outlines, usage } = await generateBlueprint({
      engine, db, projectId: args.projectId,
      plot: plotArchitecture, characters, totalChapters,
      onProgress: (step, msg) => console.log(`  [${step}] ${msg}`),
    });

    updateProjectStatus(db, args.projectId, 'outlining');
    console.log('\n✓ 章节蓝图生成完成');
    console.log(`  章节数：${outlines.length}`);
    console.log(`  费用：¥${usage.costRmb.toFixed(4)}`);
    // 列出各幕分布
    const byAct = { 1: 0, 2: 0, 3: 0 };
    for (const o of outlines) byAct[o.act]++;
    console.log(`  分布：第一幕 ${byAct[1]} 章 / 第二幕 ${byAct[2]} 章 / 第三幕 ${byAct[3]} 章`);
    console.log(`\n下一步：novel-eval write chapter ${args.projectId} --from 1 --to 3`);
  } finally {
    closeDb(db);
  }
}

async function runChapter(args: ChapterArgs): Promise<void> {
  const config = loadWriterConfig(args.engine ? { engine: args.engine } : undefined);
  const db = openDb();
  try {
    const project = getProject(db, args.projectId);
    if (!project) { console.error(`未找到项目：${args.projectId}`); process.exit(1); }

    const outlineCount = countOutlines(db, args.projectId);
    if (outlineCount === 0) {
      console.error('还没有章节蓝图，请先运行 write outline。');
      process.exit(1);
    }

    // 确定范围
    let from: number, to: number;
    if (args.all) { from = 1; to = outlineCount; }
    else if (args.number !== undefined) { from = args.number; to = args.number; }
    else if (args.from !== undefined && args.to !== undefined) { from = args.from; to = args.to; }
    else { console.error('请指定 --number N 或 --from A --to B 或 --all'); process.exit(1); }

    console.log(`Novel Writer — 生成章节\n  项目：${project.title}（${args.projectId}）`);
    const wordCount = args.wordCount ?? config.generation.chapterWordCount;
    console.log(`  范围：第 ${from}-${to} 章（每章约 ${wordCount} 字）`);
    const useGate = args.maxRevise !== undefined;
    if (useGate) console.log(`  质量门槛：启用（maxRevise=${args.maxRevise ?? 2}）`);
    console.log('');

    const serverActive = await isServerRunning();
    if (serverActive) {
      console.log(`[API] 探测到 Web 服务正在运行，将通过 Web 后端发起任务以保持进度同步...`);
      try {
        const jobId = await startApiJob(`/api/projects/${args.projectId}/chapters/generate`, {
          from,
          to,
          qualityGate: useGate,
          maxRevise: args.maxRevise,
          engineName: args.engine,
          wordCount,
        });
        await streamJobEvents(jobId);

        // Write human readable txt file after SSE done
        const dbTemp = openDb();
        try {
          const results: { number: number; title: string; content: string }[] = [];
          for (let num = from; num <= to; num++) {
            const ch = getChapter(dbTemp, args.projectId, num);
            if (ch) results.push({ number: ch.number, title: ch.title || '', content: ch.content });
          }
          if (results.length > 0) {
            const { writeFileSync } = await import('node:fs');
            const { resolve } = await import('node:path');
            const outPath = resolve(writerDataDir(), `${args.projectId}-ch${from}-${to}.txt`);
            const text = results.map((r) => `第${r.number}章 ${r.title}\n\n${r.content}`).join('\n\n\n');
            writeFileSync(outPath, text, 'utf-8');
            console.log(`  导出：${outPath}`);
          }
        } finally {
          closeDb(dbTemp);
        }
        return;
      } catch (e) {
        console.error(`[API] 转发任务失败: ${(e as Error).message}，将降级为本地直接运行模式。`);
      }
    }

    updateProjectStatus(db, args.projectId, 'writing');
    const engine: AIAgentAdapter = createEngine(config.engine);
    const results = await generateRange({
      engine, db, projectId: args.projectId,
      from, to, wordCount,
      qualityGate: useGate ? {
        metadata: { genre: project.genre, targetAudience: project.audience },
        maxRevise: args.maxRevise ?? 2,
      } : undefined,
      onProgress: (step, msg) => console.log(`  [${step}] ${msg}`),
    });

    const totalCost = results.reduce((s, r) => s + r.usage.costRmb, 0);
    const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
    console.log(`\n✓ 章节生成完成`);
    console.log(`  生成：${results.length} 章 · ${totalWords} 字`);
    console.log(`  费用：¥${totalCost.toFixed(4)}`);
    // 写出 txt（方便阅读）
    if (results.length > 0) {
      const { writeFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const outPath = resolve(writerDataDir(), `${args.projectId}-ch${from}-${to}.txt`);
      const text = results.map((r) => `第${r.number}章 ${r.title}\n\n${r.content}`).join('\n\n\n');
      writeFileSync(outPath, text, 'utf-8');
      console.log(`  导出：${outPath}`);
    }
  } finally {
    closeDb(db);
  }
}

async function runResume(args: ResumeArgs): Promise<void> {
  const config = loadWriterConfig(args.engine ? { engine: args.engine } : undefined);
  const db = openDb();
  try {
    const project = getProject(db, args.projectId);
    if (!project) { console.error(`未找到项目：${args.projectId}`); process.exit(1); }

    if (countOutlines(db, args.projectId) === 0) {
      console.error('还没有章节蓝图，无法续写。请先运行 write outline。');
      process.exit(1);
    }

    console.log(`Novel Writer — 断点续写\n  项目：${project.title}（${args.projectId}）`);

    const serverActive = await isServerRunning();
    if (serverActive) {
      console.log(`[API] 探测到 Web 服务正在运行，将通过 Web 后端发起任务以保持进度同步...`);
      try {
        const activeRes = await fetch(`http://localhost:3000/api/projects/${args.projectId}/active-job`);
        const { job } = await activeRes.json() as { job: { id: string; status: string } | null };
        let jobId: string;
        let fromBound: number, toBound: number;
        
        if (job && (job.status === 'paused' || job.status === 'running')) {
          console.log(`  检测到已有活跃任务 [${job.id}]，正在请求恢复...`);
          jobId = await startApiJob(`/api/projects/jobs/${job.id}/resume`, {
            engineName: args.engine,
            maxRevise: args.maxRevise,
          });
          const dbTemp = openDb();
          try {
            toBound = countOutlines(dbTemp, args.projectId);
            const written = countChapters(dbTemp, args.projectId);
            fromBound = written + 1;
          } finally {
            closeDb(dbTemp);
          }
        } else {
          const dbTemp = openDb();
          try {
            toBound = countOutlines(dbTemp, args.projectId);
            const written = countChapters(dbTemp, args.projectId);
            fromBound = written + 1;
          } finally {
            closeDb(dbTemp);
          }
          if (fromBound > toBound) {
            console.log(`\n✓ 全部章节已完成，无需续写。`);
            return;
          }
          console.log(`  未检测到活跃任务，将启动新任务从第 ${fromBound} 章生成到第 ${toBound} 章...`);
          jobId = await startApiJob(`/api/projects/${args.projectId}/chapters/generate`, {
            from: fromBound,
            to: toBound,
            qualityGate: args.maxRevise !== undefined,
            maxRevise: args.maxRevise,
            engineName: args.engine,
          });
        }
        
        await streamJobEvents(jobId);

        // Write human readable txt file after SSE done
        const dbTemp = openDb();
        try {
          const results: { number: number; title: string; content: string }[] = [];
          for (let num = fromBound; num <= toBound; num++) {
            const ch = getChapter(dbTemp, args.projectId, num);
            if (ch) results.push({ number: ch.number, title: ch.title || '', content: ch.content });
          }
          if (results.length > 0) {
            const { writeFileSync } = await import('node:fs');
            const { resolve } = await import('node:path');
            const outPath = resolve(writerDataDir(), `${args.projectId}-ch${fromBound}-${toBound}.txt`);
            const text = results.map((r) => `第${r.number}章 ${r.title}\n\n${r.content}`).join('\n\n\n');
            writeFileSync(outPath, text, 'utf-8');
            console.log(`  导出：${outPath}`);
          }
        } finally {
          closeDb(dbTemp);
        }
        return;
      } catch (e) {
        console.error(`[API] 转发任务失败: ${(e as Error).message}，将降级为本地直接运行模式。`);
      }
    }

    const engine: AIAgentAdapter = createEngine(config.engine);

    // 一致性检查：补全半成品章节的叙事状态，返回 resume 起点
    const { from, to, finalizedGap } = await ensureChapterConsistency(
      engine, db, args.projectId,
      (step, msg) => console.log(`  [${step}] ${msg}`),
    );

    if (finalizedGap > 0) {
      console.log(`\n⚠ 检测到 ${finalizedGap} 章半成品（正文已存但叙事状态落后），已自动补全。`);
    }

    if (from > to) {
      console.log(`\n✓ 全部 ${to} 章已完成，无需续写。`);
      // 顺手修复 status 卡在 writing 的情况
      if (project.status === 'writing') {
        updateProjectStatus(db, args.projectId, 'completed');
        console.log('  项目状态已更新为 completed。');
      }
      return;
    }

    const resumeCount = to - from + 1;
    console.log(`  续写范围：第 ${from}-${to} 章（${resumeCount} 章待写，已完成章节自动跳过）`);
    console.log(`  每章约 ${config.generation.chapterWordCount} 字`);
    const useGate = args.maxRevise !== undefined;
    if (useGate) console.log(`  质量门槛：启用（maxRevise=${args.maxRevise ?? 2}）`);
    console.log('');

    updateProjectStatus(db, args.projectId, 'writing');
    const results = await generateRange({
      engine, db, projectId: args.projectId,
      from, to, wordCount: config.generation.chapterWordCount,
      qualityGate: useGate ? {
        metadata: { genre: project.genre, targetAudience: project.audience },
        maxRevise: args.maxRevise ?? 2,
      } : undefined,
      onProgress: (step, msg) => console.log(`  [${step}] ${msg}`),
    });

    if (from + results.length - 1 === to) {
      updateProjectStatus(db, args.projectId, 'completed');
    }

    const totalCost = results.reduce((s, r) => s + r.usage.costRmb, 0);
    const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
    const skipped = resumeCount - results.length;
    console.log(`\n✓ 续写完成`);
    console.log(`  本次生成：${results.length} 章 · ${totalWords} 字${skipped > 0 ? `（跳过 ${skipped} 章已完成）` : ''}`);
    console.log(`  费用：¥${totalCost.toFixed(4)}`);
    // 写出 txt（本次新生成的章节）
    if (results.length > 0) {
      const { writeFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const outPath = resolve(writerDataDir(), `${args.projectId}-ch${from}-${to}.txt`);
      const text = results.map((r) => `第${r.number}章 ${r.title}\n\n${r.content}`).join('\n\n\n');
      writeFileSync(outPath, text, 'utf-8');
      console.log(`  导出：${outPath}`);
    }
  } finally {
    closeDb(db);
  }
}

async function runAuto(args: AutoArgs): Promise<void> {
  // 校验必填
  const missing: string[] = [];
  if (!args.title) missing.push('--title');
  if (!args.genre) missing.push('--genre');
  if (!args.audience) missing.push('--audience');
  if (!args.topic) missing.push('--topic');
  if (missing.length) { console.error(`错误：缺少必填参数：${missing.join(', ')}`); process.exit(1); }

  const config = loadWriterConfig(args.engine ? { engine: args.engine } : undefined);
  console.log('Novel Writer — 全自动生成\n');
  console.log(`  书名：${args.title} · ${args.genre} · ${args.audience}`);
  console.log(`  主题：${args.topic}`);
  console.log(`  目标：${args.chapters} 章 · 每章约 ${config.generation.chapterWordCount} 字`);
  console.log(`  质量门槛：启用（maxRevise=${args.maxRevise ?? 2}）`);
  console.log(`  引擎：${config.engineName}（${config.engine.model}）`);
  console.log('');

  if (!args.yes) {
    const ok = await confirmProceed(`将全自动生成（bible + 蓝图 + ${args.chapters} 章正文 + 质量门槛），预估 ¥${(args.chapters * 0.05).toFixed(1)}-${(args.chapters * 0.08).toFixed(1)}`);
    if (!ok) { console.log('已取消'); return; }
  }

  const db = openDb();
  try {
    const engine: AIAgentAdapter = createEngine(config.engine);
    const log = (step: string, msg: string) => console.log(`  [${step}] ${msg}`);

    // 1. bible
    console.log('\n── 阶段 1：bible 生成 ──');
    const project = createProject(db, { title: args.title, genre: args.genre, audience: args.audience, topic: args.topic });
    const { bible, usage: bibleUsage } = await generateBible({
      engine, db, projectId: project.id, topic: args.topic, genre: args.genre, audience: args.audience, onProgress: log,
    });
    updateProjectStatus(db, project.id, 'bible_done');
    console.log(`✓ bible 完成（${bible.characterDynamics.length} 角色 / ${bible.plotArchitecture.foreshadows.length} 伏笔 / ¥${bibleUsage.costRmb.toFixed(4)}）`);

    // 2. outline
    console.log('\n── 阶段 2：章节蓝图 ──');
    const { outlines, usage: outlineUsage } = await generateBlueprint({
      engine, db, projectId: project.id, plot: bible.plotArchitecture, characters: bible.characterDynamics, totalChapters: args.chapters, onProgress: log,
    });
    updateProjectStatus(db, project.id, 'outlining');
    console.log(`✓ 蓝图完成（${outlines.length} 章 / ¥${outlineUsage.costRmb.toFixed(4)}）`);

    // 3. chapter（带质量门槛）
    console.log('\n── 阶段 3：章节生成（带质量门槛）──');
    updateProjectStatus(db, project.id, 'writing');
    const results = await generateRange({
      engine, db, projectId: project.id, from: 1, to: outlines.length,
      wordCount: config.generation.chapterWordCount,
      qualityGate: { metadata: { genre: args.genre, targetAudience: args.audience }, maxRevise: args.maxRevise ?? 2 },
      onProgress: log,
    });
    updateProjectStatus(db, project.id, 'completed');

    const totalCost = bibleUsage.costRmb + outlineUsage.costRmb + results.reduce((s, r) => s + r.usage.costRmb, 0);
    const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
    console.log(`\n✓ 全自动生成完成`);
    console.log(`  生成：${results.length} 章 · ${totalWords} 字`);
    console.log(`  总费用：¥${totalCost.toFixed(4)}`);
    console.log(`  项目 ID：${project.id}`);
    // 导出 txt
    const { writeFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const outPath = resolve(writerDataDir(), `${project.id}-full.txt`);
    const text = results.map((r) => `第${r.number}章 ${r.title}\n\n${r.content}`).join('\n\n\n');
    writeFileSync(outPath, text, 'utf-8');
    console.log(`  导出：${outPath}`);
  } finally {
    closeDb(db);
  }
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv);
  if (args.command === 'help') { printHelp(); return; }
  if (args.command === 'list') { runList(); return; }
  if (args.command === 'status') { runStatus(args); return; }
  if (args.command === 'outline') { await runOutline(args); return; }
  if (args.command === 'chapter') { await runChapter(args); return; }
  if (args.command === 'resume') { await runResume(args); return; }
  if (args.command === 'auto') { await runAuto(args); return; }
  await runInit(args);
}

main().catch((e) => {
  console.error('失败:', (e as Error).message);
  process.exit(1);
});
