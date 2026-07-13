/**
 * @novel-eval/writer — 库入口（供其他包/程序化调用）
 *
 * CLI 入口在 src/index.ts（由根 package.json 的 writer script 直接跑）。
 */
export { loadWriterConfig, type WriterConfig, type GenerationConfig } from './config.ts';
export { loadEnv } from './load-env.ts';
export { openDb, closeDb, writerDataDir, type DB } from './db.ts';
export {
  createProject, getProject, listProjects, updateProjectStatus,
  type Project, type ProjectStatus,
} from './project.ts';
export { generateBible, type GenerateBibleOptions, type GenerateBibleResult } from './bible/generator.ts';
export { generateBlueprint, type GenerateBlueprintOptions, type GenerateBlueprintResult } from './chapter/blueprint.ts';
export { generateChapter, generateRange, type GenerateChapterOptions, type GenerateChapterResult, type GenerateRangeOptions, type QualityGateConfig, type GenerationControl, JobPausedError, JobCancelledError } from './chapter/generator.ts';
export { finalizeChapter, type FinalizeOptions, type FinalizeResult } from './chapter/finalizer.ts';
export { ensureChapterConsistency, type ConsistencyResult } from './chapter/consistency.ts';
export { assessChapterQuality, type QualityGateResult } from './chapter/quality-gate.ts';
export { detectRepetition, type RepetitionReport } from './chapter/repetition.ts';
export { aggregateLessons, buildLessonPrompt, classifyChapter, type ChapterPattern } from './chapter/lesson-aggregator.ts';
// store 读写函数（Web 后端 + CLI 共用）
export {
  saveOutlines, getOutline, getAllOutlines, countOutlines, markOutlineWritten,
  saveChapter, getChapter, getRecentChapters, countChapters, deleteChapter,
  getNarrativeState, saveNarrativeState, getBibleForChapter, updateCharacterState,
  // M4：评估历史 + 经验学习
  saveEvalHistory, getEvalHistory, getAllEvalHistory, getChapterScores,
  getLessons, getLessonsByPattern, upsertLesson,
  type EvalHistoryRecord, type LessonLearned,
} from './chapter/store.ts';
// job 持久化（暂停/继续/取消的断点来源）
export {
  createJobRow, getJobRow, listJobsByProject, getActiveJob,
  updateJobStatus, updateJobProgress, recoverInterruptedJobs,
  type JobRow, type JobType, type JobStatus, type CreateJobRowOpts,
} from './job-store.ts';
export type { ChapterOutline, ChapterContent, NarrativeState, Beat, ArcSummary, OpenForeshadow } from './chapter/types.ts';
export type {
  Bible, CoreSeed, CharacterDynamic, CharacterDrives, CharacterArc,
  CharacterRelationship, CharacterState, CharacterStateEntry,
  WorldBuilding, WorldDimension, PlotArchitecture, PlotAct, Foreshadow,
} from './bible/types.ts';
