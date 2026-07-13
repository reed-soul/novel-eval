/**
 * 交叉评估脚本 — 用 DeepSeek 评估器重新评价 GLM 版章节
 *
 * 消除自评偏好：GLM 版写作+评估都是 GLM，这里换 DeepSeek 做评估器。
 * 抽样 10 章代表性章节（开头/转折/高潮/结局），逐章评估。
 *
 * 用法: npx tsx scripts/cross-eval.ts
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, openDb } from '../packages/writer/src/lib.ts';
import { createEngine, type EngineConfig, type ChapterInput } from '../packages/shared/src/index.ts';
import { assessChapters } from '../packages/eval/src/lib.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_CONFIG_DIR = resolve(__dirname, '..', 'packages', 'shared', 'config');

loadEnv();
const db: unknown = openDb();

// GLM 版项目 ID
const GLM_PID = 'aeb8689c-4831-4b8b-bb72-0616c85df0e9';

// 抽样章节：覆盖各幕的关键节点
const SAMPLE_CHAPTERS = [1, 5, 10, 15, 25, 40, 54, 60, 70, 80];

// DeepSeek 评估引擎
const deepseekConfig: EngineConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/anthropic',
  model: 'deepseek-v4-pro',
  maxBudgetRmb: 20,
  perChapterMaxBudgetRmb: 0.5,
};

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  交叉评估：DeepSeek 评估器 → GLM 版章节');
  console.log('═══════════════════════════════════════════════\n');

  const engine = createEngine(deepseekConfig);
  const available = await engine.isAvailable();
  if (!available) {
    console.error('DeepSeek 引擎不可用，请检查 DEEPSEEK_API_KEY');
    process.exit(1);
  }
  console.log('DeepSeek 引擎就绪 ✓\n');

  // 从 DB 加载抽样章节
  const dbAny = db as { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] }; close: () => void };
  const rows = dbAny.prepare(
    `SELECT number, title, content, word_count FROM chapter WHERE project_id = ? AND number IN (${SAMPLE_CHAPTERS.map(() => '?').join(',')}) ORDER BY number`,
  ).all(GLM_PID, ...SAMPLE_CHAPTERS) as Array<{ number: number; title: string; content: string; word_count: number }>;

  console.log(`抽样 ${rows.length} 章：${rows.map(r => r.number).join(', ')}\n`);

  const results: Array<{ chapter: number; title: string; dsScore: number; dsGrade: string; dimensions: Record<string, number> }> = [];

  for (const row of rows) {
    const chapterInput: ChapterInput[] = [{
      id: `ch${String(row.number).padStart(3, '0')}`,
      title: row.title,
      content: row.content,
    }];

    process.stdout.write(`第 ${row.number} 章《${row.title}》评估中...`);

    try {
      const result = await assessChapters({
        engine,
        chapters: chapterInput,
        metadata: { genre: '古代悬疑·美食', targetAudience: '青年男性·番茄小说读者' },
        onProgress: () => {},
      });

      const dims: Record<string, number> = {};
      for (const [k, v] of Object.entries(result.dimensions)) {
        dims[k] = v.score;
      }

      results.push({
        chapter: row.number,
        title: row.title,
        dsScore: result.totalScore,
        dsGrade: result.grade,
        dimensions: dims,
      });

      process.stdout.write(` ${result.totalScore}（${result.grade}）\n`);
    } catch (e) {
      process.stdout.write(` 评估失败：${(e as Error).message.slice(0, 100)}\n`);
    }
  }

  // 汇总
  console.log('\n═══════════════════════════════════════════════');
  console.log('  交叉评估结果');
  console.log('═══════════════════════════════════════════════\n');

  console.log('章节  | DeepSeek评估分 | 等级 | 结构 | 人物 | 文笔 | 情感 | 市场');
  console.log('─────|──────────────|──────|──────|──────|──────|──────|──────');

  for (const r of results) {
    const d = r.dimensions;
    console.log(
      `  ${String(r.chapter).padStart(3)}  |    ${String(r.dsScore).padStart(3)}        |  ${r.dsGrade}   | ` +
      `${String(d.storyStructure ?? 0).padStart(3)}  | ${String(d.characterization ?? 0).padStart(3)}  | ${String(d.writingQuality ?? 0).padStart(3)}  | ${String(d.emotionalResonance ?? 0).padStart(3)}  | ${String(d.marketPotential ?? 0).padStart(3)}`,
    );
  }

  const avgScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.dsScore, 0) / results.length)
    : 0;
  const aCount = results.filter(r => r.dsGrade === 'A' || r.dsGrade === 'S').length;
  const bCount = results.filter(r => r.dsGrade === 'B').length;

  console.log(`\n━━━ 汇总 ━━━`);
  console.log(`抽样章节: ${results.length} 章`);
  console.log(`平均分: ${avgScore}`);
  console.log(`A级: ${aCount} 章 | B级: ${bCount} 章`);
  console.log(`\n（对比：GLM 自评平均约 82 分，A 级约 90%）`);

  dbAny.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
