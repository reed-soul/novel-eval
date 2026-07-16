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
  EvaluationDimensionDto,
  EvaluationNovelDto,
  EvaluationOverallDto,
  EvaluationEmotionalPointDto,
  EvaluationSuggestionDto,
  EvaluationMarketBenchmarkDto,
  EvaluationMarketComparableDto,
} from './evaluation.ts';
export {
  parseEvaluationReportResponse,
  toEvaluationReportResponse,
  unwrapEvaluationPayload,
} from './evaluation.ts';
