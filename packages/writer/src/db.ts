/**
 * SQLite 数据层 — writer 项目持久化
 *
 * 单库设计：data/writer/writer.db 存所有项目（本地工具，几十本书无压力）。
 * 每个项目通过 project_id 外键关联 bible/章节/伏笔等表。
 * schema 随里程碑演进：M1 建 project + bible 表。
 *
 * better-sqlite3 是同步 API，适合本地 CLI/Web（无连接池开销）。
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export type DB = Database.Database;

/** writer 数据根目录（data/writer/，gitignore）*/
export function writerDataDir(): string {
  return resolve(process.cwd(), 'data', 'writer');
}

/**
 * 打开（或创建）全局 writer 数据库。
 * 单库存所有项目，避免「project id 还没生成就要建目录」的鸡生蛋问题。
 */
export function openDb(): DB {
  const dir = writerDataDir();
  mkdirSync(dir, { recursive: true });
  const db = new Database(resolve(dir, 'writer.db'));
  db.pragma('journal_mode = WAL');  // 写入并发友好
  migrate(db);
  return db;
}

/** 幂等 schema 迁移：建表（IF NOT EXISTS），随里程碑累积 */
function migrate(db: DB): void {
  // M1：项目 + bible
  db.exec(`
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      genre TEXT,
      audience TEXT,
      topic TEXT,
      status TEXT NOT NULL DEFAULT 'initialized',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bible (
      project_id TEXT PRIMARY KEY REFERENCES project(id),
      core_seed TEXT,
      character_dynamics TEXT,
      character_state TEXT,
      world_building TEXT,
      plot_architecture TEXT,
      full_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- M2：章节蓝图（每行一章）
    CREATE TABLE IF NOT EXISTS chapter_outline (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      number INTEGER NOT NULL,
      title TEXT,
      act INTEGER NOT NULL,
      beat TEXT,
      role TEXT,
      purpose TEXT,
      suspense_level INTEGER,
      foreshadowing TEXT,
      twist_level INTEGER,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, number)
    );

    -- M2：章节正文
    CREATE TABLE IF NOT EXISTS chapter (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      number INTEGER NOT NULL,
      outline_id TEXT REFERENCES chapter_outline(id),
      title TEXT,
      content TEXT NOT NULL,
      word_count INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, number)
    );

    -- M2：叙事状态（滚动摘要 + 伏笔追踪，每项目一行）
    CREATE TABLE IF NOT EXISTS narrative_state (
      project_id TEXT PRIMARY KEY REFERENCES project(id),
      macro_summary TEXT,
      open_foreshadows TEXT,
      arc_summaries TEXT,
      up_to_chapter INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    -- M3：作业表（暂停/继续/取消的断点来源；内存 job 重启即失，DB job 是真相）
    CREATE TABLE IF NOT EXISTS job (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      type TEXT NOT NULL,              -- 'bible' | 'outline' | 'chapter'
      status TEXT NOT NULL,            -- 'running' | 'paused' | 'done' | 'error' | 'cancelled'
      from_chapter INTEGER,            -- chapter 类型的起点
      to_chapter INTEGER,              -- chapter 类型的终点
      last_chapter INTEGER NOT NULL DEFAULT 0,  -- 已完成的最后一章（暂停/中断断点）
      quality_gate INTEGER NOT NULL DEFAULT 0,  -- 0/1
      max_revise INTEGER NOT NULL DEFAULT 0,
      result TEXT,                     -- JSON 字符串
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_project ON job(project_id);

    -- M4：评估历史（每次质量门槛评估都记一行，含 pass/revise/block 所有轮次）
    CREATE TABLE IF NOT EXISTS eval_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      chapter_number INTEGER NOT NULL,
      attempt INTEGER NOT NULL,           -- 第几次尝试（1=初稿，2+=重写）
      verdict TEXT NOT NULL,              -- pass/revise/block
      total_score INTEGER,
      grade TEXT,
      dimensions TEXT,                    -- JSON: {storyStructure:{score,analysis},...}
      suggestions TEXT,                   -- JSON: [{dimension,content},...]
      repetition TEXT,                    -- JSON: {within,cross,hotspots}
      model TEXT,                         -- 写作+评估用的模型
      evaluator_model TEXT,               -- 交叉评估时的评估模型（NULL=自评）
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eval_project ON eval_history(project_id);
    CREATE INDEX IF NOT EXISTS idx_eval_chapter ON eval_history(project_id, chapter_number);

    -- M4：经验学习表（从 eval_history 聚合出的模式）
    CREATE TABLE IF NOT EXISTS lesson_learned (
      id TEXT PRIMARY KEY,
      project_id TEXT,                    -- NULL = 全局经验
      pattern TEXT NOT NULL,              -- 如 "开篇章" / "高潮章"
      dimension TEXT,                     -- 如 "marketPotential"
      avg_score REAL,
      common_issues TEXT,                 -- JSON: 高频低分原因列表
      effective_fixes TEXT,               -- JSON: 重写后提升最大的改进
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lesson_project ON lesson_learned(project_id);
    CREATE INDEX IF NOT EXISTS idx_lesson_pattern ON lesson_learned(pattern);

    -- M5：修正草稿（经验驱动局部修正，采纳前原章不动）
    CREATE TABLE IF NOT EXISTS correction_draft (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      chapter_number INTEGER NOT NULL,
      strategy TEXT NOT NULL,          -- 'surgical' | 'rewrite'
      original_content TEXT NOT NULL,
      revised_content TEXT NOT NULL,
      original_score INTEGER,
      revised_score INTEGER,
      issues_json TEXT,                -- JSON: 诊断出的问题清单
      changes_json TEXT,               -- JSON: 模型标注的改动点（surgical 才有）
      revised_result_json TEXT,        -- JSON: 修正后的评估与重复率报告 (M5)
      status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'adopted' | 'discarded'
      engine TEXT,
      job_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_draft_chapter ON correction_draft(project_id, chapter_number);
  `);

  // 动态追加 M5 修正草稿所需的新增列（revised_result_json）
  try {
    db.prepare('SELECT revised_result_json FROM correction_draft LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE correction_draft ADD COLUMN revised_result_json TEXT');
  }
}

/** 关闭数据库（测试与 CLI 退出时调用，防句柄泄漏）*/
export function closeDb(db: DB): void {
  try { db.close(); } catch { /* 已关闭 */ }
}
