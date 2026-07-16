Status: DONE

Commit SHA: c92a7c3387d156bab52e2987cb5915a55d43c595

What landed:
- Bible generation now saves draft revisions and returns the draft revision id. It no longer approves or activates the bible automatically.
- Blueprint generation now saves draft outline revisions instead of approved outlines.
- WriterApplication has explicit approval methods for bible revisions and outline ranges, guarded by project write leases and approval job rows.
- Chapter generation now rejects ranges without an approved active bible and approved outline revisions for the requested range.
- Web exposes project-scoped approval endpoints:
  - POST /api/projects/:id/bible-revisions/:revisionId/approve
  - POST /api/projects/:id/outlines/approve
- Web chapter generation runs the approval check before creating a chapter job.
- CLI has an explicit `write approve-planning` command and `--approve-planning` automation flag. `write auto` requires that flag.

Tests:
- `pnpm --filter @novel-eval/writer test`
- `pnpm --filter @novel-eval/web exec tsx --test tests/unit/planning-approval.test.ts`
- `pnpm typecheck`

Concerns:
- None.
