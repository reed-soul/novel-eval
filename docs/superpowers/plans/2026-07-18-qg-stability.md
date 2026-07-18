# QG Stability Implementation Plan

> **For agentic workers:** implement task-by-task; commit when the slice is green.

**Goal:** Soft quality fails can consume `maxRevise`; terminal fails keep draft; persist assess raw JSON.

**Files:** `quality-gate.ts`, `chapter-reviewer-service.ts`, `chapter-generation-service.ts`, `errors.ts`, `store.ts`, migration `006`, error-mapper, tests, design already in `specs/2026-07-18-qg-stability-design.md`.

## Tasks

1. Migration + `saveEvalHistory` `assessRaw`
2. Gate: `hardBlock` on severe rep; pass `assessRaw` into persist
3. Reviewer: forward `hardBlock`
4. Generation: soft-reject revise loop; keep draft on terminal; error `draftRevisionId`
5. Web error-mapper + tests
6. Integration/unit tests update + new cases
