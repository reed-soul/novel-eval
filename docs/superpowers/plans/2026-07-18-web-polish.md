# Web Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the browser write→eval→revise loop by wiring revision-tasks and correction entry points that already exist on the API.

**Architecture:** Keep Hono routes as-is; add thin `api/client.ts` helpers; new/updated React pages under `packages/web/src`. Phase A first (inbox + import + open-correction); Phase B knobs + finalize; Phase C empty-state / project binding.

**Tech Stack:** Vite, React 18, React Router 6, Hono, existing `styles.css` (no new UI kit).

**Spec:** `docs/superpowers/specs/2026-07-18-web-polish-design.md`

## Global Constraints

- Preserve existing dark/light CSS variables and card/button patterns.
- Prefer server responses already defined (`revision-tasks.ts`, `finalize.ts`, `correction.ts`).
- No `any`; validate JSON bodies at the client boundary with narrow types.
- Each task ends with typecheck / focused unit test where routes change; manual smoke for pages.

---

## File map (Phase A)

| File | Responsibility |
|------|----------------|
| `packages/web/src/api/client.ts` | `importRevisionTasks`, `listRevisionTasks`, `setRevisionTaskStatus`, `openCorrection` |
| `packages/web/src/pages/EvaluationReport.tsx` | CTA: import suggestions → project |
| `packages/web/src/pages/ProjectDetail.tsx` | Mount revision-task inbox section |
| `packages/web/src/components/RevisionTaskInbox.tsx` | **New** list + actions |
| `packages/web/src/pages/CorrectionReview.tsx` | Show task context; optional confirm before auto-run |
| `packages/web/tests/unit/revision-tasks.test.ts` | Extend if new client→route contracts need coverage |

---

## Phase A — 改稿闭环

### Task A1: API client for revision-tasks

**Files:**
- Modify: `packages/web/src/api/client.ts`

- [ ] Add types `RevisionTask`, `ImportRevisionTasksResult`, `OpenCorrectionResult`
- [ ] Implement:
  - `importRevisionTasks(projectId, { suggestions \| result, sourceEvalTaskId?, replaceOpen?, maxSuggestions? })`
  - `listRevisionTasks(projectId, status?)`
  - `setRevisionTaskStatus(projectId, taskId, status)`
  - `openCorrection(projectId, taskId)` → uses existing POST
- [ ] Commit: `feat(web): add revision-task API client helpers`

### Task A2: EvaluationReport → import CTA

**Files:**
- Modify: `packages/web/src/pages/EvaluationReport.tsx`
- Modify: `packages/web/src/pages/Evaluation.tsx` (pass/store `projectId` if available)

- [ ] When report has `suggestions` and user picked/bound a `projectId`, show button「导入为修订清单」
- [ ] Call `importRevisionTasks` with `maxSuggestions` default **8**, `replaceOpen` checkbox default false, `sourceEvalTaskId`
- [ ] On success: toast/inline success + link to `/projects/:id` (inbox)
- [ ] If no projectId: prompt select from `listProjects()` or deep-link message
- [ ] Commit: `feat(web): import eval suggestions as revision tasks`

### Task A3: RevisionTaskInbox on ProjectDetail

**Files:**
- Create: `packages/web/src/components/RevisionTaskInbox.tsx`
- Modify: `packages/web/src/pages/ProjectDetail.tsx`

- [ ] List tasks (default `open` + `in_progress`); show scope/dimension/content snippet
- [ ] Actions: 打开修正 / 标为完成 / 忽略
- [ ] 「打开修正」→ `openCorrection` → `navigate(opened.path)` (path already includes `revisionTaskId`)
- [ ] Hide or empty-state when zero tasks
- [ ] Commit: `feat(web): revision-task inbox on project detail`

### Task A4: CorrectionReview task awareness

**Files:**
- Modify: `packages/web/src/pages/CorrectionReview.tsx`

- [ ] If `revisionTaskId` present: fetch task via GET, show content banner above progress
- [ ] Keep passing `revisionTaskId` into `correctChapter`
- [ ] Optional: if entered with task id and pending draft exists, prefer showing draft over auto-retrigger (current pending check already helps)
- [ ] Commit: `feat(web): show revision-task context on correction page`

### Task A5: Phase A smoke

- [ ] Manual: project with chapters → eval → import 8 tasks → open one → adopt/discard
- [ ] `pnpm --filter @novel-eval/web typecheck` + relevant unit tests
- [ ] Update spike note or leave acceptance in PR body

---

## Phase B — 写侧旋钮 + finalize（A 合入后再开）

### Task B1: Generate knobs on ProjectDetail

- [ ] Inputs: outline `chapters`, chapter `wordCount`, `maxRevise` (when gate on)
- [ ] Wire to existing generate API bodies
- [ ] Commit: `feat(web): expose wordCount maxRevise outline chapters`

### Task B2: Finalize draft in RevisionHistory

- [ ] Add client `finalizeDraftRevision(projectId, revisionId)`
- [ ] Button on `status === 'draft'` → call finalize → refresh list
- [ ] Surface `draftRevisionId` from QG/extract errors if already in UI error paths
- [ ] Commit: `feat(web): finalize kept draft revisions`

---

## Phase C — 体验收口（可选）

### Task C1: Empty states + eval projectId binding

- [ ] ProjectList / ChapterReader copy → in-app links
- [ ] Evaluation upload flow keeps `?projectId=`
- [ ] QualityPanel error visible; link to `/chapters/:n/correction`

---

## Out of scope checklist

- Visual redesign / Tailwind migration
- Auth / multi-tenant
- Full `write auto` in Web
- Blind review / golden UI
