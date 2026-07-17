export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class EvaluationIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationIncompleteError';
  }
}

export class InvalidStoryStateDeltaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStoryStateDeltaError';
  }
}

export class InvalidPersistenceDataError extends Error {
  constructor(entity: string, detail: string) {
    super(`Invalid persisted ${entity}: ${detail}`);
    this.name = 'InvalidPersistenceDataError';
  }
}

export class ProjectLeaseConflictError extends Error {
  constructor() {
    super('The project write lease is held by another owner');
    this.name = 'ProjectLeaseConflictError';
  }
}

export class StaleDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleDependencyError';
  }
}

export class StateExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateExtractionError';
  }
}

export class BudgetExceededError extends Error {
  readonly cumulativeCostRmb: number;
  readonly maxCostRmb: number;

  constructor(cumulativeCostRmb: number, maxCostRmb: number) {
    super(
      `Generation budget exceeded: cumulative ¥${cumulativeCostRmb.toFixed(4)} > max ¥${maxCostRmb.toFixed(4)}`,
    );
    this.name = 'BudgetExceededError';
    this.cumulativeCostRmb = cumulativeCostRmb;
    this.maxCostRmb = maxCostRmb;
  }
}

export class ChapterQualityRejectedError extends Error {
  readonly outlinePosition: number;
  readonly verdict: 'reject' | 'revise';
  readonly reasons: string[];
  readonly score?: number;
  readonly grade?: string;

  constructor(input: {
    outlinePosition: number;
    verdict: 'reject' | 'revise';
    reasons: string[];
    score?: number;
    grade?: string;
  }) {
    const detail = input.reasons.join('；') || input.verdict;
    super(`Chapter ${input.outlinePosition} rejected by quality reviewer: ${detail}`);
    this.name = 'ChapterQualityRejectedError';
    this.outlinePosition = input.outlinePosition;
    this.verdict = input.verdict;
    this.reasons = input.reasons;
    this.score = input.score;
    this.grade = input.grade;
  }
}
