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
