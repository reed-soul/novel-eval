# Golden Active + VCR Implementation Plan

**Goal:** Promote seeded baselines to active; add prompt-hash cassette record/replay.

## Tasks

- [x] Promote 7 `expect.json` → `active` + `promotedFrom`
- [x] `CassetteAdapter` + `cassettePromptHash` in shared
- [x] `EvaluateOptions.engine` injection
- [x] `golden run --vcr-record|--vcr-replay`
- [x] Unit tests + gitignore cassettes
- [x] Commit / PR
