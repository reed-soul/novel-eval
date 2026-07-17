/**
 * Map domain / unexpected errors to a stable HTTP payload.
 *
 * Returns { status, code, message } — never leaks internal stack details for unknowns.
 */
import {
  ValidationError,
  ProjectLeaseConflictError,
  StaleDependencyError,
  BudgetExceededError,
  EvaluationIncompleteError,
  ChapterQualityRejectedError,
} from '@novel-eval/writer';

export interface HttpErrorBody {
  status: number;
  code: string;
  message: string;
}

function errorName(error: unknown): string | undefined {
  if (error instanceof Error && typeof error.name === 'string') return error.name;
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

export function toHttpError(error: unknown): HttpErrorBody {
  if (error instanceof ValidationError || errorName(error) === 'ValidationError') {
    return { status: 400, code: 'ValidationError', message: errorMessage(error) };
  }
  if (
    error instanceof ProjectLeaseConflictError
    || errorName(error) === 'ProjectLeaseConflictError'
  ) {
    return {
      status: 409,
      code: 'ProjectLeaseConflictError',
      message: errorMessage(error),
    };
  }
  if (error instanceof StaleDependencyError || errorName(error) === 'StaleDependencyError') {
    return {
      status: 409,
      code: 'StaleDependencyError',
      message: errorMessage(error),
    };
  }
  if (error instanceof BudgetExceededError || errorName(error) === 'BudgetExceededError') {
    return {
      status: 402,
      code: 'BudgetExceededError',
      message: errorMessage(error),
    };
  }
  if (
    error instanceof EvaluationIncompleteError
    || errorName(error) === 'EvaluationIncompleteError'
  ) {
    return {
      status: 422,
      code: 'EvaluationIncompleteError',
      message: errorMessage(error),
    };
  }
  if (
    error instanceof ChapterQualityRejectedError
    || errorName(error) === 'ChapterQualityRejectedError'
  ) {
    return {
      status: 422,
      code: 'ChapterQualityRejectedError',
      message: errorMessage(error),
    };
  }

  return {
    status: 500,
    code: 'InternalError',
    message: 'Internal server error',
  };
}

/** JSON body shape returned to clients (includes legacy `error` alias). */
export function httpErrorJson(mapped: HttpErrorBody): {
  code: string;
  message: string;
  error: string;
} {
  return {
    code: mapped.code,
    message: mapped.message,
    error: mapped.message,
  };
}
