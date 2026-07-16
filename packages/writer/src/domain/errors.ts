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
