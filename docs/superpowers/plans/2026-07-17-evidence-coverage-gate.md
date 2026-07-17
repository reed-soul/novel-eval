# Evidence Coverage Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Gate evaluation reports on evidence link-rate and chapter skip-rate, not only missing dimensions.

**Architecture:** Extend `EvaluationCoverageDto` + `evaluationCoverageFor`; compute coverage in `evaluate()`; persist incomplete reports; keep Web GET 422 via `EvaluationIncompleteError`.

**Tech Stack:** TypeScript, existing shared DTO, eval evaluator, web eval-tasks.

## Global Constraints

- No evidence DB / revision-id wiring in this slice.
- Do not invent `any`; reuse `EvaluationExcerptDto.matchedBy`.
- Preserve existing missing-dimension 422 behavior.

---

### Task 1: Extend coverage DTO + pure computation

**Files:**
- Modify: `packages/shared/src/dto/evaluation.ts`
- Create: `packages/shared/tests/unit/evaluation-coverage.test.ts`

- [ ] Expand `EvaluationCoverageDto` and `evaluationCoverageFor` options/thresholds
- [ ] Unit tests for link-rate / skip-rate / missing dims
- [ ] Commit

### Task 2: Wire evaluate() + excerptIndex

**Files:**
- Modify: `packages/eval/src/types.ts` — optional `coverage` on result
- Modify: `packages/eval/src/evaluator.ts` — skipped chapters, excerptIndex, coverage
- Modify: `packages/eval/src/index.ts` — warn when incomplete

- [ ] Implement
- [ ] Typecheck eval
- [ ] Commit

### Task 3: Web persist + GET gate + contract tests

**Files:**
- Modify: `packages/web/server/routes/eval-tasks.ts`
- Modify: `packages/web/tests/unit/eval-contract.test.ts`
- Modify: `packages/web/src/pages/EvaluationReport.tsx` (+ styles if needed)

- [ ] Persist without gate; GET still gates with richer message
- [ ] Tests for low link-rate / high skip-rate → 422
- [ ] Coverage banner in report UI
- [ ] Commit + push + PR
