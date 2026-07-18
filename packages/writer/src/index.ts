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
import { createEngine, resolveWriterApiUrl, type AIAgentAdapter } from '@novel-eval/shared';
import { loadWriterConfig } from './config.ts';
import { loadEnv } from './load-env.ts';
import { openDb, closeDb, type DB } from './db.ts';
import { createProject, getProject, listProjects, updateProjectStatus, type Project } from './project.ts';
import type { ImportBibleInput } from './bible/importer.ts';
import type { CharacterDynamic } from './bible/types.ts';
import { getBibleForChapter } from './chapter/store.ts';
import { countOutlines, countChapters, getChapter } from './chapter/store.ts';
import { projectId } from './domain/ids.ts';
import { PlanningRepository } from './repositories/planning-repository.ts';
import { WriterApplication } from './services/writer-application.ts';
import {
  RevisionTaskService,
  isRevisionTaskStatus,
} from './services/revision-task-service.ts';
import { REVISION_TASK_STATUSES } from './repositories/revision-task-repository.ts';
import { extractStoryState } from './chapter/finalizer.ts';
import { chapterRevisionId } from './domain/ids.ts';
import {
  completeProjectIfFullyWritten,
  finalizeExhaustedResumeJob,
} from './project-completion.ts';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { isServerRunning, startApiJob, streamJobEvents } from './api-client.ts';

function writerApiUrl(): string {
  return resolveWriterApiUrl(process.env);
}

function configuredDatabasePath(): string {
  const path = process.env.WRITER_DB_PATH;
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('WRITER_DB_PATH must be set to an explicit database path');
  }
  return path;
}

function openConfiguredDb(): DB {
  return openDb({ path: configuredDatabasePath() });
}

function createApp(db: DB): WriterApplication {
  return new WriterApplication(db, { defaultOwnerId: 'cli' });
}

interface InitArgs {
  command: 'init';
  title: string;
  genre: string;
  audience: string;
  topic: string;
  yes?: boolean;
  approvePlanning?: boolean;
  engine?: string;          // 覆盖 engines.yml 默认引擎
}

interface ImportBibleArgs {
  command: 'import-bible';
  title: string;
  genre: string;
  audience: string;
  topic: string;
  bibleFile: string;        // 结构化 bible JSON 文件路径
  yes?: boolean;
}

interface OutlineArgs {
  command: 'outline';
  projectId: string;
  chapters?: number;
  yes?: boolean;
  approvePlanning?: boolean;
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
  approvePlanning?: boolean;
  engine?: string;
  /** Override writer.yml chapterWordCount for the chapter phase. */
  wordCount?: number;
}

interface ApprovePlanningArgs {
  command: 'approve-planning';
  projectId: string;
  bible?: boolean;
  outlines?: boolean;
  bibleRevisionId?: string;
  from?: number;
  to?: number;
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

interface RevisionTasksImportArgs {
  command: 'revision-tasks';
  action: 'import';
  projectId: string;
  fromEval: string;
  replaceOpen?: boolean;
  maxSuggestions?: number;
}

interface RevisionTasksListArgs {
  command: 'revision-tasks';
  action: 'list';
  projectId: string;
  status?: string;
}

interface RevisionTasksSetStatusArgs {
  command: 'revision-tasks';
  action: 'set-status';
  projectId: string;
  taskId: string;
  status: string;
}

interface RevisionTasksOpenCorrectionArgs {
  command: 'revision-tasks';
  action: 'open-correction';
  projectId: string;
  taskId: string;
}

type RevisionTasksArgs =
  | RevisionTasksImportArgs
  | RevisionTasksListArgs
  | RevisionTasksSetStatusArgs
  | RevisionTasksOpenCorrectionArgs;

interface FinalizeDraftArgs {
  command: 'finalize-draft';
  projectId: string;
  revisionId: string;
  engine?: string;
}

type CliArgs =
  | InitArgs
  | ImportBibleArgs
  | OutlineArgs
  | ChapterArgs
  | AutoArgs
  | ApprovePlanningArgs
  | StatusArgs
  | ResumeArgs
  | RevisionTasksArgs
  | FinalizeDraftArgs
  | { command: 'list' }
  | { command: 'help' };

/** Exported for unit tests; CLI entry also uses this. */
export function parseArgs(argv: string[]): CliArgs {
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

  if (cmd === 'approve-planning') {
    const projectIdValue = rest.find((a) => !a.startsWith('--'));
    if (!projectIdValue) return { command: 'help' };
    const args: ApprovePlanningArgs = { command: 'approve-planning', projectId: projectIdValue };
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--bible') args.bible = true;
      else if (rest[i] === '--outlines') args.outlines = true;
      else if (rest[i] === '--bible-revision') args.bibleRevisionId = rest[++i];
      else if (rest[i] === '--from') args.from = parseInt(rest[++i], 10);
      else if (rest[i] === '--to') args.to = parseInt(rest[++i], 10);
    }
    if (!args.bible && !args.outlines) {
      args.bible = true;
      args.outlines = true;
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
      else if (rest[i] === '--approve-planning') args.approvePlanning = true;
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
      else if (rest[i] === '--word-count') args.wordCount = parseInt(rest[++i], 10);
      else if (rest[i] === '-y' || rest[i] === '--yes') args.yes = true;
      else if (rest[i] === '--approve-planning') args.approvePlanning = true;
    }
    return args;
  }

  if (cmd === 'import-bible') {
    const args: ImportBibleArgs = { command: 'import-bible', title: '', genre: '', audience: '', topic: '', bibleFile: '' };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--title') args.title = rest[++i];
      else if (a === '--genre') args.genre = rest[++i];
      else if (a === '--audience') args.audience = rest[++i];
      else if (a === '--topic') args.topic = rest[++i];
      else if (a === '--bible-file') args.bibleFile = rest[++i];
      else if (a === '-y' || a === '--yes') args.yes = true;
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
      else if (a === '--approve-planning') args.approvePlanning = true;
    }
    return args;
  }

  if (cmd === 'revision-tasks') {
    const [action, ...actionRest] = rest;
    if (action === 'import') {
      const projectIdValue = actionRest.find((a) => !a.startsWith('--'));
      if (!projectIdValue) return { command: 'help' };
      const args: RevisionTasksImportArgs = {
        command: 'revision-tasks',
        action: 'import',
        projectId: projectIdValue,
        fromEval: '',
      };
      for (let i = 0; i < actionRest.length; i++) {
        if (actionRest[i] === '--from-eval') args.fromEval = actionRest[++i] ?? '';
        else if (actionRest[i] === '--replace-open') args.replaceOpen = true;
        else if (actionRest[i] === '--max-suggestions') {
          args.maxSuggestions = parseInt(actionRest[++i] ?? '', 10);
        }
      }
      return args;
    }
    if (action === 'list') {
      const projectIdValue = actionRest.find((a) => !a.startsWith('--'));
      if (!projectIdValue) return { command: 'help' };
      const args: RevisionTasksListArgs = {
        command: 'revision-tasks',
        action: 'list',
        projectId: projectIdValue,
      };
      for (let i = 0; i < actionRest.length; i++) {
        if (actionRest[i] === '--status') args.status = actionRest[++i];
      }
      return args;
    }
    if (action === 'set-status') {
      const positionals = actionRest.filter((a) => !a.startsWith('--'));
      const [projectIdValue, taskId, status] = positionals;
      if (!projectIdValue || !taskId || !status) return { command: 'help' };
      return {
        command: 'revision-tasks',
        action: 'set-status',
        projectId: projectIdValue,
        taskId,
        status,
      };
    }
    if (action === 'open-correction') {
      const positionals = actionRest.filter((a) => !a.startsWith('--'));
      const [projectIdValue, taskId] = positionals;
      if (!projectIdValue || !taskId) return { command: 'help' };
      return {
        command: 'revision-tasks',
        action: 'open-correction',
        projectId: projectIdValue,
        taskId,
      };
    }
    return { command: 'help' };
  }

  if (cmd === 'finalize-draft') {
    const projectIdValue = rest.find((a) => !a.startsWith('--'));
    if (!projectIdValue) return { command: 'help' };
    const args: FinalizeDraftArgs = {
      command: 'finalize-draft',
      projectId: projectIdValue,
      revisionId: '',
    };
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--revision') args.revisionId = rest[++i] ?? '';
      else if (rest[i] === '--engine') args.engine = rest[++i];
    }
    if (!args.revisionId) return { command: 'help' };
    return args;
  }

  return { command: 'help' };
}

function printHelp(): void {
  console.log(`Novel Writer — AI 驱动的小说写作工具

用法：
  novel-eval write init         --title <书名> --genre <类型> --audience <受众> --topic <主题>
  novel-eval write import-bible --title <书名> --genre <类型> --audience <受众> --topic <主题> --bible-file <结构化bible.json>
  novel-eval write outline      <projectId> [--chapters N]
  novel-eval write approve-planning <projectId> [--bible] [--outlines] [--from A --to B]
  novel-eval write chapter      <projectId> --number N | --from A --to B | --all [--max-revise N]
  novel-eval write resume       <projectId>           从上次断点续写（自动检测已写章节 + 修复半成品状态）
  novel-eval write auto         --title ... --genre ... --audience ... --topic ... --chapters N [--word-count N]
  novel-eval write status       <projectId>
  novel-eval write list
  novel-eval write revision-tasks import <projectId> --from-eval <result.json> [--replace-open] [--max-suggestions N]
  novel-eval write revision-tasks list <projectId> [--status open]
  novel-eval write revision-tasks set-status <projectId> <taskId> <status>
  novel-eval write revision-tasks open-correction <projectId> <taskId>
  novel-eval write finalize-draft <projectId> --revision <draftRevisionId>

【两种创作模式】
  init        适合「只有一句话/一个想法」的创作者——AI 用雪花法从 topic 自动发散出角色/世界观/情节。
  import-bible 适合「已有完整设定/大纲」的创作者——直接导入结构化 bible JSON，跳过 AI 发散，
              保证设定不走样。后续 outline/chapter 照常由 AI 生成。两种模式不冲突。

init（创建项目 + 生成 bible 设定集）：
  --title/--genre/--audience/--topic   必填
  -y, --yes           跳过确认屏
  --approve-planning  生成后显式批准 bible draft（自动化用）

import-bible（导入结构化 bible，规格模式）：
  --title/--genre/--audience/--topic   必填（topic 作为梗概拼入设定全文）
  --bible-file <path> 必填，结构化 JSON（含 coreSeed/characterDynamics/worldBuilding/plotArchitecture）
  -y, --yes           跳过确认屏

outline（把 bible 拆成章节蓝图）：
  <projectId>         write init 返回的项目 ID
  --chapters <N>      目标章数（默认 50）
  --approve-planning  生成后显式批准本次 outline draft

approve-planning（批准规划 draft）：
  <projectId>         项目 ID
  --bible             只批准 bible draft
  --outlines          只批准 outline draft
  --bible-revision <id> 指定 bible revision；默认取最新 draft
  --from <A> --to <B> 批准指定章节范围；默认批准全部 outline

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

auto（全自动：bible → 蓝图 → 章节）：
  --title/--genre/--audience/--topic   必填
  --chapters <N>      目标章数（默认 30）
  --word-count <N>    覆盖每章字数（默认读 writer.yml 的 chapterWordCount）
  --max-revise <N>    启用质量门槛，最大重写次数（默认不启用）
  --approve-planning  必填：在 bible 和 outline 生成后显式批准规划
  -y, --yes           跳过确认屏

revision-tasks（评估建议 → 可审阅修订清单，不自动改写正文）：
  import              从评估 result JSON 导入 suggestions
  list                列出项目修订任务
  set-status          更新任务状态（open|in_progress|done|dismissed）

通用选项（适用于 init/outline/chapter/resume/auto）：
  --engine <name>     指定引擎覆盖 engines.yml 默认值（如 bigmodel | deepseek）
                      不传则读 engines.yml 的 default

示例：
  novel-eval write auto --title "星海残响" --genre 科幻 --audience 青年男性 \\
    --topic "失忆探险者在废弃殖民地醒来" --chapters 12 --word-count 1200 -y
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
      const res = await fetch(`${writerApiUrl()}/api/projects`, {
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
      if (args.approvePlanning) {
        const approvalDb = openConfiguredDb();
        try {
          const approvalApp = createApp(approvalDb);
          const revisionId = approveLatestBibleDraft(approvalDb, approvalApp, data.project.id);
          console.log(`\n✓ Bible revision 已批准：${revisionId}`);
        } finally {
          closeDb(approvalDb);
        }
      }
      console.log(`\n下一步（M2）：novel-eval write outline ${data.project.id}`);
      if (!args.approvePlanning) {
        console.log(`先批准 bible：novel-eval write approve-planning ${data.project.id} --bible`);
      }
      return;
    } catch (e) {
      console.error(`[API] 转发任务失败: ${(e as Error).message}，将降级为本地直接运行模式。`);
    }
  }

  console.log('\n开始生成 bible...\n');

  const db = openConfiguredDb();
  try {
    const project = createProject(db, {
      title: args.title, genreProfile: args.genre, targetAudience: args.audience, premise: args.topic,
    });
    const engine: AIAgentAdapter = createEngine(config.engine);
    const app = createApp(db);

    const { bible, bibleRevisionId, usage } = await app.generateBible({
      engine, projectId: project.id,
      topic: args.topic, genre: args.genre, audience: args.audience,
      onProgress: (step, msg) => console.log(`  [${step}] ${msg}`),
    });

    updateProjectStatus(db, project.id, 'planning');
    if (args.approvePlanning) {
      app.approveBibleRevision({ projectId: project.id, revisionId: bibleRevisionId });
    }

    console.log(`\n✓ Bible draft 生成完成${args.approvePlanning ? '并已批准' : ''}`);
    console.log(`  项目 ID：${project.id}`);
    console.log(`  Bible revision：${bibleRevisionId}`);
    console.log(`  数据库：${configuredDatabasePath()}`);
    console.log(`  费用：¥${usage.costRmb.toFixed(4)}（in ${usage.inputTokens} / out ${usage.outputTokens} tok）`);
    console.log(`  角色：${bible.characterDynamics.length} 个`);
    console.log(`  伏笔：${bible.plotArchitecture.foreshadows.length} 个`);
    console.log(`  设定全文：${bible.fullText.length} 字`);
    if (args.approvePlanning) {
      console.log(`\n下一步（M2）：novel-eval write outline ${project.id}`);
    } else {
      console.log(`\n下一步：novel-eval write approve-planning ${project.id} --bible`);
    }
  } finally {
    closeDb(db);
  }
}

async function runImportBible(args: ImportBibleArgs): Promise<void> {
  // 校验必填
  const missing: string[] = [];
  if (!args.title) missing.push('--title');
  if (!args.genre) missing.push('--genre');
  if (!args.audience) missing.push('--audience');
  if (!args.topic) missing.push('--topic');
  if (!args.bibleFile) missing.push('--bible-file');
  if (missing.length) {
    console.error(`错误：缺少必填参数：${missing.join(', ')}`);
    process.exit(1);
  }

  // 读取并解析结构化 bible JSON
  let input: ImportBibleInput;
  try {
    const raw = readFileSync(args.bibleFile, 'utf-8');
    input = JSON.parse(raw) as ImportBibleInput;
  } catch (e) {
    console.error(`读取 bible 文件失败：${(e as Error).message}`);
    process.exit(1);
  }

  console.log('Novel Writer — 导入结构化 bible（规格模式，跳过雪花法）\n');
  console.log(`  书名：${args.title}`);
  console.log(`  类型：${args.genre} · 受众：${args.audience}`);
  console.log(`  bible 文件：${args.bibleFile}`);
  console.log(`  角色：${input.characterDynamics?.length ?? 0} 个（来自你的设定，不经过 AI 发散）`);
  console.log('');

  if (!args.yes) {
    const ok = await confirmProceed('将导入 bible（不调用 AI，直接写库）');
    if (!ok) { console.log('已取消'); return; }
  }

  const db = openConfiguredDb();
  try {
    const project = createProject(db, {
      title: args.title, genreProfile: args.genre, targetAudience: args.audience, premise: args.topic,
    });
    const app = createApp(db);

    const { bible } = app.importBible({
      projectId: project.id, input,
      topic: args.topic, genre: args.genre, audience: args.audience,
    });

    updateProjectStatus(db, project.id, 'planning');

    console.log('\n✓ Bible 导入完成');
    console.log(`  项目 ID：${project.id}`);
    console.log(`  角色：${bible.characterDynamics.length} 个`);
    console.log(`  伏笔：${bible.plotArchitecture.foreshadows.length} 个`);
    console.log(`  设定全文：${bible.fullText.length} 字`);
    console.log(`\n下一步：novel-eval write outline ${project.id} --chapters 110`);
  } finally {
    closeDb(db);
  }
}

function runStatus(args: StatusArgs): void {
  const db = openConfiguredDb();
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
  const db = openConfiguredDb();
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

function runRevisionTasks(args: RevisionTasksArgs): void {
  const db = openConfiguredDb();
  try {
    const service = new RevisionTaskService(db);
    if (args.action === 'import') {
      if (!args.fromEval) {
        console.error('错误：revision-tasks import 需要 --from-eval <result.json>');
        process.exit(1);
      }
      const raw = JSON.parse(readFileSync(resolve(args.fromEval), 'utf-8')) as unknown;
      const envelope = (typeof raw === 'object' && raw !== null ? raw : {}) as {
        suggestions?: unknown[];
        result?: { suggestions?: unknown[] };
      };
      const outcome = service.importFromEval({
        projectId: args.projectId,
        suggestions: Array.isArray(envelope.suggestions) ? envelope.suggestions : undefined,
        result: envelope.result
          ?? (Array.isArray(envelope.suggestions) ? undefined : envelope),
        replaceOpen: args.replaceOpen === true,
        maxSuggestions: args.maxSuggestions,
      });
      console.log(`✓ 导入修订任务 ${outcome.created.length} 条（dismissed open: ${outcome.dismissedOpenCount}）`);
      for (const task of outcome.created) {
        console.log(`  ${task.id.slice(0, 8)}  [${task.scope}] ${task.dimension ?? '-'}  ${task.content.slice(0, 60)}`);
      }
      return;
    }

    if (args.action === 'list') {
      if (args.status !== undefined && !isRevisionTaskStatus(args.status)) {
        console.error(`错误：非法 status ${args.status}；期望 ${REVISION_TASK_STATUSES.join('|')}`);
        process.exit(1);
      }
      const tasks = service.list(
        args.projectId,
        args.status && isRevisionTaskStatus(args.status) ? { status: args.status } : undefined,
      );
      if (!tasks.length) {
        console.log('暂无修订任务。');
        return;
      }
      console.log(`修订任务（${tasks.length}）：\n`);
      for (const task of tasks) {
        console.log(
          `  ${task.id.slice(0, 8)}  ${task.status.padEnd(12)} [${task.scope}] ${task.dimension ?? '-'}`,
        );
        console.log(`           ${task.content}`);
      }
      return;
    }

    if (args.action === 'open-correction') {
      const opened = service.openCorrection({
        projectId: args.projectId,
        taskId: args.taskId,
      });
      console.log(`✓ 修订任务 → 第 ${opened.chapterNumber} 章修正`);
      console.log(`  task：${opened.task.id.slice(0, 8)} → ${opened.task.status}`);
      console.log(`  path：${opened.path}`);
      console.log(
        `  下一步：在 Web 打开该 path（会带 revisionTaskId），或 POST .../chapters/${opened.chapterNumber}/correct` +
          ` {"revisionTaskId":"${opened.task.id}"}`,
      );
      return;
    }

    if (!isRevisionTaskStatus(args.status)) {
      console.error(`错误：非法 status ${args.status}；期望 ${REVISION_TASK_STATUSES.join('|')}`);
      process.exit(1);
    }
    const task = service.setStatus({
      projectId: args.projectId,
      taskId: args.taskId,
      status: args.status,
    });
    console.log(`✓ ${task.id.slice(0, 8)} → ${task.status}`);
  } finally {
    closeDb(db);
  }
}

async function runFinalizeDraft(args: FinalizeDraftArgs): Promise<void> {
  const config = loadWriterConfig(args.engine ? { engine: args.engine } : undefined);
  const db = openConfiguredDb();
  try {
    const app = createApp(db);
    const engine = createEngine(config.engine);
    const published = await app.finalizeDraftRevision({
      projectId: projectId(args.projectId),
      candidateRevisionId: chapterRevisionId(args.revisionId),
      model: config.engine.model,
      promptVersion: 'state-v1',
      onProgress: (step, msg) => console.log(`  [${step}] ${msg}`),
      extractState: async (input) => extractStoryState({
        engine,
        previousState: input.previousState,
        chapterTitle: input.title,
        chapterContent: input.content,
        chapterRevisionId: input.chapterRevisionId,
        outlinePosition: input.outlinePosition,
        promptVersion: 'state-v1',
      }),
    });
    console.log(`✓ draft 已 finalize / 发布`);
    console.log(`  chapterRevision：${published.chapterRevisionId}`);
    console.log(`  storyStateRevision：${published.storyStateRevisionId}`);
  } finally {
    closeDb(db);
  }
}

function runApprovePlanning(args: ApprovePlanningArgs): void {
  const db = openConfiguredDb();
  try {
    const project = getProject(db, args.projectId);
    if (!project) {
      console.error(`未找到项目：${args.projectId}`);
      process.exit(1);
    }
    const app = createApp(db);
    if (args.bible) {
      const revisionId = args.bibleRevisionId
        ? approveBibleRevisionById(app, args.projectId, args.bibleRevisionId)
        : approveLatestBibleDraft(db, app, args.projectId);
      console.log(`✓ Bible revision 已批准：${revisionId}`);
    }
    if (args.outlines) {
      const approved = approveOutlineDrafts(db, app, args.projectId, args.from, args.to);
      console.log(`✓ Outline 已批准：${approved} 章`);
    }
  } finally {
    closeDb(db);
  }
}

function approveLatestBibleDraft(db: DB, app: WriterApplication, rawProjectId: string): string {
  const id = projectId(rawProjectId);
  const draft = new PlanningRepository(db).getDraftBibleForProject(id);
  if (!draft) {
    throw new Error('没有可批准的 bible draft');
  }
  app.approveBibleRevision({
    projectId: id,
    revisionId: draft.id,
  });
  return draft.id;
}

function approveBibleRevisionById(
  app: WriterApplication,
  rawProjectId: string,
  revisionId: string,
): string {
  app.approveBibleRevision({
    projectId: projectId(rawProjectId),
    revisionId,
  });
  return revisionId;
}

function approveOutlineDrafts(
  db: DB,
  app: WriterApplication,
  rawProjectId: string,
  fromOverride?: number,
  toOverride?: number,
): number {
  const total = countOutlines(db, rawProjectId);
  if (total === 0) {
    return 0;
  }
  const from = fromOverride ?? 1;
  const to = toOverride ?? total;
  const result = app.approveOutlines({
    projectId: projectId(rawProjectId),
    from,
    to,
  });
  return result.outlines.length;
}

function printProject(p: Project, db: ReturnType<typeof openDb>): void {
  console.log(`项目：${p.title}（${p.id}）`);
  console.log(`  类型：${p.genreProfile} · 受众：${p.targetAudience}`);
  console.log(`  主题：${p.premise}`);
  console.log(`  状态：${p.status}`);
  console.log(`  创建：${p.createdAt}`);
  const bible = new PlanningRepository(db).getActiveBibleForProject(p.id);
  if (bible) {
    const doc = bible.bible;
    console.log('\n  Bible：');
    console.log(`    revision：${bible.revisionNumber}（${bible.status}）`);
    console.log(`    核心种子：${doc.coreSeed ? '✓' : '✗'}`);
    console.log(`    角色动力学：${doc.characterDynamics ? '✓' : '✗'}`);
    console.log(`    角色状态：${doc.characterState ? '✓' : '✗'}`);
    console.log(`    世界观：${doc.worldBuilding ? '✓' : '✗'}`);
    console.log(`    情节架构：${doc.plotArchitecture ? '✓' : '✗'}`);
    console.log(`    设定全文：${bible.compiledText.length} 字`);
  }
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
  const db = openConfiguredDb();
  try {
    const project = getProject(db, args.projectId);
    if (!project) { console.error(`未找到项目：${args.projectId}`); process.exit(1); }

    const { plotArchitecture, characterState: _ } = getBibleForChapter(db, args.projectId);
    void _;
    const activeBible = new PlanningRepository(db).getActiveBibleForProject(projectId(args.projectId));
    if (!activeBible) {
      console.error('bible 未完成，无法生成蓝图。请先运行 write init。');
      process.exit(1);
    }
    const dynamics = activeBible.bible.characterDynamics;
    if (!Array.isArray(dynamics)) {
      console.error('bible 未完成，无法生成蓝图。请先运行 write init。');
      process.exit(1);
    }
    const characters = dynamics as unknown as CharacterDynamic[];
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
        if (args.approvePlanning) {
          const approvalDb = openConfiguredDb();
          try {
            const approvalApp = createApp(approvalDb);
            const approved = approveOutlineDrafts(approvalDb, approvalApp, args.projectId);
            console.log(`\n✓ Outline 已批准：${approved} 章`);
          } finally {
            closeDb(approvalDb);
          }
        }
        console.log(`\n下一步：novel-eval write chapter ${args.projectId} --from 1 --to 3`);
        if (!args.approvePlanning) {
          console.log(`先批准蓝图：novel-eval write approve-planning ${args.projectId} --outlines`);
        }
        return;
      } catch (e) {
        console.error(`[API] 转发任务失败: ${(e as Error).message}，将降级为本地直接运行模式。`);
      }
    }

    const engine: AIAgentAdapter = createEngine(config.engine);
    const app = createApp(db);
    const { outlines, usage } = await app.generateBlueprint({
      engine, projectId: args.projectId,
      plot: plotArchitecture, characters, totalChapters,
      onProgress: (step, msg) => console.log(`  [${step}] ${msg}`),
    });

    updateProjectStatus(db, args.projectId, 'planning');
    if (args.approvePlanning && outlines.length > 0) {
      app.approveOutlines({
        projectId: projectId(args.projectId),
        from: 1,
        to: outlines.length,
      });
    }
    console.log(`\n✓ 章节蓝图 draft 生成完成${args.approvePlanning ? '并已批准' : ''}`);
    console.log(`  章节数：${outlines.length}`);
    console.log(`  费用：¥${usage.costRmb.toFixed(4)}`);
    const byAct = { 1: 0, 2: 0, 3: 0 };
    for (const o of outlines) byAct[o.act]++;
    console.log(`  分布：第一幕 ${byAct[1]} 章 / 第二幕 ${byAct[2]} 章 / 第三幕 ${byAct[3]} 章`);
    if (args.approvePlanning) {
      console.log(`\n下一步：novel-eval write chapter ${args.projectId} --from 1 --to 3`);
    } else {
      console.log(`\n下一步：novel-eval write approve-planning ${args.projectId} --outlines`);
    }
  } finally {
    closeDb(db);
  }
}

async function runChapter(args: ChapterArgs): Promise<void> {
  const config = loadWriterConfig(args.engine ? { engine: args.engine } : undefined);
  const db = openConfiguredDb();
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
    if (args.maxRevise !== undefined) {
      console.log(`  质量门槛：已启用（最多重写 ${args.maxRevise} 次）`);
    }
    console.log('');

    const serverActive = await isServerRunning();
    if (serverActive) {
      console.log(`[API] 探测到 Web 服务正在运行，将通过 Web 后端发起任务以保持进度同步...`);
      try {
        const jobId = await startApiJob(`/api/projects/${args.projectId}/chapters/generate`, {
          from,
          to,
          engineName: args.engine,
          wordCount,
          qualityGate: args.maxRevise !== undefined,
          maxRevise: args.maxRevise ?? 0,
        });
        await streamJobEvents(jobId);

        // Write human readable txt file after SSE done
        const dbTemp = openConfiguredDb();
        try {
          const results: { number: number; title: string; content: string }[] = [];
          for (let num = from; num <= to; num++) {
            const ch = getChapter(dbTemp, args.projectId, num);
            if (ch) results.push({ number: ch.number, title: ch.title || '', content: ch.content });
          }
          if (results.length > 0) {
            const { writeFileSync } = await import('node:fs');
            const { resolve } = await import('node:path');
            const outPath = resolve(dirname(configuredDatabasePath()), `${args.projectId}-ch${from}-${to}.txt`);
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
    const app = createApp(db);

    const { outcomes } = await app.generateChapterRange({
      projectId: projectId(args.projectId),
      from,
      to,
      engine,
      wordCount,
      engineName: config.engineName,
      model: config.engine.model,
      budget: args.maxRevise !== undefined
        ? { qualityGate: true, maxRevise: args.maxRevise }
        : {},
      onProgress: (step, msg) => console.log(`  [${step}] ${msg}`),
    });

    if (to >= outlineCount) {
      completeProjectIfFullyWritten(db, args.projectId);
    }

    const results: { number: number; title: string; content: string; wordCount: number }[] = [];
    for (let num = from; num <= to; num++) {
      const ch = getChapter(db, args.projectId, num);
      if (ch) results.push({ number: ch.number, title: ch.title, content: ch.content, wordCount: ch.wordCount });
    }
    const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
    console.log(`\n✓ 章节生成完成`);
    console.log(`  生成：${outcomes.length} 章 · ${totalWords} 字`);
    if (results.length > 0) {
      const { writeFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const outPath = resolve(dirname(configuredDatabasePath()), `${args.projectId}-ch${from}-${to}.txt`);
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
  const db = openConfiguredDb();
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
        const activeRes = await fetch(`${writerApiUrl()}/api/projects/${args.projectId}/active-job`);
        const { job } = await activeRes.json() as { job: { id: string; status: string } | null };
        let jobId: string;
        let fromBound: number, toBound: number;
        
        if (job && (job.status === 'paused' || job.status === 'running')) {
          console.log(`  检测到已有活跃任务 [${job.id}]，正在请求恢复...`);
          jobId = await startApiJob(`/api/projects/jobs/${job.id}/resume`, {
            engineName: args.engine,
            maxRevise: args.maxRevise,
          });
          const dbTemp = openConfiguredDb();
          try {
            toBound = countOutlines(dbTemp, args.projectId);
            const written = countChapters(dbTemp, args.projectId);
            fromBound = written + 1;
          } finally {
            closeDb(dbTemp);
          }
        } else {
          const dbTemp = openConfiguredDb();
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
            engineName: args.engine,
          });
        }
        
        await streamJobEvents(jobId);

        // Write human readable txt file after SSE done
        const dbTemp = openConfiguredDb();
        try {
          const results: { number: number; title: string; content: string }[] = [];
          for (let num = fromBound; num <= toBound; num++) {
            const ch = getChapter(dbTemp, args.projectId, num);
            if (ch) results.push({ number: ch.number, title: ch.title || '', content: ch.content });
          }
          if (results.length > 0) {
            const { writeFileSync } = await import('node:fs');
            const { resolve } = await import('node:path');
            const outPath = resolve(dirname(configuredDatabasePath()), `${args.projectId}-ch${fromBound}-${toBound}.txt`);
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
    const app = createApp(db);

    const to = countOutlines(db, args.projectId);
    const from = countChapters(db, args.projectId) + 1;

    if (from > to) {
      console.log(`\n✓ 全部 ${to} 章已完成，无需续写。`);
      if (project.status === 'writing') {
        updateProjectStatus(db, args.projectId, 'completed');
        console.log('  项目状态已更新为 completed。');
      }
      return;
    }

    const { getActiveJob, readJobResumeConfig } = await import('./job-store.ts');
    const persisted = getActiveJob(db, args.projectId);
    let resumeFrom = from;
    let resumeTo = to;
    let wordCount = config.generation.chapterWordCount;
    let engineName = config.engineName;
    let model = config.engine.model;
    let qualityProfile = 'default';
    let promptVersion = 'chapter-v1';
    let budget: import('./repositories/validation.ts').JsonValue = {};
    let resumeJobId: string | undefined;
    if (persisted && (persisted.status === 'paused' || persisted.status === 'running')) {
      const snapshot = readJobResumeConfig(db, persisted.id);
      resumeFrom = Math.max(from, snapshot.lastOutlinePosition + 1);
      resumeTo = snapshot.scope.to;
      if (resumeFrom > resumeTo) {
        console.log(`\n✓ 任务 ${persisted.id} 原范围 ${snapshot.scope.from}-${snapshot.scope.to} 已完成，无需续写。`);
        const { projectCompleted } = finalizeExhaustedResumeJob(db, {
          projectId: args.projectId,
          jobId: persisted.id,
        });
        if (projectCompleted) {
          console.log('  项目全部章节已写完，状态已更新为 completed。');
        }
        return;
      }
      wordCount = snapshot.wordCount || wordCount;
      engineName = snapshot.engine || engineName;
      model = snapshot.model || model;
      qualityProfile = snapshot.qualityProfile || qualityProfile;
      promptVersion = snapshot.promptVersion || promptVersion;
      budget = snapshot.budget;
      resumeJobId = persisted.id;
      console.log(`  恢复任务 ${persisted.id}：继续原始范围 ${snapshot.scope.from}-${snapshot.scope.to}`);
    }

    const resumeCount = resumeTo - resumeFrom + 1;
    console.log(`  续写范围：第 ${resumeFrom}-${resumeTo} 章（${resumeCount} 章待写，已完成章节自动跳过）`);
    console.log(`  每章约 ${wordCount} 字`);
    if (args.maxRevise !== undefined) {
      console.log('  提示：续写沿用原 job 预算快照；--max-revise 不会覆盖已保存的 qualityGate');
    }
    const resumeBudget = typeof budget === 'object' && budget !== null && !Array.isArray(budget)
      ? budget as Record<string, unknown>
      : {};
    if (resumeBudget.qualityGate === true) {
      console.log(`  质量门槛：沿用快照（maxRevise=${resumeBudget.maxRevise ?? 0}）`);
    }
    console.log('');

    updateProjectStatus(db, args.projectId, 'writing');
    const { outcomes } = await app.generateChapterRange({
      projectId: projectId(args.projectId),
      from: resumeJobId ? (readJobResumeConfig(db, resumeJobId).scope.from) : resumeFrom,
      to: resumeTo,
      resumeJobId,
      engine,
      wordCount,
      engineName,
      model,
      qualityProfile,
      promptVersion,
      budget,
      onProgress: (step, msg) => console.log(`  [${step}] ${msg}`),
    });

    if (resumeFrom + outcomes.length - 1 >= resumeTo) {
      completeProjectIfFullyWritten(db, args.projectId);
    }

    const results: { number: number; title: string; content: string; wordCount: number }[] = [];
    for (let num = resumeFrom; num <= resumeTo; num++) {
      const ch = getChapter(db, args.projectId, num);
      if (ch) results.push({ number: ch.number, title: ch.title, content: ch.content, wordCount: ch.wordCount });
    }
    const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
    console.log(`\n✓ 续写完成`);
    console.log(`  本次生成：${outcomes.length} 章 · ${totalWords} 字`);
    if (results.length > 0) {
      const { writeFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const outPath = resolve(dirname(configuredDatabasePath()), `${args.projectId}-ch${resumeFrom}-${resumeTo}.txt`);
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
  if (!args.approvePlanning) {
    console.error('错误：write auto 需要 --approve-planning，明确批准生成的 bible 和 outline draft 后再写章节。');
    process.exit(1);
  }

  const config = loadWriterConfig(args.engine ? { engine: args.engine } : undefined);
  const wordCount = args.wordCount ?? config.generation.chapterWordCount;
  console.log('Novel Writer — 全自动生成\n');
  console.log(`  书名：${args.title} · ${args.genre} · ${args.audience}`);
  console.log(`  主题：${args.topic}`);
  console.log(`  目标：${args.chapters} 章 · 每章约 ${wordCount} 字`);
  if (args.maxRevise !== undefined) {
    console.log(`  质量门槛：已启用（最多重写 ${args.maxRevise} 次）`);
  } else {
    console.log('  质量门槛：未启用');
  }
  console.log(`  引擎：${config.engineName}（${config.engine.model}）`);
  console.log('');

  if (!args.yes) {
    const ok = await confirmProceed(`将全自动生成（bible + 蓝图 + ${args.chapters} 章正文），预估 ¥${(args.chapters * 0.05).toFixed(1)}-${(args.chapters * 0.08).toFixed(1)}`);
    if (!ok) { console.log('已取消'); return; }
  }

  const db = openConfiguredDb();
  try {
    const engine: AIAgentAdapter = createEngine(config.engine);
    const app = createApp(db);
    const log = (step: string, msg: string) => console.log(`  [${step}] ${msg}`);

    console.log('\n── 阶段 1：bible 生成 ──');
    const project = createProject(db, { title: args.title, genreProfile: args.genre, targetAudience: args.audience, premise: args.topic });
    const { bible, bibleRevisionId, usage: bibleUsage } = await app.generateBible({
      engine, projectId: project.id, topic: args.topic, genre: args.genre, audience: args.audience, onProgress: log,
    });
    app.approveBibleRevision({ projectId: project.id, revisionId: bibleRevisionId });
    updateProjectStatus(db, project.id, 'planning');
    console.log(`✓ bible draft 完成并已批准（${bible.characterDynamics.length} 角色 / ${bible.plotArchitecture.foreshadows.length} 伏笔 / ¥${bibleUsage.costRmb.toFixed(4)}）`);

    console.log('\n── 阶段 2：章节蓝图 ──');
    const { outlines, usage: outlineUsage } = await app.generateBlueprint({
      engine, projectId: project.id, plot: bible.plotArchitecture, characters: bible.characterDynamics, totalChapters: args.chapters, onProgress: log,
    });
    if (outlines.length > 0) {
      app.approveOutlines({ projectId: project.id, from: 1, to: outlines.length });
    }
    updateProjectStatus(db, project.id, 'planning');
    console.log(`✓ 蓝图 draft 完成并已批准（${outlines.length} 章 / ¥${outlineUsage.costRmb.toFixed(4)}）`);

    console.log('\n── 阶段 3：章节生成 ──');
    updateProjectStatus(db, project.id, 'writing');
    if (args.maxRevise !== undefined) {
      console.log(`  质量门槛：已启用（最多重写 ${args.maxRevise} 次）`);
    }
    console.log(`  每章约 ${wordCount} 字`);
    const { outcomes } = await app.generateChapterRange({
      projectId: project.id,
      from: 1,
      to: outlines.length,
      engine,
      wordCount,
      engineName: config.engineName,
      model: config.engine.model,
      budget: args.maxRevise !== undefined
        ? { qualityGate: true, maxRevise: args.maxRevise }
        : {},
      onProgress: log,
    });
    updateProjectStatus(db, project.id, 'completed');

    const results: { number: number; title: string; content: string; wordCount: number }[] = [];
    for (let num = 1; num <= outlines.length; num++) {
      const ch = getChapter(db, project.id, num);
      if (ch) results.push({ number: ch.number, title: ch.title, content: ch.content, wordCount: ch.wordCount });
    }
    const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
    console.log(`\n✓ 全自动生成完成`);
    console.log(`  生成：${outcomes.length} 章 · ${totalWords} 字`);
    console.log(`  总费用：¥${(bibleUsage.costRmb + outlineUsage.costRmb).toFixed(4)}+`);
    console.log(`  项目 ID：${project.id}`);
    const { writeFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const outPath = resolve(dirname(configuredDatabasePath()), `${project.id}-full.txt`);
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
  if (args.command === 'approve-planning') { runApprovePlanning(args); return; }
  if (args.command === 'revision-tasks') { runRevisionTasks(args); return; }
  if (args.command === 'finalize-draft') { await runFinalizeDraft(args); return; }
  if (args.command === 'outline') { await runOutline(args); return; }
  if (args.command === 'chapter') { await runChapter(args); return; }
  if (args.command === 'resume') { await runResume(args); return; }
  if (args.command === 'auto') { await runAuto(args); return; }
  if (args.command === 'import-bible') { await runImportBible(args); return; }
  await runInit(args);
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((e) => {
    console.error('失败:', (e as Error).message);
    process.exit(1);
  });
}
