# Phase A Trusted Writing Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mutable chapter and narrative snapshots with immutable chapter revisions, a per-chapter story-state ledger, atomic publication, downstream invalidation, deterministic rebuilds, and database-backed project write leases.

**Architecture:** SQLite remains the single-process persistence engine, but all writes move behind focused repositories and application services. Model calls create candidates and state deltas outside transactions; a short transaction publishes the chapter revision, outline status, story-state revision, and checkpoint together. Existing databases and HTTP response shapes are not supported.

**Tech Stack:** TypeScript 5.9 strict mode, Node.js 20+, better-sqlite3, Node test runner through tsx, pnpm workspaces.

## Global Constraints

- Do not preserve compatibility with the existing SQLite schema, old job rows, old store functions, or old HTTP DTOs.
- Do not use `any`. Treat all external JSON as `unknown` and validate it before creating domain values.
- A published chapter revision is immutable. Failed candidates never replace or delete the active revision.
- Story state is versioned per published chapter revision. There is no mutable project-level narrative snapshot.
- Publishing a revision, advancing the outline, appending story state, invalidating downstream state, and updating a checkpoint occur in one short SQLite transaction.
- Model calls and prompt compilation occur outside database transactions.
- A project can have only one active write lease across CLI, Web, and future workers.
- Historical edits keep downstream chapter revisions and mark their derived state stale.
- Generation is strictly sequential. Chapter N requires the current state produced by chapter N-1.
- Use an explicit database path. Do not derive persistence from `process.cwd()`.
- Apply TDD for every behavior change: write a test, observe the expected failure, implement the minimum behavior, then rerun the focused and package suites.

---

## File map

### Create

- `packages/writer/src/migrations/001_initial.sql`: destructive phase-A schema.
- `packages/writer/src/migrations/runner.ts`: ordered migration runner.
- `packages/writer/src/domain/ids.ts`: branded IDs and constructors.
- `packages/writer/src/domain/errors.ts`: stable domain errors.
- `packages/writer/src/domain/story-state.ts`: state and delta types plus pure application.
- `packages/writer/src/domain/chapter.ts`: outline, chapter, revision, publication types.
- `packages/writer/src/repositories/project-repository.ts`: project persistence.
- `packages/writer/src/repositories/planning-repository.ts`: Bible, beats, outline revisions.
- `packages/writer/src/repositories/chapter-repository.ts`: chapter candidates and active reads.
- `packages/writer/src/repositories/story-state-repository.ts`: current/stale ledger reads and writes.
- `packages/writer/src/repositories/lease-repository.ts`: database lease compare-and-set.
- `packages/writer/src/services/chapter-publication-service.ts`: atomic publication boundary.
- `packages/writer/src/services/state-rebuild-service.ts`: stale invalidation and ordered rebuild.
- `packages/writer/src/services/context-compiler.ts`: single chapter context assembly path.
- `packages/writer/src/services/writer-application.ts`: CLI/Web write facade.
- `packages/writer/tests/helpers/test-db.ts`: explicit temporary database helper.
- `packages/writer/tests/helpers/fixtures.ts`: typed project, outline, chapter, and state seeds.
- `packages/writer/tests/unit/story-state.test.ts`
- `packages/writer/tests/integration/migrations.test.ts`
- `packages/writer/tests/integration/lease-repository.test.ts`
- `packages/writer/tests/integration/chapter-publication.test.ts`
- `packages/writer/tests/integration/stale-rebuild.test.ts`
- `packages/writer/tests/unit/context-compiler.test.ts`
- `packages/writer/tests/integration/writer-application.test.ts`

### Replace or substantially modify

- `packages/writer/src/db.ts`: explicit path connection and migration entry point.
- `packages/writer/src/project.ts`: delegate to `ProjectRepository`.
- `packages/writer/src/chapter/types.ts`: export new domain types, remove mutable narrative snapshot.
- `packages/writer/src/chapter/store.ts`: temporary read facade only, then delete old write functions.
- `packages/writer/src/chapter/generator.ts`: generate candidate and publish through application service.
- `packages/writer/src/chapter/finalizer.ts`: state extraction only, no persistence.
- `packages/writer/src/chapter/blueprint.ts`: persist beats and outline revisions.
- `packages/writer/src/chapter/corrector.ts`: publish adopted text through application service.
- `packages/writer/src/lib.ts`: export the new application boundary.
- `packages/writer/src/index.ts`: construct application services and use explicit database path.
- `packages/writer/src/job-store.ts`: point checkpoints at stable outline positions and keep original range.
- `packages/web/server/index.ts`: pass explicit database path.
- `packages/web/server/routes/generate.ts`: call `WriterApplication`, remove direct SQL.
- `packages/web/server/routes/edit.ts`: create and publish revisions.
- `packages/web/server/routes/chapters.ts`: read active revisions.
- `packages/web/server/routes/projects.ts`: count active chapters by outline position.

### Delete after callers move

- `packages/writer/src/chapter/consistency.ts`
- mutable writes in `packages/writer/src/chapter/store.ts`
- persistence side effects in `packages/writer/src/chapter/finalizer.ts`
- `packages/web/server/routes/narrative.ts`

---

### Task 1: Destructive schema and explicit database connection

**Files:**
- Create: `packages/writer/src/migrations/001_initial.sql`
- Create: `packages/writer/src/migrations/runner.ts`
- Create: `packages/writer/tests/helpers/test-db.ts`
- Create: `packages/writer/tests/integration/migrations.test.ts`
- Modify: `packages/writer/src/db.ts`
- Modify: `packages/writer/tests/unit/db.test.ts`

**Interfaces:**
- Produces: `openDb(options: { path: string }): DB`
- Produces: `runMigrations(db: DB): void`
- Produces: `createTestDb(): { db: DB; path: string; cleanup(): void }`

- [ ] **Step 1: Write the failing migration test**

```typescript
it('creates only the phase-A schema and enables integrity pragmas', () => {
  const testDb = createTestDb();
  const rows: unknown[] = testDb.db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all();
  const tables = rows.map((row) => {
    assert.ok(typeof row === 'object' && row !== null && 'name' in row);
    const name = row.name;
    assert.equal(typeof name, 'string');
    return name;
  });

  assert.deepEqual(tables, [
    'beat',
    'chapter',
    'chapter_outline',
    'chapter_outline_revision',
    'chapter_revision',
    'job',
    'project',
    'project_write_lease',
    'schema_version',
    'story_bible_revision',
    'story_state_revision',
  ]);
  assert.equal(testDb.db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(testDb.db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(testDb.db.pragma('busy_timeout', { simple: true }), 5000);
  testDb.cleanup();
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because `openDb` has no path option**

Run: `pnpm --filter @novel-eval/writer exec tsx --test tests/integration/migrations.test.ts`

Expected: FAIL with a compile/runtime error showing the explicit-path API or phase-A tables do not exist.

- [ ] **Step 3: Implement the migration runner and connection**

```typescript
export function openDb(options: { path: string }): DB {
  mkdirSync(dirname(options.path), { recursive: true });
  const db = new Database(options.path);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}
```

`runMigrations` must run each SQL file once inside a transaction and insert its integer version into `schema_version`. `001_initial.sql` must define strict foreign keys, status `CHECK` constraints, unique `(project_id, position)` outlines, unique `(chapter_id, revision_number)` revisions, unique current state per project and sequence, and one lease row per project.

- [ ] **Step 4: Run focused tests and package typecheck**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/integration/migrations.test.ts tests/unit/db.test.ts
pnpm --filter @novel-eval/writer typecheck
```

Expected: all focused tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/writer/src/db.ts packages/writer/src/migrations packages/writer/tests/helpers/test-db.ts packages/writer/tests/integration/migrations.test.ts packages/writer/tests/unit/db.test.ts
git commit -m "refactor(writer): establish phase-a database schema"
```

### Task 2: Typed story state and persistence repositories

**Files:**
- Create: `packages/writer/src/domain/ids.ts`
- Create: `packages/writer/src/domain/errors.ts`
- Create: `packages/writer/src/domain/story-state.ts`
- Create: `packages/writer/src/domain/chapter.ts`
- Create: `packages/writer/src/repositories/project-repository.ts`
- Create: `packages/writer/src/repositories/planning-repository.ts`
- Create: `packages/writer/src/repositories/chapter-repository.ts`
- Create: `packages/writer/src/repositories/story-state-repository.ts`
- Create: `packages/writer/tests/helpers/fixtures.ts`
- Create: `packages/writer/tests/unit/story-state.test.ts`
- Create: `packages/writer/tests/integration/repositories.test.ts`
- Modify: `packages/writer/src/project.ts`
- Modify: `packages/writer/src/chapter/types.ts`

**Interfaces:**
- Produces: branded `ProjectId`, `OutlineId`, `ChapterId`, `ChapterRevisionId`, `StoryStateRevisionId`
- Produces: `applyStoryStateDelta(previous: StoryState, delta: StoryStateDelta): StoryState`
- Produces: repositories that accept a `DB` and return validated domain objects

- [ ] **Step 1: Write failing tests for explicit delta semantics**

```typescript
it('keeps characters that are absent from a delta', () => {
  const previous = storyState({
    characters: [{ id: 'lin', name: '林晚', status: 'alive', facts: ['左手受伤'] }],
  });
  const next = applyStoryStateDelta(previous, {
    characterChanges: [],
    factChanges: [{ kind: 'add', fact: '林晚到达北站', sourceChapterRevisionId: revisionId('rev-2') }],
    foreshadowChanges: [],
    timelineEvents: [],
    summary: '林晚抵达北站。',
  });
  assert.deepEqual(next.characters, previous.characters);
});

it('requires an explicit remove event before deleting a character', () => {
  assert.throws(
    () => applyStoryStateDelta(previousState, invalidImplicitDeletion),
    InvalidStoryStateDeltaError,
  );
});
```

- [ ] **Step 2: Confirm the domain tests fail because the module does not exist**

Run: `pnpm --filter @novel-eval/writer exec tsx --test tests/unit/story-state.test.ts`

Expected: FAIL resolving `domain/story-state.ts`.

- [ ] **Step 3: Implement discriminated state events and exhaustive application**

```typescript
export type CharacterChange =
  | { kind: 'add'; character: CharacterState }
  | { kind: 'update'; characterId: CharacterId; patch: CharacterPatch }
  | { kind: 'remove'; characterId: CharacterId; reason: string };

export type ForeshadowChange =
  | { kind: 'open'; foreshadow: OpenForeshadow }
  | { kind: 'resolve'; foreshadowId: ForeshadowId; chapterRevisionId: ChapterRevisionId };
```

Every switch must include `const exhaustive: never = change`. Returned state must be a new value, not mutate `previous`.

- [ ] **Step 4: Write repository integration tests**

The tests must create a project, one Bible revision, persisted beats, an approved outline revision, a chapter candidate, and a story-state revision. Reading any JSON column must validate unknown JSON before returning a domain object.

- [ ] **Step 5: Implement repositories and rerun focused tests**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/unit/story-state.test.ts tests/integration/repositories.test.ts
pnpm --filter @novel-eval/writer typecheck
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/writer/src/domain packages/writer/src/repositories packages/writer/src/project.ts packages/writer/src/chapter/types.ts packages/writer/tests/helpers/fixtures.ts packages/writer/tests/unit/story-state.test.ts packages/writer/tests/integration/repositories.test.ts
git commit -m "refactor(writer): add versioned story repositories"
```

### Task 3: Database-backed project write lease

**Files:**
- Create: `packages/writer/src/repositories/lease-repository.ts`
- Create: `packages/writer/tests/integration/lease-repository.test.ts`

**Interfaces:**
- Produces: `ProjectWriteLeaseRepository.acquire(input): ProjectWriteLease`
- Produces: `renew(input): ProjectWriteLease`
- Produces: `release(input): void`

- [ ] **Step 1: Write failing contention and expiry tests**

```typescript
it('allows only one owner to acquire a project lease', () => {
  const first = leases.acquire({
    projectId,
    jobId: 'job-a',
    ownerId: 'worker-a',
    ttlMs: 30_000,
    now: instant('2026-07-16T09:00:00.000Z'),
  });
  assert.ok(first.id);
  assert.throws(
    () => leases.acquire({
      projectId,
      jobId: 'job-b',
      ownerId: 'worker-b',
      ttlMs: 30_000,
      now: instant('2026-07-16T09:00:01.000Z'),
    }),
    ProjectLeaseConflictError,
  );
});
```

Add a second test proving an expired lease can be replaced and the old owner cannot renew the replacement.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --filter @novel-eval/writer exec tsx --test tests/integration/lease-repository.test.ts`

Expected: FAIL because the lease repository does not exist.

- [ ] **Step 3: Implement transactional compare-and-set**

Use one immediate transaction. Delete only an expired row, insert the new lease, and translate the unique constraint into `ProjectLeaseConflictError`. Require matching `leaseId` and `ownerId` for renew/release.

- [ ] **Step 4: Run focused and repository suites**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/integration/lease-repository.test.ts tests/integration/repositories.test.ts
pnpm --filter @novel-eval/writer typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/writer/src/repositories/lease-repository.ts packages/writer/tests/integration/lease-repository.test.ts
git commit -m "feat(writer): serialize project writes with leases"
```

### Task 4: Atomic chapter publication

**Files:**
- Create: `packages/writer/src/services/chapter-publication-service.ts`
- Create: `packages/writer/tests/integration/chapter-publication.test.ts`
- Modify: `packages/writer/src/repositories/chapter-repository.ts`
- Modify: `packages/writer/src/repositories/story-state-repository.ts`

**Interfaces:**
- Consumes: repositories and active lease from Tasks 2 and 3
- Produces: `publishCandidate(input: PublishCandidateInput): PublishResult`

- [ ] **Step 1: Write the successful publication test**

```typescript
it('publishes revision, outline, state and checkpoint atomically', () => {
  const result = publication.publishCandidate({
    lease: activeLease,
    candidateRevisionId,
    previousStateRevisionId: null,
    state: initialState,
    delta: initialDelta,
    model: 'test-model',
    promptVersion: 'state-v1',
    checkpoint: { jobId, outlinePosition: 1 },
  });

  assert.equal(result.outlineStatus, 'written');
  assert.equal(chapters.getActiveRevision(chapterId)?.id, candidateRevisionId);
  assert.equal(states.getCurrentAtPosition(projectId, 1)?.chapterRevisionId, candidateRevisionId);
  assert.equal(jobs.get(jobId)?.lastOutlinePosition, 1);
});
```

- [ ] **Step 2: Write a rollback test**

Install a temporary SQLite trigger that aborts insertion into `story_state_revision`. Assert that publication throws and the candidate remains a draft, the chapter has no active revision, the outline remains approved, and the checkpoint does not move.

- [ ] **Step 3: Run and confirm both tests fail before implementation**

Run: `pnpm --filter @novel-eval/writer exec tsx --test tests/integration/chapter-publication.test.ts`

Expected: FAIL resolving the publication service.

- [ ] **Step 4: Implement a short publication transaction**

Validate the lease before beginning. Inside one `db.transaction`, verify candidate parent/current active revision, enforce the previous state at position N-1, publish the candidate, invalidate replaced/downstream current states when applicable, append the new state, mark the outline written, and update checkpoint.

- [ ] **Step 5: Run focused, repository, and lease suites**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/integration/chapter-publication.test.ts tests/integration/repositories.test.ts tests/integration/lease-repository.test.ts
pnpm --filter @novel-eval/writer typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/writer/src/services/chapter-publication-service.ts packages/writer/src/repositories/chapter-repository.ts packages/writer/src/repositories/story-state-repository.ts packages/writer/tests/integration/chapter-publication.test.ts
git commit -m "feat(writer): publish chapter revisions atomically"
```

### Task 5: Context compiler and sequential generation

**Files:**
- Create: `packages/writer/src/services/context-compiler.ts`
- Create: `packages/writer/src/services/chapter-generation-service.ts`
- Create: `packages/writer/tests/unit/context-compiler.test.ts`
- Create: `packages/writer/tests/integration/chapter-generation.test.ts`
- Modify: `packages/writer/src/chapter/generator.ts`
- Modify: `packages/writer/src/chapter/finalizer.ts`

**Interfaces:**
- Consumes: active Bible/outline/chapter/state revisions
- Produces: `compileChapterContext(input): CompiledChapterContext`
- Produces: `generateNext(input): Promise<GenerateChapterOutcome>`

- [ ] **Step 1: Write context compiler tests**

Assert that the compiled context includes the approved outline revision, previous current state, recent active chapter revisions, current arc summaries, genre profile, and a deterministic SHA-256 `contextHash`. Assert that mutable initial character state is not duplicated from Bible text.

- [ ] **Step 2: Write strict-order generation tests**

```typescript
it('rejects chapter N when chapter N-1 has no current state', async () => {
  await assert.rejects(
    generation.generateNext({ projectId, outlinePosition: 3, lease, engine }),
    StaleDependencyError,
  );
  assert.equal(chapters.listRevisions(chapterThreeId).length, 0);
});
```

Add tests showing provider or state-extraction failures save a rejected candidate when content exists but leave the active revision and state untouched.

- [ ] **Step 3: Run and confirm RED**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/unit/context-compiler.test.ts tests/integration/chapter-generation.test.ts
```

Expected: FAIL because the new services do not exist.

- [ ] **Step 4: Implement compiler, candidate generation, and pure state extraction**

Move prompt assembly out of `chapter/generator.ts`. Change `finalizer.ts` into an extractor returning `{ state, delta, usage, model, promptVersion }` without database writes. Generate and evaluate candidates outside transactions, then call `ChapterPublicationService`.

- [ ] **Step 5: Run focused and existing generation tests**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/unit/context-compiler.test.ts tests/integration/chapter-generation.test.ts tests/unit/chapter-generator.test.ts tests/unit/generate-range-pause.test.ts
pnpm --filter @novel-eval/writer typecheck
```

Expected: all updated tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/writer/src/services/context-compiler.ts packages/writer/src/services/chapter-generation-service.ts packages/writer/src/chapter/generator.ts packages/writer/src/chapter/finalizer.ts packages/writer/tests/unit/context-compiler.test.ts packages/writer/tests/integration/chapter-generation.test.ts packages/writer/tests/unit/chapter-generator.test.ts packages/writer/tests/unit/generate-range-pause.test.ts
git commit -m "refactor(writer): generate from versioned story context"
```

### Task 6: Historical edits, downstream invalidation, and rebuild

**Files:**
- Create: `packages/writer/src/services/state-rebuild-service.ts`
- Create: `packages/writer/tests/integration/stale-rebuild.test.ts`
- Modify: `packages/writer/src/services/chapter-publication-service.ts`
- Modify: `packages/writer/src/chapter/corrector.ts`
- Delete: `packages/writer/src/chapter/consistency.ts`
- Delete: `packages/writer/tests/unit/consistency.test.ts`

**Interfaces:**
- Produces: `publishHistoricalRevision(input): PublishResult`
- Produces: `rebuildFrom(input): Promise<RebuildResult>`

- [ ] **Step 1: Write invalidation tests**

Publish three chapters, publish a new revision of chapter 2, then assert:

```typescript
assert.deepEqual(result.staleImpact.affectedOutlinePositions, [2, 3]);
assert.equal(chapters.getActiveRevision(chapterThreeId)?.id, originalChapterThreeRevisionId);
assert.equal(states.getCurrentAtPosition(projectId, 3), null);
assert.equal(states.listStale(projectId).length, 2);
```

- [ ] **Step 2: Write ordered rebuild tests**

Use a deterministic extractor that records input order. Rebuild from position 2 and assert calls are `[2, 3]`, new state revisions form one chain from position 1, old stale revisions remain immutable, and current state exists through position 3.

- [ ] **Step 3: Run and confirm RED**

Run: `pnpm --filter @novel-eval/writer exec tsx --test tests/integration/stale-rebuild.test.ts`

Expected: FAIL because rebuild behavior is missing.

- [ ] **Step 4: Implement invalidation and rebuild**

Historical publication must not delete downstream chapters. Rebuild reads each active chapter revision in order, extracts a delta from the newly current predecessor state, and appends a new current ledger revision. Stop at the first failure and leave later positions stale.

- [ ] **Step 5: Remove consistency repair and run focused suites**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/integration/stale-rebuild.test.ts tests/integration/chapter-publication.test.ts
pnpm --filter @novel-eval/writer typecheck
```

Expected: all pass and no import references `chapter/consistency.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/writer/src/services/state-rebuild-service.ts packages/writer/src/services/chapter-publication-service.ts packages/writer/src/chapter/corrector.ts packages/writer/tests/integration/stale-rebuild.test.ts
git rm packages/writer/src/chapter/consistency.ts packages/writer/tests/unit/consistency.test.ts
git commit -m "feat(writer): rebuild stale story state after edits"
```

### Task 7: Persist planning artifacts and expose the application facade

**Files:**
- Create: `packages/writer/src/services/writer-application.ts`
- Create: `packages/writer/tests/integration/writer-application.test.ts`
- Modify: `packages/writer/src/bible/generator.ts`
- Modify: `packages/writer/src/bible/importer.ts`
- Modify: `packages/writer/src/chapter/blueprint.ts`
- Modify: `packages/writer/src/lib.ts`
- Modify: `packages/writer/src/index.ts`
- Modify: `packages/writer/src/job-store.ts`

**Interfaces:**
- Produces: `WriterApplication.generateChapterRange`
- Produces: `WriterApplication.publishChapterEdit`
- Produces: `WriterApplication.rebuildStoryState`
- Produces: `WriterApplication.getStaleImpact`

- [ ] **Step 1: Write facade tests**

Assert `generateChapterRange` acquires one lease, generates only the requested approved positions in sequence, persists original range/config in the job row, releases the lease on success and error, and refuses a range with gaps. Assert `publishChapterEdit` creates a draft then publishes through the same transaction as generated content.

- [ ] **Step 2: Extend blueprint tests**

Assert generated beats are stored before outline generation and a retry reads persisted beats rather than generating different beats. Outlines must receive stable IDs, revision 1, and `approved` status in the CLI compatibility flow.

- [ ] **Step 3: Run and confirm RED**

Run:

```bash
pnpm --filter @novel-eval/writer exec tsx --test tests/integration/writer-application.test.ts tests/unit/blueprint.test.ts
```

Expected: FAIL because the facade and planning repositories are not wired.

- [ ] **Step 4: Implement the facade and planning persistence**

CLI and Web receive a configured `WriterApplication`; they do not construct repositories individually. Bible generation/import creates immutable revision 1 and makes it active. Blueprint generation persists beats and approved outline revision 1. Job resume reads the stored `to` value and configuration snapshot.

- [ ] **Step 5: Run writer suite and typecheck**

Run:

```bash
pnpm --filter @novel-eval/writer test
pnpm --filter @novel-eval/writer typecheck
```

Expected: all writer tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/writer/src/services/writer-application.ts packages/writer/src/bible packages/writer/src/chapter/blueprint.ts packages/writer/src/lib.ts packages/writer/src/index.ts packages/writer/src/job-store.ts packages/writer/tests/integration/writer-application.test.ts packages/writer/tests/unit/blueprint.test.ts
git commit -m "refactor(writer): route writing through application service"
```

### Task 8: Remove legacy mutation paths and minimally reconnect Web

**Files:**
- Modify: `packages/web/server/index.ts`
- Modify: `packages/web/server/routes/generate.ts`
- Modify: `packages/web/server/routes/edit.ts`
- Modify: `packages/web/server/routes/chapters.ts`
- Modify: `packages/web/server/routes/projects.ts`
- Modify: `packages/web/tests/unit/edit.test.ts`
- Modify: `packages/web/tests/unit/routes.test.ts`
- Modify: `packages/writer/src/chapter/store.ts`
- Modify: `packages/writer/src/chapter/quality-gate.ts`
- Delete: `packages/web/server/routes/narrative.ts`
- Modify: `packages/writer/tests/unit/chapter-store.test.ts`

**Interfaces:**
- Consumes: `WriterApplication` and active revision read DTOs
- Produces: a compiling Web server whose chapter writes cannot bypass publication

- [ ] **Step 1: Rewrite Web route tests first**

The edit route test must assert a new revision ID, active revision update, and stale impact. The chapter route test must assert it returns only the active published revision. Add a test proving generate routes contain no direct `db.prepare` calls by exercising the route with a repository spy that exposes only the application facade.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
pnpm --filter @novel-eval/web exec tsx --test tests/unit/edit.test.ts tests/unit/routes.test.ts
```

Expected: FAIL because routes still use the mutable store.

- [ ] **Step 3: Reconnect routes and remove old writes**

Delete `saveChapter`, `deleteChapter`, `saveNarrativeState`, `updateCharacterState`, and the narrative route. Adapt quality-gate temporary candidate reads to revision IDs. Keep stage-B UI and DTO redesign out of scope.

- [ ] **Step 4: Run all verification**

Run:

```bash
pnpm typecheck
pnpm test
pnpm web:build
```

Expected: every command exits 0 with no failed tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web packages/writer/src/chapter/store.ts packages/writer/src/chapter/quality-gate.ts packages/writer/tests/unit/chapter-store.test.ts
git rm packages/web/server/routes/narrative.ts
git commit -m "refactor(web): use versioned writer application"
```

## Plan self-review checklist

- Every phase-A acceptance condition has a task and an automated test.
- No task introduces stage-B version-history UI, complete job event persistence, authentication, or stage-C evidence storage.
- New types use discriminated unions and branded IDs; no external `unknown` crosses into domain code without validation.
- Every production behavior starts with a focused failing test.
- Task dependencies are linear enough for one implementer at a time: schema, repositories, lease, publication, generation, rebuild, facade, Web cleanup.
- The old mutable paths are deleted only after callers move.
