/**
 * HTTP error mapper — domain errors → stable { status, code, message }
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  ProjectLeaseConflictError,
  StaleDependencyError,
  BudgetExceededError,
  EvaluationIncompleteError,
} from '@novel-eval/writer';
import { toHttpError } from '../../server/middleware/error-mapper.ts';

describe('toHttpError', () => {
  it('maps ValidationError to 400', () => {
    const mapped = toHttpError(new ValidationError('bad body'));
    assert.equal(mapped.status, 400);
    assert.equal(mapped.code, 'ValidationError');
    assert.equal(mapped.message, 'bad body');
  });

  it('maps ProjectLeaseConflictError to 409', () => {
    const mapped = toHttpError(new ProjectLeaseConflictError());
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, 'ProjectLeaseConflictError');
  });

  it('maps StaleDependencyError to 409', () => {
    const mapped = toHttpError(new StaleDependencyError('stale outline'));
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, 'StaleDependencyError');
  });

  it('maps BudgetExceededError with stable code', () => {
    const mapped = toHttpError(new BudgetExceededError(1.5, 1));
    assert.equal(mapped.code, 'BudgetExceededError');
    assert.ok(mapped.status === 402 || mapped.status === 409);
  });

  it('maps EvaluationIncompleteError to 422', () => {
    const mapped = toHttpError(new EvaluationIncompleteError('missing dims'));
    assert.equal(mapped.status, 422);
    assert.equal(mapped.code, 'EvaluationIncompleteError');
  });

  it('maps unknown errors to 500 with opaque message', () => {
    const mapped = toHttpError(new Error('secret internal detail'));
    assert.equal(mapped.status, 500);
    assert.equal(mapped.code, 'InternalError');
    assert.notEqual(mapped.message, 'secret internal detail');
  });
});
