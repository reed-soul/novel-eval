/**
 * golden set 生成器：从 writer.db 取真实章节，按生产同款路径
 * （发音表 → annotate）产出期望片段，冻结进 tests/golden/*.json。
 *
 * ⚠ 更新流程：改画本规则后重跑本脚本 → 人工抽验归属正确性
 * （对照原文读「有归属对白」清单）→ 才允许提交新 golden。
 * 这就是「AI 提置信度、人守语义」的质量闸。
 *
 * 用法：pnpm --filter @novel-eval/audiobook exec tsx tests/golden/gen.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWriterDb, resolveProjectId, loadChapters } from '../../src/db.ts';
import { annotateChapter, applyPron, DEFAULT_VOICE_CONFIG, type VoiceConfig } from '../../src/annotate.ts';
import { loadProjectConfig } from '../../src/project-config.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const db = openWriterDb(resolve(REPO, 'data/writer/writer.db'));
const pid = resolveProjectId(db, '最后一班森铁');
const { title } = db.prepare('SELECT title FROM project WHERE id = ?').get(pid) as { title: string };
const { config } = loadProjectConfig({ dataDir: resolve(REPO, 'data/audiobook'), projectId: pid, title });

// golden 自带 cfg（cast/班底），不随 data 配置漂移——回归测的是切分/归属规则
const cfg: VoiceConfig = {
  ...DEFAULT_VOICE_CONFIG,
  cast: config.cast,
  voiceBySpeaker: config.voiceBySpeaker,
};

for (const pos of [1, 3]) {
  const ch = loadChapters(db, pid, String(pos))[0];
  const content = applyPron(ch.content, config.pron ?? []).text;
  const speakTitle = applyPron(ch.title, config.pron ?? []).text;
  const segs = annotateChapter(ch.position, speakTitle, content, cfg);
  const out = {
    note: 'golden：更新前必须人工抽验归属（见 gen.ts 头注释）',
    position: ch.position,
    title: speakTitle,
    content,
    cfg: { cast: cfg.cast, voiceBySpeaker: cfg.voiceBySpeaker },
    expected: segs.map((s) => ({ kind: s.kind, speaker: s.speaker, text: s.text })),
  };
  const file = resolve(dirname(fileURLToPath(import.meta.url)), `sentie-ch${String(pos).padStart(2, '0')}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 1), 'utf-8');
  console.log(`ch${pos}: ${segs.length} 段 → ${file.split('/').pop()}`);
}
db.close();
