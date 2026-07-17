# Revision Tasks Implementation Plan

> **For agentic workers:** Use checkbox tracking. TDD where practical.

**Goal:** Persist evaluation suggestions as reviewable revision tasks with list/status APIs.

**Architecture:** Writer migration + repository + service; Web project routes; CLI import/list/set-status. No LLM.

**Tech Stack:** SQLite STRICT, Hono, existing writer DB patterns.

---

### Task 1: Schema + repository + service

- [x] Create `005_revision_task.sql`
- [x] Create `revision-task-repository.ts`, `revision-task-service.ts`, domain types
- [x] Unit/integration tests

### Task 2: Web routes + CLI + exports

- [x] `routes/revision-tasks.ts`, mount in `server/index.ts`
- [x] CLI subcommands under `write revision-tasks`
- [x] Export from `lib.ts`
- [ ] Commit, push, PR
