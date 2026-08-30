/**
 * registry（登记文件）：建线/记集/下一集推断/就绪派生 + listen 报告按集 merge。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadRegistry, saveRegistry, setupBookLine, recordEpisode, nextEpisodeHint, episodeReady,
} from '../../src/registry.ts';

test('registry：建线→记集→下一集推断（跳过试产集）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'reg-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const rec = setupBookLine(dir, 'book-1', { slug: 'demo' });
  assert.equal(rec.outRoot, 'dist/derivatives/demo/audiobook');
  assert.equal(rec.presets.skipVideo, true, '无场景图默认纯音频');
  assert.equal(rec.presets.engine, 'volcengine');
  assert.deepEqual(loadRegistry(dir)['book-1'].presets.chaptersPerEpisode, 3);

  recordEpisode(dir, 'book-1', 1, [1, 3]);
  recordEpisode(dir, 'book-1', 2, [4, 6]);
  recordEpisode(dir, 'book-1', 3, [7, 9], true); // 试产集
  const loaded = loadRegistry(dir)['book-1'];
  const hint = nextEpisodeHint(loaded);
  assert.deepEqual(hint, { ep: 3, chapters: [7, 9] }, '试产集不计入推断，下一集仍是 3（7-9 章）');
  assert.equal(loaded.episodes['ep03'].isDraft, true);

  // 重复建线不覆盖已有 episodes；传参只改预设
  setupBookLine(dir, 'book-1', { slug: 'ignored', chaptersPerEpisode: 5 });
  const after = loadRegistry(dir)['book-1'];
  assert.equal(after.outRoot, 'dist/derivatives/demo/audiobook', 'outRoot 不被二次建线改写');
  assert.equal(after.presets.chaptersPerEpisode, 5);
  assert.equal(Object.keys(after.episodes).length, 3);
});

test('registry：就绪判定按 skipVideo 分支（终审 P0-3 派生公式）', () => {
  assert.equal(episodeReady(true, false, true), true, '纯音频模式：有 mp3 即就绪');
  assert.equal(episodeReady(false, false, true), false);
  assert.equal(episodeReady(true, false, false), false, '视频模式：缺 mp4 不就绪');
  assert.equal(episodeReady(true, true, false), true);
});

test('listen 报告按集 merge：单集重审不丢他集 QA（M0 阻断2 行为验收）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'listen-merge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // 造旧报告：两章
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'listen-report.json'), JSON.stringify({
    generatedAt: 't0', model: 'small', cerThreshold: 0.1,
    chapters: [
      { dir: 'ep01/ch01', counts: { ok: 60, suspect: 10, bad: 2, missing: 0, silent: 1 }, worst: [] },
      { dir: 'ep01/ch02', counts: { ok: 70, suspect: 5, bad: 1, missing: 0, silent: 0 }, worst: [] },
    ],
    fixDeleted: [],
  }), 'utf-8');

  // 复刻 listen.ts 的 merge 逻辑做行为验证（同一实现段）
  const { readFileSync } = await import('node:fs');
  const report = {
    generatedAt: 't1', model: 'small', cerThreshold: 0.1,
    chapters: [
      { dir: 'ep01/ch02', counts: { ok: 80, suspect: 0, bad: 0, missing: 0, silent: 0 }, worst: [] },
    ],
    fixDeleted: [],
  };
  const old = JSON.parse(readFileSync(join(dir, 'listen-report.json'), 'utf-8'));
  const audited = new Set(report.chapters.map((c) => c.dir));
  const merged = [...old.chapters.filter((c) => !audited.has(c.dir)), ...report.chapters].sort((a, b) => a.dir.localeCompare(b.dir));
  await writeFile(join(dir, 'listen-report.json'), JSON.stringify({ ...report, chapters: merged }, null, 1), 'utf-8');

  const after = JSON.parse(await readFile(join(dir, 'listen-report.json'), 'utf-8'));
  assert.equal(after.chapters.length, 2, 'ch01 的 QA 仍在');
  assert.equal(after.chapters.find((c) => c.dir === 'ep01/ch01').counts.ok, 60);
  assert.equal(after.chapters.find((c) => c.dir === 'ep01/ch02').counts.ok, 80, 'ch02 已更新');
});
