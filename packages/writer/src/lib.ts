/**
 * @novel-eval/writer — 库入口（供其他包/程序化调用）
 *
 * CLI 入口在 src/index.ts（由根 package.json 的 writer script 直接跑）。
 */
export { loadWriterConfig, type WriterConfig, type GenerationConfig } from './config.ts';
export { openDb, closeDb, writerDataDir, type DB } from './db.ts';
export {
  createProject, getProject, listProjects, updateProjectStatus,
  type Project, type ProjectStatus,
} from './project.ts';
export { generateBible, type GenerateBibleOptions, type GenerateBibleResult } from './bible/generator.ts';
export { generateBlueprint, type GenerateBlueprintOptions, type GenerateBlueprintResult } from './chapter/blueprint.ts';
export { generateChapter, generateRange, type GenerateChapterOptions, type GenerateChapterResult } from './chapter/generator.ts';
export { finalizeChapter, type FinalizeOptions, type FinalizeResult } from './chapter/finalizer.ts';
export type { ChapterOutline, ChapterContent, NarrativeState, Beat, ArcSummary, OpenForeshadow } from './chapter/types.ts';
export type {
  Bible, CoreSeed, CharacterDynamic, CharacterDrives, CharacterArc,
  CharacterRelationship, CharacterState, CharacterStateEntry,
  WorldBuilding, WorldDimension, PlotArchitecture, PlotAct, Foreshadow,
} from './bible/types.ts';
