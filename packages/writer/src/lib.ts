/**
 * @novel-eval/writer — 库入口（供其他包/程序化调用）
 *
 * CLI 入口在 src/index.ts（由根 package.json 的 writer script 直接跑）。
 */
export { loadWriterConfig, type WriterConfig, type GenerationConfig } from './config.ts';
export { loadEnv } from './load-env.ts';
export { openDb, closeDb, type DB } from './db.ts';
export {
  createProject, getProject, listProjects, updateProjectStatus,
  type Project, type ProjectStatus,
} from './project.ts';
export {
  chapterId,
  chapterRevisionId,
  characterId,
  foreshadowId,
  outlineId,
  projectId,
  storyStateRevisionId,
  type ChapterId,
  type ChapterRevisionId,
  type CharacterId,
  type ForeshadowId,
  type OutlineId,
  type ProjectId,
  type StoryStateRevisionId,
} from './domain/ids.ts';
export {
  ValidationError,
  EvaluationIncompleteError,
  InvalidPersistenceDataError,
  InvalidStoryStateDeltaError,
  ProjectLeaseConflictError,
  StaleDependencyError,
  StateExtractionError,
  BudgetExceededError,
} from './domain/errors.ts';
export { applyStoryStateDelta } from './domain/story-state.ts';
export type {
  Chapter,
  ChapterCandidate,
  ChapterRevision,
  ChapterRevisionSource,
  ChapterRevisionStatus,
  CharacterChange,
  CharacterPatch,
  CharacterState,
  CharacterStatus,
  FactChange,
  ForeshadowChange,
  ForeshadowState,
  OpenForeshadow,
  ResolvedForeshadow,
  SaveChapterCandidateInput,
  StoryFact,
  StoryState,
  StoryStateDelta,
  TimelineEvent,
} from './chapter/types.ts';
export type {
  Bible,
  CharacterDynamic,
  CharacterState as BibleCharacterState,
  PlotArchitecture,
} from './bible/types.ts';
export type { GenerateBibleResult } from './bible/generator.ts';
export type { GenerateBlueprintResult } from './chapter/blueprint.ts';
export {
  createJobRow,
  getJobRow,
  getActiveJob,
  listJobsByProject,
  updateJobStatus,
  updateJobProgress,
  updateJobUsage,
  recoverInterruptedJobs,
  readJobResumeConfig,
  appendJobEvent,
  listJobEventsAfter,
  getLatestJobEventSeq,
  type JobType,
  type JobStatus,
  type JobRow,
  type JobScope,
  type JobResumeConfig,
  type CreateJobRowOpts,
  type JobEventRow,
  type AppendJobEventInput,
} from './job-store.ts';
export {
  WriterApplication,
  type WriterApplicationOptions,
  type GenerateChapterRangeInput,
  type GenerateChapterRangeResult,
  type GenerateBibleAppInput,
  type GenerateBlueprintAppInput,
  type ImportBibleAppInput,
  type PublishChapterEditInput,
  type RebuildStoryStateInput,
  type AdoptCorrectionDraftInput,
} from './services/writer-application.ts';
export type { StaleImpact, PublishResult } from './services/chapter-publication-service.ts';
export type { RebuildResult } from './services/state-rebuild-service.ts';
export { ChapterRepository } from './repositories/chapter-repository.ts';
export { PlanningRepository } from './repositories/planning-repository.ts';
export { StoryStateRepository } from './repositories/story-state-repository.ts';
export type { JsonValue } from './repositories/validation.ts';
export {
  ProjectWriteLeaseRepository,
  type ProjectWriteLease,
} from './repositories/lease-repository.ts';
export {
  getBibleForChapter,
  getOutline,
  getAllOutlines,
  countOutlines,
  getChapter,
  countChapters,
  getRecentChapters,
  getNarrativeState,
  // Removed mutation paths — exported only so callers fail loudly instead of silently no-oping.
  markOutlineWritten,
  saveChapter,
  deleteChapter,
  saveOutlines,
  saveNarrativeState,
  updateCharacterState,
  getChapterScores,
  getEvalHistory,
  getAllEvalHistory,
  getLessons,
  getPendingDraft,
  getDraft,
  saveCorrectionDraft,
  updateDraftStatus,
  type CorrectionStrategy,
  type CorrectionDraft,
  type EvalHistoryRecord,
  type LessonLearned,
} from './chapter/store.ts';
export {
  correctChapter,
  applyCorrectionDraft,
  discardCorrectionDraft,
  diagnoseChapter,
  type ApplyCorrectionDraftResult,
} from './chapter/corrector.ts';
export {
  JobPausedError,
  JobCancelledError,
} from './chapter/generator.ts';
export {
  completeProjectIfFullyWritten,
  finalizeExhaustedResumeJob,
  isProjectFullyWritten,
} from './project-completion.ts';
