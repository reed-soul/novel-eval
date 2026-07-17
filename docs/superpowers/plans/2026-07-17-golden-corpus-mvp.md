# Golden Corpus MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a commit-safe golden corpus harness: registry, chapter slicing, score-band assertions, and `pnpm golden` CLI — without committing copyrighted full novels.

**Architecture:** Corpus metadata lives in `tests/golden/` (git). Full texts stay under gitignored `data/novels/`. Eval package gains a pure `assert-bands` module plus a `golden` CLI that checks sources, writes local slices, optionally runs `evaluate`, and asserts active expectations.

**Tech Stack:** TypeScript, existing `@novel-eval/shared` chapter splitter, `@novel-eval/eval` evaluate/compare, `tsx`, Node test runner.

## Global Constraints

- Do not commit files under `data/novels/` or generated `tests/golden/slices/` / `tests/golden/runs/`.
- Do not invent authoritative human scores; new expects start as `pending_annotation`.
- Default CI/unit path must not call live LLM APIs.
- Prefer early return; no `any`; reuse `DimensionKey` / `EvaluationResult` types from eval.

---

### Task 1: Corpus registry and case stubs

**Files:**
- Create: `tests/golden/README.md`
- Create: `tests/golden/corpus.json`
- Create: `tests/golden/cases/*/meta.json` and `expect.json` for 7 cases
- Modify: `.gitignore` — ignore `tests/golden/slices/` and `tests/golden/runs/`

**Interfaces:**
- Produces: corpus registry schema `schemaVersion: "1.0.0"`; each case `id`, `sourcePath`, `metaPath`, `expectPath`

- [ ] **Step 1:** Add gitignore entries and README explaining local novel paths + commands
- [ ] **Step 2:** Write `corpus.json` + per-case `meta.json` / `expect.json` (`status: pending_annotation`)
- [ ] **Step 3:** Commit

---

### Task 2: `assert-bands` pure module + unit tests

**Files:**
- Create: `packages/eval/src/golden/types.ts`
- Create: `packages/eval/src/golden/assert-bands.ts`
- Create: `packages/eval/tests/unit/assert-bands.test.ts`
- Modify: `packages/eval/src/lib.ts` — export assert helpers if useful

**Interfaces:**
- Produces: `assertScoreBands(result, expect) → { ok: boolean; violations: BandViolation[] }`

- [ ] **Step 1:** Write failing unit tests (in-band pass, out-of-band fail, null skips, pending status)
- [ ] **Step 2:** Implement types + assert-bands
- [ ] **Step 3:** Run `pnpm --filter @novel-eval/eval test:unit` — pass
- [ ] **Step 4:** Commit

---

### Task 3: Load corpus + slice chapters

**Files:**
- Create: `packages/eval/src/golden/load-corpus.ts`
- Create: `packages/eval/src/golden/slice.ts`
- Create: `packages/eval/tests/unit/golden-slice.test.ts` (use spike sample or fixture text)

**Interfaces:**
- Consumes: `splitChaptersWithMeta` from `@novel-eval/shared`, `parseTxt`
- Produces: `loadCorpus(repoRoot)`, `sliceCase(case, outPath) → SliceReport`

- [ ] **Step 1:** Failing tests for slice chapter count / char budget
- [ ] **Step 2:** Implement load + slice
- [ ] **Step 3:** Run unit tests — pass
- [ ] **Step 4:** Commit

---

### Task 4: `golden` CLI (`check` / `slice` / `run --dry-run`)

**Files:**
- Create: `packages/eval/src/golden/run-golden.ts`
- Create: `packages/eval/src/golden/cli.ts`
- Modify: `packages/eval/src/index.ts` — dispatch `golden`
- Modify: root `package.json` — `"golden": "tsx packages/eval/src/index.ts golden"`

**Interfaces:**
- Produces: CLI exit codes; dry-run never calls evaluate

- [ ] **Step 1:** Wire CLI help + `check` / `slice` / `run --dry-run`
- [ ] **Step 2:** Manually run against local novels: `pnpm golden check` and `pnpm golden run --dry-run`
- [ ] **Step 3:** Commit

---

### Task 5: Optional live evaluate path + docs link

**Files:**
- Modify: `packages/eval/src/golden/run-golden.ts` — `run` without dry-run calls `evaluate` on slices, writes `tests/golden/runs/<id>.summary.json`, asserts if `active`
- Modify: `docs/superpowers/specs/2026-07-17-golden-corpus-design.md` if any drift
- Modify: root `README.md` — short golden section

- [ ] **Step 1:** Implement evaluate+assert path behind non-dry-run
- [ ] **Step 2:** Document annotation workflow in `tests/golden/README.md`
- [ ] **Step 3:** Typecheck + unit tests green
- [ ] **Step 4:** Commit + push

---

## Execution notes

- Preferred order: Task 1 → 2 → 3 → 4 → 5.
- Live `golden run` (LLM) is manual verification only; do not block merge on API keys.
- After Task 4, `pnpm golden check` against the user's downloaded novels is the first real smoke test.
