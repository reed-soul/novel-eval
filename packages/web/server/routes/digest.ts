/**
 * digest 路由 — 精简短篇（第二真衍生形态，M2）
 *
 *   GET  /api/digest/books/:bookId          状态：登记预设 + 条目列表
 *   GET  /api/digest/books/:bookId/piece/:pid  条目正文（markdown）
 *   POST /api/digest/books/:bookId/jobs     生成短篇 { chapters, title, targetWords?, style? }
 *   GET  /api/digest/jobs/:jobId            任务进度（进程内直跑，轮询制）
 *
 * 任务模型：digest 是分钟级 LLM 作业，走进程内 condense（不复制 audiobook 的
 * spawn/SSE 机械）；单书同时只跑一个任务。
 */
import { Hono } from 'hono';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProject, type DB } from '@novel-eval/writer';
import { createEngine, loadEngineConfig, type AIAgentAdapter } from '@novel-eval/shared';
import {
  loadDigestRegistry, setupDigestLine, recordPiece, nextPieceId,
  openWriterDb, resolveProjectId, loadChapters, condenseChapters,
  type DigestStyle, type DigestPiece,
} from '@novel-eval/digest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DATA_DIR = join(REPO_ROOT, 'data');
// routes → 上 3 级 = packages → shared/config（engines.yml 实际位置）
const SHARED_CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'shared', 'config');

interface DigestJob {
  id: string;
  bookId: string;
  status: 'running' | 'completed' | 'failed';
  phase: string;
  error?: string;
  pieceId?: string;
  startedAt: number;
}

function safeName(title: string): string {
  return title.replace(/[^\p{Script=Han}A-Za-z0-9_-]/gu, '').slice(0, 40);
}

export function digestRoutes(db: DB) {
  const app = new Hono();
  const jobs = new Map<string, DigestJob>();
  const jobsByBook = new Map<string, string>();

  const title = (bookId: string): string | null => {
    const p = getProject(db, bookId);
    return p ? p.title : null;
  };

  app.get('/books/:bookId', (c) => {
    const bookId = c.req.param('bookId');
    const t = title(bookId);
    if (!t) return c.json({ error: '未知书' }, 404);
    const rec = loadDigestRegistry(DATA_DIR)[bookId];
    const pieces: DigestPiece[] = rec ? Object.values(rec.pieces).sort((a, b) => a.id.localeCompare(b.id)) : [];
    return c.json({
      registered: !!rec,
      bookId,
      title: t,
      presets: rec?.presets ?? null,
      pieces,
    });
  });

  app.get('/books/:bookId/piece/:pid', (c) => {
    const bookId = c.req.param('bookId');
    const pid = c.req.param('pid');
    const rec = loadDigestRegistry(DATA_DIR)[bookId];
    const piece = rec?.pieces[pid];
    if (!piece) return c.json({ error: '条目不存在' }, 404);
    const abs = resolve(REPO_ROOT, piece.file);
    if (!abs.startsWith(REPO_ROOT + sep) || !existsSync(abs)) return c.json({ error: '产物文件缺失' }, 404);
    return c.json({ id: piece.id, title: piece.title, markdown: readFileSync(abs, 'utf-8') });
  });

  app.post('/books/:bookId/jobs', async (c) => {
    const bookId = c.req.param('bookId');
    const t = title(bookId);
    if (!t) return c.json({ error: '未知书' }, 404);
    const running = jobsByBook.get(bookId);
    if (running && jobs.get(running)?.status === 'running') return c.json({ error: '该书已有短篇任务在进行' }, 409);

    const body = await c.req.json<{ chapters?: string; title?: string; targetWords?: number; style?: string }>().catch(() => ({}) as never);
    const chaptersRange = String(body.chapters ?? '').trim();
    if (!/^(\d{1,2})(-\d{1,2})?$/.test(chaptersRange)) return c.json({ error: '章节范围需形如 3 或 3-9' }, 422);
    const pieceTitle = String(body.title ?? '').trim().slice(0, 40);
    if (!pieceTitle) return c.json({ error: '请给短篇一个标题' }, 422);
    const style: DigestStyle = body.style === 'hook' ? 'hook' : 'faithful';
    const targetWords = Math.min(Math.max(Number(body.targetWords ?? 3000) || 3000, 500), 20000);

    const jobId = `dg-${Date.now().toString(36)}`;
    const job: DigestJob = { id: jobId, bookId, status: 'running', phase: '准备章节', startedAt: Date.now() };
    jobs.set(jobId, job);
    jobsByBook.set(bookId, jobId);

    void (async () => {
      const ro = openWriterDb();
      try {
        const bookIdInner = resolveProjectId(ro, bookId);
        const chapters = loadChapters(ro, bookIdInner, chaptersRange);
        job.phase = `浓缩中（0/${chapters.length} 章）`;
        const rec0 = loadDigestRegistry(DATA_DIR)[bookId];
        const rec = setupDigestLine(DATA_DIR, bookId, { slug: safeName(t ?? bookId), ...(rec0 ? {} : { style, targetWords }) });
        const outRoot = resolve(REPO_ROOT, rec.outRoot);
        if (!outRoot.startsWith(REPO_ROOT + sep)) throw new Error('产物根越界');
        await mkdir(outRoot, { recursive: true });

        const { engine, engines } = loadEngineConfig(SHARED_CONFIG_DIR);
        const llm: AIAgentAdapter = createEngine(engine ?? Object.values(engines)[0]);

        const pieceId = nextPieceId(rec);
        const result = await condenseChapters(chapters, {
          title: pieceTitle, targetWords, style,
          cacheFile: join(outRoot, '.condense-cache.json'),
          onProgress: (phase, done, total) => {
            job.phase = phase === 'map' ? `浓缩中（${done}/${total} 章）` : '合成终稿';
          },
        }, llm);

        const file = join(outRoot, `${pieceId}-${safeName(pieceTitle)}.md`);
        await writeFile(file, `# ${pieceTitle}\n\n${result.markdown.replace(/^《.+?》\s*\n+/, '')}\n`, 'utf-8');
        recordPiece(DATA_DIR, bookId, {
          id: pieceId, title: pieceTitle,
          chapters: [chapters[0].position, chapters[chapters.length - 1].position],
          targetWords, style,
          file: `${rec.outRoot}/${pieceId}-${safeName(pieceTitle)}.md`,
          words: result.words,
          createdAt: new Date().toISOString(),
        });
        job.status = 'completed';
        job.phase = `完成：${result.words} 字（LLM ${result.llmCalls} 次调用）`;
        job.pieceId = pieceId;
      } catch (e) {
        job.status = 'failed';
        job.error = (e as Error).message.slice(0, 300);
      } finally {
        ro.close();
      }
    })();

    return c.json({ jobId, bookId }, 201);
  });

  app.get('/jobs/:jobId', (c) => {
    const job = jobs.get(c.req.param('jobId'));
    if (!job) return c.json({ error: '任务不存在' }, 404);
    return c.json({ ...job, elapsedSec: Math.round((Date.now() - job.startedAt) / 1000) });
  });

  return app;
}
