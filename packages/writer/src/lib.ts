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
  InvalidPersistenceDataError,
  InvalidStoryStateDeltaError,
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
