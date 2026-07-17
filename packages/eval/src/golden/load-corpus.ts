/**
 * Load golden corpus registry and case metadata from the repo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import type {
  CorpusRegistry,
  GoldenCaseMeta,
  GoldenExpect,
  LoadedGoldenCase,
} from './types.ts';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export function resolveRepoRoot(fromCwd: string = process.cwd()): string {
  // Prefer cwd when corpus.json is reachable; otherwise walk up a few levels.
  let dir = resolve(fromCwd);
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, 'tests/golden/corpus.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(fromCwd);
}

export function loadCorpusRegistry(repoRoot: string): CorpusRegistry {
  const path = resolve(repoRoot, 'tests/golden/corpus.json');
  if (!existsSync(path)) {
    throw new Error(`corpus registry not found: ${path}`);
  }
  const registry = readJson<CorpusRegistry>(path);
  if (!registry.schemaVersion || !Array.isArray(registry.cases)) {
    throw new Error(`invalid corpus registry: ${path}`);
  }
  return registry;
}

export function loadGoldenCases(
  repoRoot: string,
  options: { caseIds?: string[] } = {},
): LoadedGoldenCase[] {
  const registry = loadCorpusRegistry(repoRoot);
  const wanted = options.caseIds?.length ? new Set(options.caseIds) : null;
  const loaded: LoadedGoldenCase[] = [];

  for (const ref of registry.cases) {
    if (wanted && !wanted.has(ref.id)) continue;
    const metaPath = resolve(repoRoot, ref.metaPath);
    const expectPath = resolve(repoRoot, ref.expectPath);
    const meta = readJson<GoldenCaseMeta>(metaPath);
    const expect = readJson<GoldenExpect>(expectPath);
    const absoluteSourcePath = isAbsolute(ref.sourcePath)
      ? ref.sourcePath
      : resolve(repoRoot, ref.sourcePath);
    loaded.push({ ref, meta, expect, absoluteSourcePath });
  }

  if (wanted && loaded.length !== wanted.size) {
    const found = new Set(loaded.map((c) => c.ref.id));
    const missing = [...wanted].filter((id) => !found.has(id));
    throw new Error(`unknown golden case id(s): ${missing.join(', ')}`);
  }

  return loaded;
}

export function sliceOutputPath(repoRoot: string, caseId: string): string {
  return resolve(repoRoot, 'tests/golden/slices', `${caseId}.txt`);
}

export function runSummaryPath(repoRoot: string, caseId: string): string {
  return resolve(repoRoot, 'tests/golden/runs', `${caseId}.summary.json`);
}

export function cassetteDirPath(repoRoot: string, caseId: string): string {
  return resolve(repoRoot, 'tests/golden/cassettes', caseId);
}
