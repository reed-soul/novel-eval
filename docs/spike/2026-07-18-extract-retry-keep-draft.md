# Extract retry + keep draft (P0 residual)

After E2E stress (`2026-07-17-e2e-short-stress-report.md`), quality-accepted /
generated chapter bodies were discarded when finalize crashed.

## Behavior

1. Story-state extraction retries up to **3** times (`extractAttempts`, overridable).
2. On exhaustion, revision stays **`draft`** (no longer forced to `rejected`).
3. `StateExtractionError` carries `draftRevisionId` + `attempts` (HTTP 422).

Progress lines: `状态抽取…` / `状态抽取重试 n/3…` / failure detail.
