# Independent Chapter Reviewer Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans. Steps use checkbox syntax.

**Goal:** Ship `ChapterReviewerService` and optional write-eval-revise before chapter publication.

**Architecture:** Wrap `assessChapterQuality`; map verdicts; wire optional `qualityReview` into `ChapterGenerationService.generateNext`; enable via job budget from Web/CLI.

**Tech Stack:** TypeScript, existing eval `assessChapters`, writer quality-gate / generation services.

## Global Constraints

- Default path remains gate-free.
- No volume-level revise tasks.
- No `any`; reuse TokenUsage / NovelMetadata.

---

### Task 1: Reviewer service + enriched gate result

- Create `packages/writer/src/services/chapter-reviewer-service.ts`
- Modify `quality-gate.ts` — reasons/evidence
- Modify `domain/errors.ts` — `ChapterQualityRejectedError`
- Test: `packages/writer/tests/unit/chapter-reviewer.test.ts`

### Task 2: Wire generateNext + application budget

- Modify `chapter-generation-service.ts`
- Modify `writer-application.ts` — read qualityGate/maxRevise from budget
- Modify web `generate.ts` — allow qualityGate; error mapper 422
- Modify CLI messaging for `--max-revise`
- Export from `lib.ts`

### Task 3: Integration test + docs commit/PR

- Extend generation integration or unit test with mock review loop
- Commit, push, open PR
