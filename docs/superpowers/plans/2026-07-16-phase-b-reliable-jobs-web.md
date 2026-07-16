# Phase B Reliable Jobs and Web Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase A writing kernel usable through durable jobs, validated HTTP contracts, and an author workstation that can approve plans, edit with extract-backed state, inspect stale impact, and read correct evaluation reports.

**Architecture:** Keep `WriterApplication` as the only write facade. Persist job events and budgets in SQLite beside the Phase A lease/checkpoint model. Introduce shared runtime-validated DTOs at the HTTP boundary. Expose story-state, rebuild, revision, and planning-approval APIs first, then wire React pages to those contracts. Do not reopen Phase A data-model decisions.

**Tech Stack:** TypeScript 5.9 strict, Node 20+, better-sqlite3, Hono, React/Vite, Node test runner via tsx, pnpm workspaces. Prefer Zod or an equivalent runtime schema library already acceptable in-repo; if none exists, add one dependency in `shared` only after the first failing contract test proves it is needed.

## Global Constraints

- Phase A kernel remains authoritative: immutable chapter revisions, per-chapter story-state ledger, IMMEDIATE publication, project write leases, resume bound to stored snapshots.
- Do not restore old mutable snapshot APIs, `narrative_state`, or compatibility shims for deleted schemas.
- No `any`. External JSON is `unknown` until validated.
- Model calls stay outside DB transactions.
- One active project write lease across CLI and Web.
- Content-only edits must never publish empty story state. Either extract then publish, or reject with a stable validation error.
- Pause/cancel UI may appear only where the runner actually honors control signals.
- Stage C evidence store, golden corpus, multi-tenant auth, and production hardening stay out of scope.
- Apply TDD for every behavior change. Run focused tests, then package/`pnpm typecheck`/`pnpm test`/`pnpm web:build` before claiming done.
- Explicit data paths only. Prefer `WRITER_DB_PATH`, `WRITER_API_URL`, and `PORT`. Never depend on `process.cwd()` for production data.

---

## File map

### Create

- `packages/shared/src/config/service-endpoints.ts`: resolve `PORT` and `WRITER_API_URL`.
- `packages/shared/src/dto/**`: request/response schemas and inferred types for jobs, projects, edits, story-state, planning, evaluations.
- `packages/writer/src/migrations/004_job_events_budget.sql`: durable job events and any missing budget/index columns.
- `packages/writer/src/domain/http-errors.ts` or extend `domain/errors.ts`: `ValidationError`, `BudgetExceededError`, provider errors, `EvaluationIncompleteError`.
- `packages/web/server/routes/story-state.ts`
- `packages/web/server/routes/rebuilds.ts`
- `packages/web/server/routes/revisions.ts`
- `packages/web/server/middleware/error-mapper.ts`
- `packages/web/src/components/StaleImpactPanel.tsx`
- `packages/web/src/components/RevisionHistory.tsx`
- `packages/web/src/components/PlanningApproval.tsx`
- `packages/web/tests/unit/job-events.test.ts`
- `packages/web/tests/unit/eval-contract.test.ts`
- `packages/writer/tests/integration/job-budget.test.ts`

### Modify

- `packages/writer/src/api-client.ts`, `packages/writer/src/index.ts`
- `packages/writer/src/job-store.ts`, `packages/writer/src/services/writer-application.ts`
- `packages/web/server/index.ts`, `packages/web/server/jobs.ts`, `packages/web/server/eval-jobs.ts`
- `packages/web/server/routes/generate.ts`, `edit.ts`, `correction.ts`, `eval-tasks.ts`, `bible.ts`, `outlines.ts`, `chapters.ts`, `eval.ts`
- `packages/web/vite.config.ts`, `README.md`, `.env.example`
- `packages/web/src/api/client.ts`, `hooks/useJobProgress.ts`, `components/ProgressPanel.tsx`
- `packages/web/src/pages/ProjectDetail.tsx`, `ChapterReader.tsx`, `StateView.tsx`, `CorrectionReview.tsx`, `EvaluationReport.tsx`, `Evaluation.tsx`
- Planning generators if needed: `packages/writer/src/bible/generator.ts`, `packages/writer/src/chapter/blueprint.ts`, `packages/writer/src/repositories/planning-repository.ts`

### Delete or stop calling

- Any remaining `/narrative` client calls once story-state routes land.
- Hardcoded `localhost:3000` and README claims of port 3000.

---

### Task 1: Unify service endpoints and configuration

**Files:**
- Create: `packages/shared/src/config/service-endpoints.ts`
- Modify: `packages/writer/src/api-client.ts`
- Modify: `packages/writer/src/index.ts`
- Modify: `packages/web/server/index.ts`
- Modify: `packages/web/vite.config.ts`
- Modify: `README.md`
- Modify: `.env.example`
- Test: `packages/shared/tests/unit/service-endpoints.test.ts` or writer unit test covering URL resolution

**Interfaces:**
- Produces: `resolveServicePort(env): number`
- Produces: `resolveWriterApiUrl(env): string`

- [ ] **Step 1: Write failing endpoint resolution tests**

```typescript
it('defaults API URL and server port to the same value', () => {
  assert.equal(resolveServicePort({}), 4000);
  assert.equal(resolveWriterApiUrl({}), 'http://127.0.0.1:4000');
});

it('honors WRITER_API_URL over PORT for clients', () => {
  assert.equal(
    resolveWriterApiUrl({ PORT: '5000', WRITER_API_URL: 'http://127.0.0.1:5001' }),
    'http://127.0.0.1:5001',
  );
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --filter @novel-eval/shared exec tsx --test tests/unit/service-endpoints.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement shared resolution and replace hardcoding**

Server listens on `resolveServicePort(process.env)`. CLI and `api-client.ts` call `resolveWriterApiUrl(process.env)`. Vite proxy targets the same default. README and `.env.example` document `PORT`, `WRITER_API_URL`, and `WRITER_DB_PATH`.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @novel-eval/shared exec tsx --test tests/unit/service-endpoints.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared packages/writer/src/api-client.ts packages/writer/src/index.ts packages/web/server/index.ts packages/web/vite.config.ts README.md .env.example
git commit -m "fix(config): unify writer API port and base URL"
```

### Task 2: Durable job events, budgets, and resumable SSE

**Files:**
- Create: `packages/writer/src/migrations/004_job_events_budget.sql`
- Modify: `packages/writer/src/job-store.ts`
- Modify: `packages/writer/src/domain/errors.ts`
- Modify: `packages/writer/src/services/writer-application.ts`
- Modify: `packages/web/server/jobs.ts`
- Modify: `packages/web/server/routes/generate.ts`
- Modify: `packages/web/src/hooks/useJobProgress.ts`
- Test: `packages/writer/tests/unit/job-store.test.ts`
- Test: `packages/writer/tests/integration/job-budget.test.ts`
- Test: `packages/web/tests/unit/job-events.test.ts`

**Interfaces:**
- Produces: `appendJobEvent(db, { jobId, seq, step, msg, ts })`
- Produces: `listJobEventsAfter(db, jobId, afterSeq)`
- Produces: budget accounting that throws `BudgetExceededError`
- Consumes: Phase A resume snapshot binding

- [ ] **Step 1: Write failing persistence and budget tests**

```typescript
it('replays job events after the given sequence following restart', () => {
  appendJobEvent(db, { jobId, seq: 1, step: 'chapter:1', msg: 'start', ts: 1 });
  appendJobEvent(db, { jobId, seq: 2, step: 'chapter:1', msg: 'done', ts: 2 });
  // simulate process restart with empty memory map
  assert.deepEqual(
    listJobEventsAfter(db, jobId, 1).map((e) => e.seq),
    [2],
  );
});

it('fails the job when cumulative cost exceeds maxCostRmb', async () => {
  await assert.rejects(
    app.generateChapterRange({
      projectId,
      from: 1,
      to: 2,
      wordCount: 1000,
      ownerId: 'test',
      budget: { maxCostRmb: 0.0001 },
      engine,
    }),
    BudgetExceededError,
  );
});
```

- [ ] **Step 2: Confirm RED**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/unit/job-store.test.ts tests/integration/job-budget.test.ts
```

Expected: FAIL on missing event APIs / budget enforcement.

- [ ] **Step 3: Implement migration, store APIs, and SSE continuation**

Add `job_event(job_id, seq, step, msg, ts)` with unique `(job_id, seq)`. Every progress callback appends an event and emits SSE with `id: seq`. On connect, honor `Last-Event-ID` or `?after=`. Persist complete `input_json` and `budget_json` for bible/outline/chapter jobs. Charge usage into `usage_json` and stop before the next expensive call when budget would be exceeded. Detect active jobs from DB (`running|paused`), not only the in-memory Map. Keep Phase A resume snapshot forcing intact.

- [ ] **Step 4: Wire frontend reconnect**

`useJobProgress` must reconnect with the last seen event id and must poll `GET /jobs/:id` after reconnect exhaustion instead of leaving a permanent running spinner.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/unit/job-store.test.ts tests/integration/job-budget.test.ts tests/integration/writer-application.test.ts
pnpm --filter @novel-eval/web exec tsx --test tests/unit/job-events.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/writer/src/migrations/004_job_events_budget.sql packages/writer/src/job-store.ts packages/writer/src/domain/errors.ts packages/writer/src/services/writer-application.ts packages/web/server/jobs.ts packages/web/server/routes/generate.ts packages/web/src/hooks/useJobProgress.ts packages/writer/tests packages/web/tests/unit/job-events.test.ts
git commit -m "feat(jobs): persist events and enforce generation budgets"
```

### Task 3: Shared DTOs, validation, and HTTP error mapping

**Files:**
- Create: `packages/shared/src/dto/**`
- Create: `packages/web/server/middleware/error-mapper.ts`
- Modify: `packages/web/server/index.ts`
- Modify: `packages/web/server/routes/edit.ts`
- Modify: `packages/web/server/routes/generate.ts`
- Modify: `packages/web/server/routes/eval-tasks.ts`
- Modify: `packages/web/src/api/client.ts`
- Test: `packages/web/tests/unit/routes.test.ts`
- Test: `packages/web/tests/unit/edit.test.ts`

**Interfaces:**
- Produces: `EditChapterRequest`, `GenerateChaptersRequest`, `JobStatusResponse`, `EvaluationReportResponse`
- Produces: `toHttpError(error): { status; code; message }`

- [ ] **Step 1: Write failing contract tests**

```typescript
it('rejects invalid edit bodies with ValidationError code', async () => {
  const res = await app.request(`/api/projects/${projectId}/chapters/1`, {
    method: 'PUT',
    body: JSON.stringify({ content: 'x' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'ValidationError');
});
```

Add a generate-body test for negative `from`/`to` and an eval-result shape test that expects a stable DTO, not `{task, result}` accidental leakage.

- [ ] **Step 2: Confirm RED**

Run: `pnpm --filter @novel-eval/web exec tsx --test tests/unit/edit.test.ts tests/unit/routes.test.ts`

Expected: FAIL on missing `code` field / unstable eval DTO.

- [ ] **Step 3: Implement schemas and mapper**

Validate every mutating route body and important responses. Map domain errors:

- `ValidationError` → 400
- `ProjectLeaseConflictError` → 409
- `StaleDependencyError` → 409
- `BudgetExceededError` → 402 or 409 with explicit code
- `EvaluationIncompleteError` → 422
- unknown → 500 with opaque message

Frontend client types import the shared DTO types. Remove `any` from EvaluationReport state.

- [ ] **Step 4: Verify and commit**

```bash
pnpm typecheck
pnpm --filter @novel-eval/web test
git add packages/shared/src/dto packages/web/server packages/web/src/api/client.ts packages/web/tests
git commit -m "feat(api): add runtime-validated DTOs and error codes"
```

### Task 4: Story-state, rebuild, revisions, and stale APIs

**Files:**
- Create: `packages/web/server/routes/story-state.ts`
- Create: `packages/web/server/routes/rebuilds.ts`
- Create: `packages/web/server/routes/revisions.ts`
- Modify: `packages/web/server/index.ts`
- Modify: `packages/web/server/routes/chapters.ts`
- Modify: `packages/web/server/routes/eval.ts`
- Modify: `packages/web/src/api/client.ts`
- Test: `packages/web/tests/unit/story-state.test.ts`

**Interfaces:**
- Produces: `GET /api/projects/:id/story-state`
- Produces: `GET /api/projects/:id/stale-impact`
- Produces: `POST /api/projects/:id/rebuilds`
- Produces: `GET /api/chapters/:chapterId/revisions`

- [ ] **Step 1: Write failing route tests**

Publish three chapters, historically edit chapter 2 with valid state/delta, then assert:

```typescript
const stale = await getJson(`/api/projects/${projectId}/stale-impact`);
assert.deepEqual(stale.affectedOutlinePositions, [3]); // or documented [2,3] semantics
const revisions = await getJson(`/api/chapters/${chapter2Id}/revisions`);
assert.ok(revisions.length >= 2);
```

Also assert rebuild endpoint returns current states through the latest written position.

- [ ] **Step 2: Confirm RED**

Run: `pnpm --filter @novel-eval/web exec tsx --test tests/unit/story-state.test.ts`

Expected: FAIL with 404 routes.

- [ ] **Step 3: Implement routes through WriterApplication / repositories**

No direct SQL in routes. Dashboard foreshadow data must read the current story-state ledger, not empty bible shells. Keep chapter GET returning only active published revisions.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @novel-eval/web test
pnpm typecheck
git add packages/web/server/routes packages/web/tests/unit/story-state.test.ts packages/web/src/api/client.ts
git commit -m "feat(web): expose story-state rebuild and revision APIs"
```

### Task 5: Planning draft and approval gate

**Files:**
- Modify: `packages/writer/src/repositories/planning-repository.ts`
- Modify: `packages/writer/src/bible/generator.ts`
- Modify: `packages/writer/src/chapter/blueprint.ts`
- Modify: `packages/writer/src/services/writer-application.ts`
- Modify: `packages/web/server/routes/bible.ts`
- Modify: `packages/web/server/routes/outlines.ts`
- Modify: `packages/web/server/routes/generate.ts`
- Test: `packages/writer/tests/unit/blueprint.test.ts`
- Test: `packages/web/tests/unit/planning-approval.test.ts`

**Interfaces:**
- Produces: draft bible/outline creation without auto-approve
- Produces: `POST .../bible-revisions/:id/approve`
- Produces: `POST .../outlines/approve` or per-outline approve
- Produces: chapter generate rejects unapproved plans

- [ ] **Step 1: Write failing approval-gate tests**

```typescript
it('refuses chapter generation before outline approval', async () => {
  await generateDraftBlueprint(projectId);
  await assert.rejects(
    app.generateChapterRange({ projectId, from: 1, to: 1, ... }),
    /not approved/i,
  );
});
```

- [ ] **Step 2: Confirm RED**

Run focused writer/web planning tests. Expected: FAIL because current generators auto-approve.

- [ ] **Step 3: Implement draft-first planning**

Bible/blueprint generation creates draft revisions. Approval endpoints promote them and set project/outline status. Chapter generation requires approved bible + approved outlines for the requested range. Keep a CLI flag or explicit approve step so automation remains possible without hidden auto-approve in Web.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @novel-eval/writer test
pnpm --filter @novel-eval/web exec tsx --test tests/unit/planning-approval.test.ts
git add packages/writer/src/bible packages/writer/src/chapter/blueprint.ts packages/writer/src/repositories/planning-repository.ts packages/writer/src/services/writer-application.ts packages/web/server/routes packages/web/tests
git commit -m "feat(planning): require explicit bible and outline approval"
```

### Task 6: Author workstation UI for edit extract, stale, history, and approval

**Files:**
- Create: `packages/web/src/components/StaleImpactPanel.tsx`
- Create: `packages/web/src/components/RevisionHistory.tsx`
- Create: `packages/web/src/components/PlanningApproval.tsx`
- Modify: `packages/web/src/pages/ProjectDetail.tsx`
- Modify: `packages/web/src/pages/ChapterReader.tsx`
- Modify: `packages/web/src/pages/StateView.tsx`
- Modify: `packages/web/src/pages/CorrectionReview.tsx`
- Modify: `packages/web/server/routes/edit.ts`
- Modify: `packages/web/server/routes/correction.ts`
- Test: `packages/web/tests/unit/edit.test.ts`
- Test: browser-oriented component tests if present; otherwise route+client contract tests covering the new flows

**Interfaces:**
- Produces: `POST /api/projects/:id/chapters/:n/extract-and-publish`
- Or: edit route accepts `{ content, extract: true }` and runs `extractStoryState` server-side under lease
- Produces: UI that shows stale positions and triggers rebuild

- [ ] **Step 1: Write failing extract-and-publish test**

```typescript
it('publishes a content-only edit by extracting state on the server', async () => {
  const res = await putChapter(projectId, 1, { content: '新的正文', extract: true });
  assert.equal(res.status, 200);
  assert.ok(res.body.chapterRevisionId);
  assert.ok(res.body.storyStateRevisionId);
});
```

- [ ] **Step 2: Confirm RED**

Expected: FAIL because extract path does not exist; content-only still 400.

- [ ] **Step 3: Implement server extract path and UI wiring**

ChapterReader and CorrectionReview use extract-and-publish. Never send empty state. ProjectDetail shows planning approval controls and hides chapter generate until approved. StateView uses story-state APIs. StaleImpactPanel lists affected positions and offers rebuild. RevisionHistory lists immutable revisions and can restore by publishing a selected historical revision through the facade. Pause/cancel buttons render only for chapter jobs.

- [ ] **Step 4: Add budget confirmation UX**

Before starting bible/outline/chapter jobs, show estimated cost when available and require confirmation when `maxCostRmb` is configured.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @novel-eval/web test
pnpm typecheck
pnpm web:build
git add packages/web
git commit -m "feat(web): wire planning approval stale history and extract edits"
```

### Task 7: Evaluation report contract and eight-dimension UI

**Files:**
- Modify: `packages/web/server/routes/eval-tasks.ts`
- Modify: `packages/web/server/eval-jobs.ts`
- Modify: `packages/web/src/pages/EvaluationReport.tsx`
- Modify: `packages/web/src/pages/Evaluation.tsx`
- Modify: `packages/web/src/components/ChapterQualityPanel.tsx` if still five-axis
- Modify: `packages/web/src/api/client.ts`
- Test: `packages/web/tests/unit/eval-contract.test.ts`

**Interfaces:**
- Produces: `EvaluationReportResponse` with `overall`, eight `dimensions`, `excerpts`, coverage fields
- Produces: UI radar with eight axes and excerpt deep links

- [ ] **Step 1: Write failing contract and UI data tests**

```typescript
it('returns a flat evaluation report DTO with eight dimensions and excerpts', async () => {
  const report = await getJson(`/api/eval/${taskId}/result`);
  assert.ok(report.dimensions.thematicDepth);
  assert.ok(report.dimensions.originality);
  assert.ok(report.dimensions.pacingRetention);
  assert.ok(Array.isArray(report.excerpts));
  assert.equal(report.task, undefined);
});
```

- [ ] **Step 2: Confirm RED**

Expected: FAIL because current API persists/returns `{task, result}` and UI only knows five dimensions.

- [ ] **Step 3: Fix persistence and rendering**

Store and return the inner `EvaluationResult` as the report DTO, or wrap it in an explicit `{ report: EvaluationResult, meta }` schema and update the page once. Render all eight dimensions. Show excerpts with chapter/revision pointers. If coverage is incomplete, return `EvaluationIncompleteError` or mark `incomplete: true` and refuse a fake full-confidence grade.

Move eval artifact paths off `process.cwd()` onto an explicit `EVAL_DATA_DIR` / shared data root.

- [ ] **Step 4: Verify full Phase B gate**

Run:

```bash
pnpm typecheck
pnpm test
pnpm web:build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/server/routes/eval-tasks.ts packages/web/server/eval-jobs.ts packages/web/src/pages/EvaluationReport.tsx packages/web/src/pages/Evaluation.tsx packages/web/src/components packages/web/src/api/client.ts packages/web/tests/unit/eval-contract.test.ts
git commit -m "fix(eval): align web report DTO with eight-dimension evidence"
```

## Phase B acceptance checklist

1. CLI and Web share one configured API base URL/port.
2. Job events survive process restart and SSE can continue from the last sequence.
3. Budget limits stop further paid calls and mark the job failed with a stable code.
4. Mutating APIs reject invalid bodies with runtime validation and stable error codes.
5. Authors can approve bible/outlines before chapter generation.
6. Content edits publish only after extract-backed state/delta, never via empty shell state.
7. Stale impact is visible and rebuild is callable from the UI.
8. Chapter revision history is readable and restorable through publication.
9. Evaluation reports show eight dimensions and excerpts without crashing on DTO shape.
10. `pnpm typecheck`, `pnpm test`, and `pnpm web:build` pass.

## Plan self-review

- Every Stage B item from the design §13 “可靠任务和 Web 契约” maps to a task.
- No Stage C golden-corpus or Stage D auth work is included.
- Tasks are ordered so UI work depends on APIs, not the reverse.
- Each task starts with a failing test and names exact commands.
- Phase A invariants remain global constraints rather than being redesigned.
