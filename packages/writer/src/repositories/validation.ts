import { InvalidPersistenceDataError } from '../domain/errors.ts';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function persistedRecord(value: unknown, entity: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidPersistenceDataError(entity, 'expected an object');
  }
  return value;
}

export function stringField(
  row: Record<string, unknown>,
  field: string,
  entity: string,
): string {
  const value = row[field];
  if (typeof value !== 'string') {
    throw new InvalidPersistenceDataError(entity, `${field} must be a string`);
  }
  return value;
}

export function nullableStringField(
  row: Record<string, unknown>,
  field: string,
  entity: string,
): string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new InvalidPersistenceDataError(entity, `${field} must be a string or null`);
  }
  return value;
}

export function numberField(
  row: Record<string, unknown>,
  field: string,
  entity: string,
): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidPersistenceDataError(entity, `${field} must be a number`);
  }
  return value;
}

export function parseJson(text: string, entity: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'invalid JSON';
    throw new InvalidPersistenceDataError(entity, detail);
  }
}

export function parseJsonValue(value: unknown, entity: string): JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => parseJsonValue(item, entity));
  }
  const record = persistedRecord(value, entity);
  const result: { [key: string]: JsonValue } = {};
  for (const [key, item] of Object.entries(record)) {
    result[key] = parseJsonValue(item, entity);
  }
  return result;
}

export function parseJsonObject(text: string, entity: string): { [key: string]: JsonValue } {
  const parsed = parseJsonValue(parseJson(text, entity), entity);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidPersistenceDataError(entity, 'expected a JSON object');
  }
  return parsed;
}

export function oneOf<const Values extends readonly string[]>(
  value: string,
  values: Values,
  entity: string,
): Values[number] {
  if (!values.some((candidate) => candidate === value)) {
    throw new InvalidPersistenceDataError(entity, `unsupported value: ${value}`);
  }
  return value as Values[number];
}
