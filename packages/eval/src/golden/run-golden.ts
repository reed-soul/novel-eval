/**
 * Orchestrate golden check / slice / evaluate / assert.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluate } from '../evaluator.ts';
import { assertScoreBands } from './assert-bands.ts';
import { loadGoldenCases, resolveRepoRoot, runSummaryPath, sliceOutputPath } from './load-corpus.ts';
import { checkCase, sliceCase } from './slice.ts';
import type { CheckReport, LoadedGoldenCase, SliceReport } from './types.ts';

export interface GoldenRunOptions {
  repoRoot?: string;
  caseIds?: string[];
  dryRun?: boolean;
  forceAssert?: boolean;
  yes?: boolean;
  onLog?: (msg: string) => void;
}

export interface GoldenCaseRunResult {
  caseId: string;
  check?: CheckReport;
  slice?: SliceReport;
  evaluated?: boolean;
  assertOk?: boolean;
  assertSkipped?: boolean;
  violations?: string[];
  error?: string;
  totalScore?: number;
  grade?: string;
}

export interface GoldenCommandResult {
  ok: boolean;
  results: GoldenCaseRunResult[];
}

function log(opts: GoldenRunOptions, msg: string): void {
  opts.onLog?.(msg);
}

export function runGoldenCheck(options: GoldenRunOptions = {}): GoldenCommandResult {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const cases = loadGoldenCases(repoRoot, { caseIds: options.caseIds });
  const results: GoldenCaseRunResult[] = [];
  let ok = true;

  for (const loaded of cases) {
    const check = checkCase(loaded);
    if (!check.ok) ok = false;
    log(
      options,
      check.ok
        ? `✓ ${check.caseId}: ${check.chapterCount} chapters, ${check.charCount} chars (${check.strategy}/${check.confidence})`
        : `✗ ${check.caseId}: ${check.error}`,
    );
    results.push({ caseId: loaded.ref.id, check });
  }

  return { ok, results };
}

export function runGoldenSlice(options: GoldenRunOptions = {}): GoldenCommandResult {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const cases = loadGoldenCases(repoRoot, { caseIds: options.caseIds });
  const results: GoldenCaseRunResult[] = [];
  let ok = true;

  for (const loaded of cases) {
    try {
      const slice = sliceCase(repoRoot, loaded);
      log(
        options,
        `✓ slice ${slice.caseId}: ${slice.chapterCount} chapters → ${slice.outPath}`,
      );
      results.push({ caseId: loaded.ref.id, slice });
    } catch (e) {
      ok = false;
      const error = (e as Error).message;
      log(options, `✗ slice ${loaded.ref.id}: ${error}`);
      results.push({ caseId: loaded.ref.id, error });
    }
  }

  return { ok, results };
}

async function evaluateLoaded(
  repoRoot: string,
  loaded: LoadedGoldenCase,
  options: GoldenRunOptions,
): Promise<GoldenCaseRunResult> {
  const slice = sliceCase(repoRoot, loaded);
  const slicePath = sliceOutputPath(repoRoot, loaded.ref.id);

  const { task, result } = await evaluate({
    filePath: slicePath,
    profile: loaded.meta.profile,
    title: loaded.meta.title,
    author: loaded.meta.author,
    metadata: {
      genre: loaded.meta.genre,
      targetAudience: loaded.meta.audience,
    },
    onProgress: (msg) => log(options, `  [${loaded.ref.id}] ${msg}`),
  });

  const assertResult = assertScoreBands(result, loaded.expect, {
    forceAssert: options.forceAssert,
  });

  const summaryPath = runSummaryPath(repoRoot, loaded.ref.id);
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        caseId: loaded.ref.id,
        taskId: task.id,
        totalScore: result.overall.totalScore,
        grade: result.overall.grade,
        dimensions: Object.fromEntries(
          Object.entries(result.dimensions).map(([k, v]) => [k, v.score]),
        ),
        costRmb: task.cost.totalRmb,
        assert: assertResult,
        expectStatus: loaded.expect.status,
        slice,
      },
      null,
      2,
    ),
    'utf-8',
  );

  return {
    caseId: loaded.ref.id,
    slice,
    evaluated: true,
    assertOk: assertResult.ok,
    assertSkipped: assertResult.skipped,
    violations: assertResult.violations.map((v) => v.message),
    totalScore: result.overall.totalScore,
    grade: result.overall.grade,
    error: assertResult.ok ? undefined : assertResult.violations.map((v) => v.message).join('; '),
  };
}

export async function runGoldenEvaluate(
  options: GoldenRunOptions = {},
): Promise<GoldenCommandResult> {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const cases = loadGoldenCases(repoRoot, { caseIds: options.caseIds });
  const results: GoldenCaseRunResult[] = [];
  let ok = true;

  if (options.dryRun) {
    const check = runGoldenCheck(options);
    const slice = runGoldenSlice(options);
    return { ok: check.ok && slice.ok, results: [...check.results, ...slice.results] };
  }

  for (const loaded of cases) {
    try {
      log(options, `→ evaluate ${loaded.ref.id} (${loaded.expect.status})`);
      const one = await evaluateLoaded(repoRoot, loaded, options);
      if (one.error) ok = false;
      if (one.assertOk === false) ok = false;
      log(
        options,
        one.assertSkipped
          ? `✓ ${one.caseId}: score ${one.totalScore} (${one.grade}) — assert skipped (${loaded.expect.status})`
          : one.assertOk
            ? `✓ ${one.caseId}: score ${one.totalScore} (${one.grade}) — bands ok`
            : `✗ ${one.caseId}: ${one.error}`,
      );
      results.push(one);
    } catch (e) {
      ok = false;
      const error = (e as Error).message;
      log(options, `✗ ${loaded.ref.id}: ${error}`);
      results.push({ caseId: loaded.ref.id, error });
    }
  }

  return { ok, results };
}
