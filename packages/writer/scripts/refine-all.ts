/**
 * 批量精修全书：逐章消除中英夹杂（只改语言层，不改情节）。
 * 跳过已精修的章节（检测英文词数已达标则跳过），支持断点续跑。
 *
 * 用法：nohup pnpm exec tsx packages/writer/scripts/refine-all.ts > /tmp/refine.log 2>&1 &
 */
import { createEngine, type AIAgentAdapter } from '@novel-eval/shared';
import { loadWriterConfig } from '../src/config.ts';
import { loadEnv } from '../src/load-env.ts';
import { getChapter, saveChapter, countChapters } from '../src/chapter/store.ts';
import { openDb, closeDb, type DB } from '../src/db.ts';

loadEnv();
const PID = '790d8aaf-6278-475e-a270-fddc91c89250';
const EN_THRESHOLD = 5; // 英文词数 ≤ 此值视为已达标，跳过
const WHITELIST = new Set(['DNA', 'RNA', 'ACAS', 'BBB', 'DF-7', 'OBSERVED', 'MULTIPLE', 'SUBJECT', 'SYSTEMS', 'REMAIN', 'ACTIVE', 'OUTPUT']);

const SYSTEM = `你是中文小说语言编辑。你的任务是消除稿件中的中英夹杂，把英文术语、战术通讯、系统日志、技术操作改为自然流畅的中文表达。

【铁律——违反则失败】
1. 情节、事件顺序、人物行为、对话的含义——一字不改。
2. 数字、日期、剂量、坐标、参数值——一字不改。
3. 人名（林昭/沈河/陆知行/周予安/灰隼等）、地名、机构名（玄构/织巢/弥散）——不改。
4. 只改"语言表达方式"，不改"故事内容"。

【改写规则——必须执行，不要偷懒保留英文】
- 英文战术通讯（如 "grid sector seven, phase four, target exited"）→ 中文（"七号网格区域，第四阶段，目标已脱离"）。
- 英文系统日志/UI/代码输出（如 RAID rebuilding / STATUS: ACTIVE / OUTPUT NOT TERMINATED / Core / MKEAVSP / mesh）→ 全部中文化（"磁盘阵列重建中""状态：运行中""输出未终止""核心""监控协议""网络"）。
  唯一例外：全书结尾（第110章）织巢的最后一条信息 OBSERVED/MULTIPLE/SUBJECT SYSTEMS/OUTPUT HAS NOT TERMINATED，保留英文并紧跟中文翻译，作为"机器语言"的异质感。其余所有英文日志一律译为中文。
- 散落在中文叙述里的英文单词（logo/Core/Excel/mesh/cloud/json/xlsx等）→ 改为中文（标识/核心/表格/网格/云端/数据文件）。
- 英文技术术语（reward hacking/sensor spoofing/RAID/SRAM）→ 首次出现用"中文（英文原词）"，后续用中文。
- 产品名（万宝龙/飞利浦/iPad）若有常用中文名则用中文名，否则保留。

【科学缩写白名单——仅这几个保留不译】
DNA RNA ACAS BBB DF-7
（仅这 5 个，其余英文一律翻译）

输出要求：直接输出改写后的完整章节正文（含标题行"第X章 标题"）。不要解释、不要加批注。务必切实改写，不要原样保留英文。`;

function countEnWords(text: string): number {
  const words = text.match(/\b[a-zA-Z]{4,}\b/g) || [];
  return words.filter(w => !WHITELIST.has(w.toUpperCase())).length;
}

async function refineOne(engine: AIAgentAdapter, db: DB, num: number): Promise<{ ok: boolean; enBefore: number; enAfter: number; cost: number; }> {
  const ch = getChapter(db, PID, num);
  if (!ch) return { ok: false, enBefore: 0, enAfter: 0, cost: 0 };
  const enBefore = countEnWords(ch.content);
  if (enBefore <= EN_THRESHOLD) {
    console.log(`  第${num}章《${ch.title}》英文词${enBefore}≤${EN_THRESHOLD}，跳过`);
    return { ok: true, enBefore, enAfter: enBefore, cost: 0 };
  }
  const input = `第${num}章 ${ch.title}\n\n${ch.content}`;
  const res = await engine.run(input, {
    systemPrompt: SYSTEM, temperature: 0.3, maxTokens: 16000, timeoutMs: 300000,
  });
  let refined = res.text.trim();
  const lines = refined.split('\n');
  if (lines[0]?.startsWith(`第${num}章`)) refined = lines.slice(2).join('\n').trim();
  const enAfter = countEnWords(refined);
  saveChapter(db, PID, num, { title: ch.title, content: refined, wordCount: refined.length });
  return { ok: true, enBefore, enAfter, cost: res.usage.costRmb };
}

const config = loadWriterConfig();
const engine = createEngine(config.engine);
const db = openDb();
try {
  const total = countChapters(db, PID);
  console.log(`批量精修开始：共 ${total} 章，引擎 ${config.engineName}，英文词阈值 ${EN_THRESHOLD}\n`);
  let totalCost = 0, refined = 0, skipped = 0, failed = 0;
  for (let num = 1; num <= total; num++) {
    try {
      const r = await refineOne(engine, db, num);
      totalCost += r.cost;
      if (r.cost > 0) { refined++; console.log(`  ✓ 第${num}章 英文词 ${r.enBefore}→${r.enAfter}（¥${r.cost.toFixed(4)}）`); }
      else skipped++;
    } catch (e) {
      failed++; console.log(`  ✗ 第${num}章 失败：${(e as Error).message.slice(0, 80)}（继续下一章）`);
    }
  }
  console.log(`\n✓ 批量精修完成：精修 ${refined} 章，跳过 ${skipped} 章，失败 ${failed} 章，费用 ¥${totalCost.toFixed(2)}`);
} finally {
  closeDb(db);
}
