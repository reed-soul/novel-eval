/** Shared parse result — validators never throw; callers map failures to domain errors. */
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function fail(message: string): ParseResult<never> {
  return { ok: false, message };
}
