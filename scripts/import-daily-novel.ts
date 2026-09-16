/**
 * 每日小说导入 — research/daily-novels/<dir> 的 markdown 成书导入 writer.db，Web 书架即可见。
 *
 * 背景：每日小说定时任务按安全边界只落盘 markdown（不碰 writer.db），
 * Web 书架只读 writer.db——本脚本补上「文件 → 库」这一步。
 *
 * 用法: npx tsx scripts/import-daily-novel.ts --dir research/daily-novels/2026-09-15-mama-touqi-zhuanzhang [--db data/writer/writer.db]
 *
 * 走正规链路（对齐 writer 仓储层语义）：project(completed) → chapter_outline(written)
 * → chapter + chapter_revision(source='import', draft→published) → active_revision_id 回填。
 * 幂等：同书名已存在直接拒绝（不静默重建）。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../packages/writer/src/lib.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const next = process.argv[i + 1];
  return next !== undefined && !next.startsWith('--') ? next : def;
}

const dirArg = arg('dir');
if (!dirArg) {
  console.error('用法：npx tsx scripts/import-daily-novel.ts --dir research/daily-novels/<日期-书名> [--db data/writer/writer.db]');
  process.exit(1);
}
const novelDir = resolve(REPO_ROOT, dirArg);
if (!existsSync(novelDir)) throw new Error(`目录不存在：${novelDir}`);

// ── meta.md 解析（书名/类型/一句话；缺失时兜底） ──
const metaPath = resolve(novelDir, 'meta.md');
const meta = existsSync(metaPath) ? readFileSync(metaPath, 'utf-8') : '';
const pick = (re: RegExp, fb: string): string => {
  const m = meta.match(re);
  return m ? m[1].trim() : fb;
};
const title = pick(/\*\*书名\*\*：(?:《)?([^《》\n]+)(?:》)?/, basename(novelDir).replace(/^\d{4}-\d{2}-\d{2}-/, ''));
const genreProfile = pick(/\*\*类型\*\*：([^\n]+)/, '都市悬疑').split(/[·\s]/)[0] || '都市悬疑';
const premise = pick(/\*\*一句话\*\*：([^\n]+)/, '每日小说定时任务产物，见 research/daily-novels/ 内 outline.md。');

// ── 章节文件：第NN章-标题.md（位置=NN，标题去掉文件名前缀；正文剥掉首行 markdown 标题） ──
const msDir = resolve(novelDir, 'manuscript');
if (!existsSync(msDir)) throw new Error(`manuscript/ 不存在：${msDir}`);
const chapterFiles = readdirSync(msDir)
  .map((f) => {
    const m = f.match(/^第(\d{1,3})章(?:[-－—](.*))?\.md$/);
    return m ? { file: resolve(msDir, f), pos: Number(m[1]), title: (m[2] ?? '').trim() } : null;
  })
  .filter((x): x is { file: string; pos: number; title: string } => !!x)
  .sort((a, b) => a.pos - b.pos);
if (chapterFiles.length === 0) throw new Error('manuscript/ 内无「第NN章-标题.md」文件');

const dbPath = resolve(REPO_ROOT, arg('db', 'data/writer/writer.db'));
if (!existsSync(dbPath)) throw new Error(`writer.db 不存在：${dbPath}`);
const db = openDb({ path: dbPath });

const existing = db.prepare('SELECT id FROM project WHERE title = ?').get(title) as { id: string } | undefined;
if (existing) {
  console.error(`《${title}》已在库中（project ${existing.id}），不重复导入。`);
  process.exit(2);
}

const now = new Date().toISOString();
const projectId = randomUUID();

const run = db.transaction(() => {
  db.prepare(`
    INSERT INTO project (id, title, genre_profile, target_audience, premise, status, target_platform, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'completed', 'general', ?, ?)
  `).run(projectId, title, genreProfile, '通用', premise, now, now);

  let totalChars = 0;
  for (const ch of chapterFiles) {
    const raw = readFileSync(ch.file, 'utf-8');
    const content = raw.replace(/^#[^\n]*\n+/, '').trim();   // 剥首行「# 第NN章 …」标题
    const chapterTitle = ch.title || `第${ch.pos}章`;
    const outlineId = randomUUID();
    const chapterId = randomUUID();
    const revisionId = randomUUID();

    db.prepare(`
      INSERT INTO chapter_outline (id, project_id, position, status, created_at, updated_at)
      VALUES (?, ?, ?, 'written', ?, ?)
    `).run(outlineId, projectId, ch.pos, now, now);
    // outline revision 必须有：getAllOutlines 是 INNER JOIN active_revision_id，
    // 缺了整本书在 Web 章节列表里会整行消失（summary/beats 为必填字段）
    const outlineRevId = randomUUID();
    const firstSentence = (content.match(/[^。！？\n]+[。！？]/) ?? [content.slice(0, 80)])[0];
    db.prepare(`
      INSERT INTO chapter_outline_revision (id, outline_id, revision_number, status, title, content_json, created_at)
      VALUES (?, ?, 1, 'approved', ?, ?, ?)
    `).run(outlineRevId, outlineId, chapterTitle, JSON.stringify({
      summary: `【导入】${firstSentence}`,
      beats: [chapterTitle],
    }), now);
    db.prepare(`UPDATE chapter_outline SET active_revision_id = ? WHERE id = ?`).run(outlineRevId, outlineId);
    db.prepare(`
      INSERT INTO chapter (id, project_id, outline_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(chapterId, projectId, outlineId, now);
    db.prepare(`
      INSERT INTO chapter_revision (
        id, chapter_id, revision_number, source, parent_revision_id, title, content,
        word_count, status, generation_run_id, created_at
      ) VALUES (?, ?, 1, 'import', NULL, ?, ?, ?, 'draft', NULL, ?)
    `).run(revisionId, chapterId, chapterTitle, content, [...content].length, now);
    // 发布：draft → published，并把章与大纲的激活指向该版本（对齐 ChapterRepository.publishRevision）
    const pub = db.prepare(`UPDATE chapter_revision SET status = 'published' WHERE id = ? AND status = 'draft'`).run(revisionId);
    if (pub.changes !== 1) throw new Error(`${chapterTitle} 发布失败`);
    db.prepare(`UPDATE chapter SET active_revision_id = ? WHERE id = ?`).run(revisionId, chapterId);

    totalChars += [...content].length;
    console.log(`  第${String(ch.pos).padStart(2, '0')}章 ${chapterTitle} · ${[...content].length} 字`);
  }
  return totalChars;
});

const totalChars = run();
console.log(`\n✅ 《${title}》已导入：project ${projectId} · ${chapterFiles.length} 章 · 共 ${totalChars} 字 · 状态 completed`);
console.log('   Web 书架刷新即可见（dev 模式确认后端 4000 在跑；直连模式 pnpm web 即可）。');
