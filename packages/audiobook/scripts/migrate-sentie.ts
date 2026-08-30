/**
 * 一次性迁移（M0 P4）：把存量森铁产物登记进 registry + 缩略图入库。
 * 用法：pnpm --filter @novel-eval/audiobook exec tsx scripts/migrate-sentie.ts
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { openWriterDb, resolveProjectId } from '../src/db.ts';
import { loadRegistry, saveRegistry } from '../src/registry.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const db = openWriterDb(join(REPO, 'data/writer/writer.db'));
const pid = resolveProjectId(db, '最后一班森铁');
db.close();

const reg = loadRegistry(join(REPO, 'data/audiobook'));
reg[pid] = {
  outRoot: 'dist/audiobook-v4',
  scenesRoot: 'dist/audiobook-v3/scenes',
  presets: { engine: 'volcengine', chaptersPerEpisode: 3, skipVideo: false },
  episodes: { ep01: { ep: 1, chapters: [1, 3], createdAt: new Date().toISOString() } },
};
saveRegistry(join(REPO, 'data/audiobook'), reg);
console.log('森铁已登记:', pid, '→', reg[pid].outRoot);

// 缩略图：全局目录 → 本产物根 thumbs/（M0 阻断6：消灭跨书串台的命名空间）
const thumbsOut = join(REPO, 'dist/audiobook-v4/thumbs');
mkdirSync(thumbsOut, { recursive: true });
const srcDir = join(homedir(), 'Downloads/sentie-thumbnails');
let n = 0;
if (existsSync(srcDir)) {
  for (const f of readdirSync(srcDir)) {
    if (/^EP\d+[-_－].*\.(jpe?g|png)$/i.test(f)) {
      copyFileSync(join(srcDir, f), join(thumbsOut, f));
      n += 1;
    }
  }
}
console.log(`缩略图入库: ${n} 张 → dist/audiobook-v4/thumbs/`);
