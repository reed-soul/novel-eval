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
