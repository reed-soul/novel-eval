/**
 * digest CLI：writer.db 章节 → LLM 浓缩 → 精简短篇（第二真衍生形态）。
 *
 * 用法示例：
 *   pnpm digest build --project 物业管家不想破案 --chapters 1-9 --title 七楼坠落 --target-words 3000
 *   pnpm digest build --project X --chapters 4-6 --style hook            # 引流向
 *
 * 安全约束与 audiobook CLI 同款：argv 入口净化，产物一律落在仓库根内。
 */
import { resolve, sep } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, loadEngineConfig, type AIAgentAdapter } from '@novel-eval/shared';
import { loadEnv } from '@novel-eval/writer';
import { openWriterDb, resolveProjectId, projectTitle, loadChapters } from './db.ts';
import { condenseChapters, type DigestStyle } from './condense.ts';
import { loadDigestRegistry, setupDigestLine, recordPiece, nextPieceId } from './registry.ts';

const REPO_ROOT = process.cwd();
const DATA_DIR = join(REPO_ROOT, 'data');
// engines.yml 实际位置：packages/shared/config（不是仓库根 shared/）
const SHARED_CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'config');

function safeName(title: string): string {
  const cleaned = title.replace(/[^\p{Script=Han}A-Za-z0-9_-]/gu, '').slice(0, 40);
  if (!cleaned) throw new Error(`标题无法用作文件名：${JSON.stringify(title.slice(0, 40))}`);
  return cleaned;
}

async function defaultEngine(engineName?: string): Promise<AIAgentAdapter> {
  const { engine, engines } = loadEngineConfig(SHARED_CONFIG_DIR);
  const cfg = engineName ? engines[engineName] : engine;
  if (!cfg) throw new Error(`未知引擎：${engineName}`);
  return createEngine(cfg);
}

async function main(): Promise<void> {
  loadEnv(); // 与应用同源：~/.claude/settings.json env 段（API key 等）
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const raw: Record<string, string> = {};
  let i = 1;
  const next = (): string => {
    const v = argv[i + 1] ?? '';
    if (v.startsWith('--')) throw new Error(`参数 ${argv[i]} 缺值`);
    i += 2;
    return v;
  };
  while (i < argv.length) {
    switch (argv[i]) {
      case '--project': raw.project = next(); break;
      case '--chapters': raw.chapters = next(); break;
      case '--title': raw.title = next(); break;
      case '--target-words': raw.targetWords = next(); break;
      case '--style': raw.style = next(); break;
      case '--db': raw.db = next(); break;
      case '--engine': raw.engine = next(); break;
      default: throw new Error(`未知参数：${argv[i]}`);
    }
  }
  if (!raw.project) throw new Error('用法：pnpm digest build --project <书名或ID> --chapters 1-9 --title <标题> [--target-words 3000] [--style faithful|hook]');

  if (cmd === 'build') {
    const t0 = Date.now();
    const db = openWriterDb(raw.db ? resolve(REPO_ROOT, raw.db) : undefined);
    try {
      const bookId = resolveProjectId(db, raw.project);
      const bookTitle = projectTitle(db, bookId) ?? raw.project;
      const chapters = loadChapters(db, bookId, raw.chapters);
      const title = raw.title ?? `精简版 第${chapters[0].position}-${chapters[chapters.length - 1].position}章`;
      const style: DigestStyle = raw.style === 'hook' ? 'hook' : 'faithful';
      const targetWords = Math.min(Math.max(Number(raw.targetWords ?? 3000) || 3000, 500), 20000);

      // slug 用书名（与 audiobook 线同 slug 共享 derivatives/<slug>/）
      const rec0 = loadDigestRegistry(DATA_DIR)[bookId];
      const rec = setupDigestLine(DATA_DIR, bookId, {
        slug: safeName(bookTitle),
        ...(rec0 ? {} : { style, targetWords }),
      });
      const outRoot = resolve(REPO_ROOT, rec.outRoot);
      if (!outRoot.startsWith(REPO_ROOT + sep)) throw new Error('产物根越界');
      await mkdir(outRoot, { recursive: true });

      const pieceId = nextPieceId(rec);
      console.log(`▶ digest ${pieceId}｜《${title}》第 ${chapters[0].position}-${chapters[chapters.length - 1].position} 章（${chapters.length} 章）→ 约 ${targetWords} 字｜风格 ${style}`);

      const engine = await defaultEngine(raw.engine);
      const result = await condenseChapters(chapters, {
        title, targetWords, style,
        cacheFile: join(outRoot, '.condense-cache.json'),
        onProgress: (phase, done, total) => {
          if (phase === 'map') console.log(`  [map] ${done}/${total} 章浓缩完成`);
        },
      }, engine);

      const file = join(outRoot, `${pieceId}-${safeName(title)}.md`);
      await writeFile(file, `# ${title}\n\n${result.markdown.replace(/^《.+?》\s*\n+/, '')}\n`, 'utf-8');

      recordPiece(DATA_DIR, bookId, {
        id: pieceId, title, chapters: [chapters[0].position, chapters[chapters.length - 1].position],
        targetWords, style,
        file: `${rec.outRoot}/${pieceId}-${safeName(title)}.md`,
        words: result.words,
        createdAt: new Date().toISOString(),
      });

      console.log(`▶ 完成：${file}｜成稿 ${result.words} 字｜LLM 调用 ${result.llmCalls} 次｜用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } finally {
      db.close();
    }
  } else {
    throw new Error(`未知命令：${cmd ?? '(空)'}（目前支持 build）`);
  }
}

main().catch((e: unknown) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
