/**
 * Pure score-band assertions for golden corpus regression.
 */
import { DIMENSION_KEYS, type DimensionKey, type EvaluationResult } from '../types.ts';
import type { BandAssertResult, BandViolation, GoldenExpect, ScoreBand } from './types.ts';

function formatBand(band: ScoreBand): string {
  const lo = band.min === null || band.min === undefined ? '-∞' : String(band.min);
  const hi = band.max === null || band.max === undefined ? '+∞' : String(band.max);
  return `[${lo}, ${hi}]`;
}

function bandActive(band: ScoreBand | undefined): band is ScoreBand {
  if (!band) return false;
  return band.min !== null || band.max !== null;
}

function checkBand(
  field: string,
  actual: number,
  band: ScoreBand,
  violations: BandViolation[],
): void {
  if (band.min !== null && actual < band.min) {
    violations.push({
      field,
      actual,
      expected: formatBand(band),
      message: `${field}=${actual} below min ${band.min}`,
    });
  }
  if (band.max !== null && actual > band.max) {
    violations.push({
      field,
      actual,
      expected: formatBand(band),
      message: `${field}=${actual} above max ${band.max}`,
    });
  }
}

/**
 * Assert evaluation scores against golden expect bands.
 *
 * - `pending_annotation` → skipped (ok=true) unless `forceAssert`.
 * - `null` band edges are ignored.
 */
export function assertScoreBands(
  result: Pick<EvaluationResult, 'overall' | 'dimensions'>,
  expect: GoldenExpect,
  options: { forceAssert?: boolean } = {},
): BandAssertResult {
  if (expect.status !== 'active' && !options.forceAssert) {
    return { ok: true, skipped: true, violations: [] };
  }

  const violations: BandViolation[] = [];

  if (bandActive(expect.overall)) {
    checkBand('overall.totalScore', result.overall.totalScore, expect.overall, violations);
  }

  if (expect.gradeAllowlist.length > 0 && !expect.gradeAllowlist.includes(result.overall.grade)) {
    violations.push({
      field: 'overall.grade',
      actual: result.overall.grade,
      expected: expect.gradeAllowlist.join('|'),
      message: `grade ${result.overall.grade} not in allowlist`,
    });
  }

  for (const key of DIMENSION_KEYS) {
    const band = expect.dimensions[key as DimensionKey];
    if (!bandActive(band)) continue;
    const dim = result.dimensions[key as DimensionKey];
    if (!dim) {
      violations.push({
        field: `dimensions.${key}`,
        actual: 'missing',
        expected: formatBand(band),
        message: `missing dimension ${key}`,
      });
      continue;
    }
    checkBand(`dimensions.${key}.score`, dim.score, band, violations);
  }

  return { ok: violations.length === 0, skipped: false, violations };
}
