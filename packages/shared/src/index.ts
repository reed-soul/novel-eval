/**
 * @novel-eval/shared — eval 和 writer 共用的基础设施
 *
 * 导出：引擎抽象、配置加载、分章器、文本定位、并发/计费工具、共享类型。
 */
// 引擎
export type { AIAgentAdapter, CallResult, RunOptions } from './engine/interface.ts';
export { AnthropicCompatAdapter } from './engine/anthropic-compat.ts';
export { BigModelAdapter } from './engine/bigmodel.ts';
export { DeepSeekAdapter } from './engine/deepseek.ts';
export { createEngine } from './engine/factory.ts';
export {
  CassetteAdapter,
  CassetteMissError,
  cassettePromptHash,
  type CassetteMode,
  type CassetteAdapterOptions,
  type CassetteEntry,
} from './engine/cassette.ts';
export {
  callWithValidation,
  validate,
  type ValidateResult,
  type FieldSpec,
  type SchemaSpec,
  type CallWithValidationOptions,
} from './engine/json-validator.ts';
export { parseJSONRobust } from './engine/json-util.ts';

// 配置
export { loadYaml, loadEngineConfig } from './config.ts';
export {
  resolveServicePort,
  resolveWriterApiUrl,
  type ServiceEndpointEnv,
} from './config/service-endpoints.ts';

// Prompt 加载
export { loadPrompt } from './prompts.ts';

// 分章
export {
  splitChapters,
  splitChaptersWithMeta,
  countChars,
  inferKind,
  type SplitResult,
} from './chapter/chapter-splitter.ts';
export { analyzeChapterRule, type ChapterRuleAnalysis } from './chapter/chapter-analyzer.ts';

// 文档解析
export { parseTxt, type ParsedDocument } from './parser/txt-parser.ts';

// 文本定位
export { locateTextInContent, type LocateResult, type MatchedBy } from './text/text-locator.ts';

// 并发与计费工具
export { mapWithConcurrency } from './concurrency.ts';
export { addUsage, zeroUsage } from './usage.ts';

// 共享类型
export type {
  TokenUsage,
  EngineConfig,
  EngineProvider,
  NovelMetadata,
  ChapterKind,
  ChapterInput,
  BaseChapter,
  CharacterProfile,
  CharacterRelationship,
} from './types.ts';

// HTTP / API DTOs
export type {
  ParseResult,
  EditChapterRequest,
  StoryStateDto,
  StoryStateDeltaDto,
  GenerateChaptersRequest,
  JobStatusResponse,
  JobStatusDto,
  JobTypeDto,
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
} from './dto/index.ts';
export {
  isRecord,
  fail,
  parseEditChapterRequest,
  parseGenerateChaptersRequest,
  parseJobStatusResponse,
  EVALUATION_DIMENSION_KEYS,
  EVALUATION_DIMENSION_LABELS,
  DEFAULT_COVERAGE_THRESHOLDS,
  isExcerptLinked,
  evaluationCoverageFor,
  parseEvaluationReportResponse,
  toEvaluationReportResponse,
  unwrapEvaluationPayload,
} from './dto/index.ts';
