---
phase: 05-screenshots-procedure-review-trim
plan: 10
subsystem: screenshots-procedure-review-trim
tags: [renderer, react, ipc, screenshots, optimistic-ui, toast, error-surface]

# Dependency graph
requires:
  - phase: 05-screenshots-procedure-review-trim
    plan: 07
    provides: "Toast-undo delete store + mid-procedure gallery + screenshot timeline"
provides:
  - "Synchronous local-state removal for the × delete affordance on screenshots in both ProcedureRoom and ProcedureReview"
  - "Post-IPC committed event channel + refresh-on-failure re-sync in useProcedures"
  - "Visible toast.error when screenshots.delete IPC fails (replaces silent console.error)"
affects:
  - "Phase 5 UAT step 7 (delete a screenshot, verify removal) becomes re-runnable end-to-end"
  - "Phase 5 screenshots UX across both ProcedureRoom (mid-procedure) + ProcedureReview (post-recording)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optimistic-UI local-state filter for renderer-side store mutations before a delayed IPC"
    - "Toast-store committed-event channel so consumer hooks can re-sync after the IPC settles (success or failure)"
    - "Dynamic import('sonner') in a store keeps the store decoupled from the rendering layer at module init time"

key-files:
  created:
    - tests/renderer/hooks/useScreenshotIntake.test.ts
  modified:
    - src/renderer/src/hooks/useScreenshotIntake.ts
    - src/renderer/src/hooks/useProcedures.ts
    - src/renderer/src/pages/ProcedureRoom.tsx
    - src/renderer/src/pages/ProcedureReview.tsx
    - src/renderer/src/store/screenshot-toast.ts
    - tests/renderer/pages/procedure-room-timer.test.tsx
    - tests/renderer/pages/ProcedureReview.test.tsx

key-decisions:
  - "Ponytail: remove(id) is a pure local-state filter — no IPC, no toast-store coupling. The hook returns remove() next to the existing capture() so the gallery-side consumer never reaches into the toast store directly."
  - "Ponytail: useProcedures subscribes to the toast store's committed event and calls refresh() on matches. A failed IPC re-fetches and restores the row; a successful IPC is a no-op refetch that overwrites with the same canonical list."
  - "Ponytail: dynamic import('sonner') inside commitDelete's catch block keeps the store from importing the rendering layer at module init — same shape as the existing sonner usage in useProcedures.ts."
  - "Drop the void refresh().then(() => undefined) line from ProcedureReview.handleDelete. It was a no-op for delete (the IPC hadn't fired yet, so the DB still returned the row) and the misleading comment claimed 'optimistic UI' that was never implemented."
  - "Mirror the same Undo path in ProcedureRoom and ProcedureReview: cancel the pending IPC + call the local hook's refresh() so the still-present DB row re-appears without a state restore. Refresh-after-undo is symmetric and uses the same code path as a post-IPC re-sync."

patterns-established:
  - "Pattern: any hook that owns a list with a delayed-mutation lifecycle (delete, archive, ...) needs a synchronous local remove + an IPC-committed re-sync. Implementation is a 6-line pair: remove() filter + useEffect on subscribeCommitted that calls refresh()."

requirements-completed: [SCRN-02]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "useScreenshotIntake remove(id) and refresh() actions; pure local-state filters; no IPC from remove"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: tests/renderer/hooks/useScreenshotIntake.test.ts#remove(id) filters the local screenshots array and does NOT call the delete IPC (G-05-13)
        status: pass
      - kind: unit
        ref: tests/renderer/hooks/useScreenshotIntake.test.ts#remove(id) for an unknown id is a no-op (G-05-13)
        status: pass
      - kind: unit
        ref: tests/renderer/hooks/useScreenshotIntake.test.ts#refresh() re-fetches from IPC and replaces local state (G-05-13)
        status: pass
    human_judgment: false
  - id: D2
    description: "useProcedures removeScreenshot(id) action + subscribeCommitted re-sync"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#× click removes the thumbnail from the timeline DOM synchronously
        status: pass
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#Undo restores the thumbnail
        status: pass
    human_judgment: false
  - id: D3
    description: "ProcedureRoom.handleScreenshotDelete calls remove(s.id) synchronously before enqueueDelete"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: tests/renderer/pages/procedure-room-timer.test.tsx#clicking the × button on a gallery thumbnail enqueues a Toast-undo delete (extended with synchronous DOM-removal assertion)
        status: pass
    human_judgment: false
  - id: D4
    description: "ProcedureReview.handleDelete calls removeScreenshot(s.id) synchronously + drops the pre-IPC void refresh().then() no-op"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#× click removes the thumbnail from the timeline DOM synchronously
        status: pass
    human_judgment: false
  - id: D5
    description: "screenshot-toast store: subscribeCommitted event channel + toast.error surface on IPC failure"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#IPC failure fires toast.error
        status: pass
    human_judgment: false

# Metrics
duration: 8 min
completed: 2026-08-07
status: complete
---

# Phase 5 Plan 10: Screenshot Delete UX (G-05-13) Summary

**Synchronous local-state thumbnail removal + visible IPC failure toasts + post-IPC re-sync for the screenshot delete affordance in both ProcedureRoom and ProcedureReview.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-07T15:51:21Z
- **Completed:** 2026-08-07T15:59:34Z
- **Tasks:** 2
- **Files modified:** 8 (5 production, 3 test files; 1 new test file)

## Accomplishments

- `useScreenshotIntake.remove(id)` filters the hook's `screenshots[]` synchronously; `refresh()` re-fetches from the IPC. No IPC fired by `remove()` — the toast store still owns the delayed disk + DB delete.
- `useProcedures.removeScreenshot(id)` mirrors the same pattern (pure local-state filter). The hook subscribes to `screenshotToastStore.subscribeCommitted` and calls `refresh()` on a commit for the current `procedureId` — a failed IPC restores the row; a successful IPC is a no-op refetch.
- `ProcedureRoom.handleScreenshotDelete` now calls `screenshotIntake.remove(s.id)` BEFORE `enqueueDelete`. The Undo action calls `screenshotToastStore.undoDelete(s.id)` + `void screenshotIntake.refresh()`. The stale comment block that documented the bug as an "intentional design choice" is rewritten.
- `ProcedureReview.handleDelete` now calls `removeScreenshot(s.id)` BEFORE `enqueueDelete`. The pre-IPC `void refresh().then(() => undefined)` line is REMOVED. The misleading "optimistic UI" comment is rewritten. The Undo action calls `screenshotToastStore.undoDelete(s.id)` + `void refresh()`.
- `screenshotToastStore.commitDelete` now fires `toast.error(`Failed to delete screenshot: ${message}`)` via dynamic `import('sonner')` instead of a silent `console.error`. A new `CommittedDelete` type + `subscribeCommitted` event channel lets the renderer observe IPC outcomes for re-sync.
- New `tests/renderer/hooks/useScreenshotIntake.test.ts` with 3 tests (remove-filters, remove-unknown-noop, refresh-replaces). Extended `procedure-room-timer.test.tsx` × test with a synchronous DOM-removal assertion. New `describe('ProcedureReview gallery delete (G-05-13)')` block in `ProcedureReview.test.tsx` with 3 tests (synchronous DOM removal, Undo restore, IPC-failure toast.error).

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 contract-guard tests (G-05-13)** — `d3f0da7` (test)
2. **Task 2: Hook remove actions + handler synchronous removal + IPC failure toast** — `9423b15` (feat)

**Plan metadata:** `c587da5` (docs: complete plan)

_Note: Wave 0 RED-first per Plan 07 convention. Task 1 commits failing assertions (proves the contract is real, not vacuous); Task 2 flips the production code GREEN._

## Files Created/Modified

- `src/renderer/src/hooks/useScreenshotIntake.ts` — `remove(id)` and `refresh()` actions + updated return type
- `src/renderer/src/hooks/useProcedures.ts` — `removeScreenshot(id)` action + `subscribeCommitted` re-sync `useEffect` + `screenshotToastStore` import
- `src/renderer/src/store/screenshot-toast.ts` — `CommittedDelete` type, `subscribeCommitted` channel, `emitCommitted` helper, dynamic-import `toast.error` on IPC failure
- `src/renderer/src/pages/ProcedureRoom.tsx` — `handleScreenshotDelete` calls `screenshotIntake.remove(s.id)` synchronously + Undo triggers `refresh()`
- `src/renderer/src/pages/ProcedureReview.tsx` — `handleDelete` calls `removeScreenshot(s.id)` synchronously + drops pre-IPC `void refresh().then(...)`; Undo triggers `refresh()`
- `tests/renderer/hooks/useScreenshotIntake.test.ts` — NEW: 3 contract-guard tests for the new hook actions
- `tests/renderer/pages/procedure-room-timer.test.tsx` — extended × test with synchronous DOM-removal assertion
- `tests/renderer/pages/ProcedureReview.test.tsx` — new `describe('ProcedureReview gallery delete (G-05-13)')` block with 3 tests (DOM removal + Undo + IPC-failure toast.error)

## Decisions Made

- **Pure local-state `remove` is the smallest correct fix.** A `setScreenshots(prev => prev.filter(...))` is the only DOM-level change the doctor perceives. No IPC, no `useReducer`, no new hook surface — just one more action next to the existing `capture()`.
- **Re-sync is event-driven, not call-driven.** The toast store owns the 5s window + the IPC; a new `subscribeCommitted` channel surfaces the outcome. `useProcedures` listens and calls `refresh()` on match. Success is a no-op; failure restores the row. The alternative (passing an `onCommitted` callback into `enqueueDelete`) would couple the page to the toast store; the event channel keeps the surface a `Set<listener>`-style subscription.
- **Dynamic `import('sonner')` mirrors the existing pattern.** The toast store already imports nothing from the rendering layer at module init. A `void import('sonner').then(...)` call from the catch block keeps that invariant while avoiding a static dep on `sonner` from the store.
- **Drop `void refresh().then(...)` in ProcedureReview.** It was a no-op for delete (the IPC hadn't fired yet; the DB still returned the row) and the misleading comment claimed "optimistic UI" that was never implemented. Removing it is a one-line cleanup that doesn't change the runtime path; the synchronous `removeScreenshot` is the real fix.

## Deviations from Plan

None — plan executed exactly as written. The contract-guard tests are RED before the production fix and GREEN after; both Wave 0 and the production fix shipped in their prescribed order with the prescribed commit message format.

## Issues Encountered

None.

## Threat Flags

None.

## Next Phase Readiness

G-05-13 is closed. The delete affordance is now genuinely observable end-to-end: the thumbnail disappears immediately, the toast shows with an Undo button, clicking Undo within 5s restores the thumbnail via `refresh()`, and an IPC failure surfaces as `toast.error` (not silent console.error). Plan 11 (G-05-14, lightbox full-size JPEG) is the remaining gap-closure plan for Phase 5.

## Self-Check: PASSED

- All 3 task commits (`d3f0da7`, `9423b15`, `c587da5`) present in `git log --oneline`.
- New `tests/renderer/hooks/useScreenshotIntake.test.ts` exists and is collected by vitest.
- Plan files (`05-10-PLAN.md`, `05-10-SUMMARY.md`, `STATE.md`, `ROADMAP.md`) staged in the docs commit.
- Full unit suite: 511 tests pass across 64 files (no regressions; new 7 assertions = 504 + 7).

---
*Phase: 05-screenshots-procedure-review-trim*
*Completed: 2026-08-07*
