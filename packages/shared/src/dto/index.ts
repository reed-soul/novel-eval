export type { ParseResult } from './parse.ts';
export { isRecord, fail } from './parse.ts';

export type {
  EditChapterRequest,
  StoryStateDto,
  StoryStateDeltaDto,
} from './edit.ts';
export { parseEditChapterRequest } from './edit.ts';

export type { GenerateChaptersRequest } from './generate.ts';
export { parseGenerateChaptersRequest } from './generate.ts';

export type {
  JobStatusResponse,
  JobStatusDto,
  JobTypeDto,
} from './jobs.ts';
export { parseJobStatusResponse } from './jobs.ts';

export type {
  EvaluationReportResponse,
  EvaluationDimensionKey,
  EvaluationDimensionDto,
  EvaluationNovelDto,
  EvaluationOverallDto,
  EvaluationEmotionalPointDto,
  EvaluationSuggestionDto,
  EvaluationExcerptDto,
  EvaluationCoverageDto,
  EvaluationCoverageInput,
  CoverageThresholds,
  EvaluationMarketBenchmarkDto,
  EvaluationMarketComparableDto,
  EvaluationPlatformGateDto,
  EvaluationPlatformGateCheckDto,
} from './evaluation.ts';
export {
  EVALUATION_DIMENSION_KEYS,
  EVALUATION_DIMENSION_LABELS,
  DEFAULT_COVERAGE_THRESHOLDS,
  isExcerptLinked,
  evaluationCoverageFor,
  parseEvaluationReportResponse,
  toEvaluationReportResponse,
  unwrapEvaluationPayload,
} from './evaluation.ts';

export type {
  BeatKind,
  ShotKind,
  NarrationQuote,
  NarrationSentence,
  BeatVisual,
  NarrationBeat,
  NarrationSequence,
  NarrationAct,
  CharacterRef,
  NarrationScript,
  StructureGateReport,
  CausalGateReport,
} from './narration.ts';
export { flattenSentences, flattenBeats, scriptTotalChars } from './narration.ts';
