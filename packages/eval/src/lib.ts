/**
 * @novel-eval/eval — 库入口（供 writer 等其他包程序化调用）
 *
 * CLI 入口在 src/index.ts（由根 package.json 的 eval script 直接跑）。
 * 本文件无 CLI 副作用，可安全 import。
 */
// 评估主流程
export { evaluate, type EvaluateOptions, type EvaluateResult } from './evaluator.ts';
// 内存版评估（writer 质量门槛用）
export { assessChapters, type AssessOptions, type AssessResult } from './assess.ts';
// 可独立调用的阶段函数
export { runMapPhase, type MapPhaseResult, type MapProgressCallback } from './map-phase.ts';
export { runReducePhase, type ReducePhaseResult, type ReduceProgressCallback, type ReduceMode } from './reduce-phase.ts';
// 配置 + 聚合
export { loadConfig, computeOverall, lookupGrade, type AppConfig } from './config.ts';
// 类型
export type {
  ChapterInput, MapChapterInput, MapChapterOutput, Chapter,
  DimensionKey, DimensionScore, Suggestion, Excerpt, RawExcerpt,
  EvaluationResult, EvaluationTask, EmotionalPoint,
  ProfileConfig, GradeThresholds,
} from './types.ts';
export { DIMENSION_KEYS, DIMENSION_LABELS } from './types.ts';
// Golden corpus
export { assertScoreBands } from './golden/assert-bands.ts';
export {
  loadCorpusRegistry,
  loadGoldenCases,
  resolveRepoRoot,
} from './golden/load-corpus.ts';
export { checkCase, sliceCase, selectChapters, formatSliceText } from './golden/slice.ts';
export {
  runGoldenCheck,
  runGoldenSlice,
  runGoldenEvaluate,
} from './golden/run-golden.ts';
export type {
  GoldenExpect,
  GoldenCaseMeta,
  BandAssertResult,
  CorpusRegistry,
  LoadedGoldenCase,
} from './golden/types.ts';
