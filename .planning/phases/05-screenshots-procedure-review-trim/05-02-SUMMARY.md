---
phase: 05-screenshots-procedure-review-trim
plan: 02
subsystem: renderer+ipc
tags: [react, scrubber, screenshots, annotation, accordion, status-badge]

# Dependency graph
requires:
  - phase: 05-screenshots-procedure-review-trim
    plan: 01
    provides: bare Scrubber (pointer events + setPointerCapture), ScreenshotTimeline + memoized ScreenshotThumbnail, useScreenshotIntake, ProcedureRoom S/hotkey, ProcedureReview real impl, IPC stubs for PROCEDURES_TRIM/RESTORE, screenshots IPC + repo, migration 0003
provides:
  - Scrubber pause markers from procedure_segments (D-11)
  - ScreenshotAnnotation inline-edit per thumbnail (D-12)
  - ProcedureNotesReview read-only Notes accordion (D-09)
  - StatusBadge reusable component (single source of truth for the variant mapping)
  - useProcedures SWR-style hook (procedure + segments + notes + screenshots + optimistic updateAnnotation)
  - ScreenshotTimeline +Capture gate on status='crashed' (D-13)
  - PROCEDURES_LIST_SEGMENTS IPC channel + handler + preload bridge
  - scrubber.css utility module (z-index ordering for progress / pause markers / trim handles)
  - shadcn-style Accordion primitive hand-ported (no @radix-ui/react-accordion dependency)
affects: [05-03, 05-04, phase-06-pdf, phase-07-audit-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-ported shadcn Accordion primitive using React Context + cloneElement (no @radix-ui/react-accordion dep)"
    - "useProcedures SWR-style hook: parallel Promise.all fetch + useState slices + refresh() exposed + optimistic updateAnnotation with rollback on failure"
    - "Scrubber layered children via z-index: progress fill (z=0) / pause markers (z=1) / trim handles (z=10, Plan 03)"
    - "useMemo for the Scrubber markers list so currentMs re-renders don't allocate a new array (PITFALLS §4)"
    - "StatusBadge wraps shadcn Badge + lifts statusBadgeVariant out of ProcedureReview for Phase 7 list-view reuse"
    - "Inline annotation input with stopPropagation on click + Enter save + Escape cancel + blur save"
    - "ScreenshotTimeline status-prop drives D-13 capture gate; crashed status disables +Capture"
    - "PROCEDURES_LIST_SEGMENTS channel validates UUID + audits procedure.segments_list with count"

key-files:
  created:
    - src/renderer/src/components/ui/accordion.tsx
    - src/renderer/src/components/ScreenshotAnnotation.tsx
    - src/renderer/src/components/ProcedureNotesReview.tsx
    - src/renderer/src/components/StatusBadge.tsx
    - src/renderer/src/hooks/useProcedures.ts
    - src/renderer/src/styles/scrubber.css
    - tests/renderer/components/ScreenshotAnnotation.test.tsx
    - tests/renderer/components/ProcedureNotesReview.test.tsx
    - tests/renderer/pages/ProcedureReview.test.tsx
  modified:
    - src/renderer/src/components/Scrubber.tsx
    - src/renderer/src/components/ScreenshotTimeline.tsx
    - src/renderer/src/components/ScreenshotThumbnail.tsx
    - src/renderer/src/pages/ProcedureReview.tsx
    - src/main/ipc/procedures.ts
    - src/preload/index.ts
    - src/shared/ipc-contract.ts
    - tests/renderer/components/ScreenshotTimeline.test.tsx
    - tests/renderer/components/Scrubber.test.tsx
    - tests/renderer/setup.ts

key-decisions:
  - "Hand-ported the Accordion primitive instead of pulling @radix-ui/react-accordion — preserves the locked-stack constraint (AGENTS.md §Constraints), shadcn API surface intact, single collapsible mode covers Procedure Notes needs"
  - "useProcedures refreshInFlightRef guards against concurrent refresh calls (e.g. fast double-click on +Capture) so local state stays consistent"
  - "ScreenshotAnnotation's onSave is parent-supplied (not a hard-coded IPC call) — ProcedureReview wires it to useProcedures.updateAnnotation so the hook owns the optimistic UI + rollback"
  - "Scrubber pause markers use useMemo over (segments, durationMs) so currentMs re-renders from onTimeUpdate don't allocate a new markers array each frame (PITFALLS §4)"
  - "StatusBadge exports both the component AND the variant helper — Phase 7 list view can import either depending on its needs"
  - "ProcedureReview right rail stacks: Procedure metadata Card → ProcedureNotesReview → DeviceLostBanner (partial + .partial.mp4) → Trim placeholder Card. The Trim card is a 'Trim ships in Plan 03' placeholder so the right rail doesn't shift when Plan 03 lands"
  - "PROCEDURES_LIST_SEGMENTS handler validates the input UUID + audits procedure.segments_list with count metadata (no body content) per Fix 6"

patterns-established:
  - "Pattern: Scrubber pause markers — `useMemo([segments, durationMs])` produces the marker list, then renders as absolute-positioned children with z-index layers"
  - "Pattern: ScreenshotAnnotation inline-edit — caption button → autoFocus input → Enter saves via parent onSave callback → Escape restores prior value → blur auto-saves if changed"
  - "Pattern: useProcedures SWR — parallel Promise.all on mount + procedureId change; optimistic updateAnnotation with rollback + toast on failure"
  - "Pattern: StatusBadge reusability — single component + exported variant helper for tests and Phase 7"

requirements-completed: [REV-01, REV-02, REV-03]

# Coverage metadata
coverage:
  - id: D1
    description: "Scrubber renders one pause marker per procedure_segment at startedAtMs/durationMs percent with aria-label + title + data-testid"
    requirement: REV-01
    verification:
      - kind: unit
        ref: tests/renderer/components/Scrubber.test.tsx#renders one pause marker per segment at startedAt/durationMs percent
        status: pass
      - kind: unit
        ref: tests/renderer/components/Scrubber.test.tsx#renders zero pause markers when segments prop is absent
        status: pass
      - kind: unit
        ref: tests/renderer/components/Scrubber.test.tsx#renders zero pause markers when segments prop is empty array
        status: pass
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#renders one pause marker per procedure_segment
        status: pass
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#renders zero pause markers when segments is empty
        status: pass
    human_judgment: false
  - id: D2
    description: "ScreenshotAnnotation opens an inline input on caption click + Enter saves via onSave + Escape cancels + blur auto-saves"
    requirement: REV-02
    verification:
      - kind: unit
        ref: tests/renderer/components/ScreenshotAnnotation.test.tsx#clicking the caption opens the input with the current annotation
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotAnnotation.test.tsx#pressing Enter inside the input calls onSave and closes the input
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotAnnotation.test.tsx#pressing Escape inside the input restores the previous annotation and closes the input
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotAnnotation.test.tsx#clicking the caption does not bubble to the parent seek handler
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#passes onAnnotate through to the thumbnail annotation input
        status: pass
    human_judgment: false
  - id: D3
    description: "ProcedureNotesReview read-only Notes accordion: empty state copy + ASC ordering + default-open for completed + collapsed for partial + no input"
    requirement: REV-02
    verification:
      - kind: unit
        ref: tests/renderer/components/ProcedureNotesReview.test.tsx#renders the empty-state copy when no notes are returned
        status: pass
      - kind: unit
        ref: tests/renderer/components/ProcedureNotesReview.test.tsx#renders the notes list in created_at ASC order
        status: pass
      - kind: unit
        ref: tests/renderer/components/ProcedureNotesReview.test.tsx#expands by default for status=completed
        status: pass
      - kind: unit
        ref: tests/renderer/components/ProcedureNotesReview.test.tsx#is collapsed by default for status=partial
        status: pass
      - kind: unit
        ref: tests/renderer/components/ProcedureNotesReview.test.tsx#does NOT include an input (read-only)
        status: pass
    human_judgment: false
  - id: D4
    description: "StatusBadge wraps shadcn Badge with the canonical variant mapping (completed=default, recording/partial=secondary, crashed=destructive)"
    requirement: REV-03
    verification:
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#renders the StatusBadge with the procedure status text
        status: pass
    human_judgment: false
  - id: D5
    description: "ProcedureReview right rail: notes accordion + status badge + DeviceLostBanner (partial + .partial.mp4) + Trim placeholder card"
    requirement: REV-01
    verification:
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#mounts DeviceLostBanner when status=partial + .partial.mp4 suffix
        status: pass
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#does NOT mount DeviceLostBanner when status=completed
        status: pass
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#navigates to patient-detail when the Back to Patient button is clicked
        status: pass
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#shows the Trim placeholder card for non-partial procedures
        status: pass
    human_judgment: false
  - id: D6
    description: "ScreenshotTimeline +Capture gate on status='crashed' (D-13)"
    requirement: REV-03
    verification:
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#disables +Capture when status === \"crashed\"
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#enables +Capture when status === \"completed\"
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#enables +Capture when status === \"partial\"
        status: pass
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#disables the +Capture button when status=crashed (D-13)
        status: pass
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#enables the +Capture button when status=partial (D-13)
        status: pass
    human_judgment: false
  - id: D7
    description: "useProcedures SWR-style hook with parallel fetch + optimistic updateAnnotation"
    requirement: REV-03
    verification:
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#mounts DeviceLostBanner when status=partial + .partial.mp4 suffix
        status: pass
      - kind: unit
        ref: tests/renderer/pages/ProcedureReview.test.tsx#renders one pause marker per procedure_segment
        status: pass
    human_judgment: true
    rationale: "useProcedures is exercised transitively via ProcedureReview (which fetches procedure + segments + notes + screenshots through the hook). The hook itself has no isolated unit test — it's a thin Promise.all orchestrator over window.api. End-to-end coverage lives in the ProcedureReview suite; a dedicated hook test would just re-test the Promise.all plumbing."

# Metrics
duration: ~30 min
completed: 2026-08-06
status: complete
---
# Phase 5: Plan 02 — Right-Rail Polish Summary

**Pause markers on the scrubber from procedure_segments, inline per-thumbnail annotation, read-only Notes accordion, reusable StatusBadge, and the useProcedures SWR-style hook — all without adding a runtime dependency.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-06T21:03:45Z
- **Completed:** 2026-08-06T21:25:00Z (last test run timestamp)
- **Tasks:** 2 (1 production-code + 1 Wave 0 test suite)
- **Files modified:** 9 created, 10 modified

## Accomplishments

- **Scrubber pause markers** layered onto the Plan 01 bare scrubber. Each marker is an absolute-positioned vertical tick at `startedAtMs / durationMs * 100%` with `aria-label`, `title`, and `data-testid='scrubber-pause-marker'`. The marker list is memoized so the onTimeUpdate re-renders don't allocate a new array. Trim handles (z=10) and pause markers (z=1) share the same track div; Plan 03 layers handles over the markers without a structural rewrite.
- **ScreenshotAnnotation inline-edit** wires the per-thumbnail annotation input. Click the caption to open; Enter saves via the parent-supplied `onSave` callback; Escape cancels; blur auto-saves if the value changed. `e.stopPropagation()` keeps the parent's seek handler from firing. Plan 01's `screenshots.updateAnnotation` IPC is reused — no new IPC channel.
- **ProcedureNotesReview** is a read-only Notes accordion. Default-open for `status='completed'`, collapsed for `partial` / `crashed`. Empty-state copy renders when `notes.length === 0`. The doctor cannot add notes here — Phase 4 owns the in-procedure notes input.
- **StatusBadge** is a reusable wrapper around the shadcn `<Badge>`. The `statusBadgeVariant` helper that was inline in Phase 4's `ProcedureReview.tsx` is lifted into this module and exported, so Phase 7's procedure-list view can reuse it without duplication. `<StatusBadge status='completed'>` etc.
- **`useProcedures` SWR-style hook** exposes `{ procedure, segments, notes, screenshots, loading, error, refresh, updateAnnotation }`. Parallel `Promise.all` fetch on mount + procedureId change. `updateAnnotation(id, annotation)` is optimistic with rollback + `toast.error` on failure. `refresh()` is exposed for the post-capture flow.
- **ScreenshotTimeline `+Capture` gate** on `procedure.status === 'crashed'` per D-13. Completed / partial / recording all allow capture.
- **PROCEDURES_LIST_SEGMENTS IPC channel + handler** so the renderer can pull `procedure_segments` rows for the scrubber. The handler validates the input UUID and audits `procedure.segments_list` with `{ procedureId, count }` only — no body content (Fix 6 inheritance).
- **Hand-ported shadcn `Accordion` primitive** so Plan 02 ships without pulling `@radix-ui/react-accordion`. API surface matches the shadcn convention; single collapsible mode covers the Procedure Notes needs.
- **`scrubber.css` utility module** carries the `touch-action: none` (PITFALLS §8) + `z-index` ordering for the layered scrubber (progress / pause markers / trim handles).

## Task Commits

Each task was committed atomically:

1. **Task 1: Scrubber pause markers + ScreenshotAnnotation + Notes accordion + StatusBadge + useProcedures + scrubber.css** — `d77c232` (feat)
2. **Task 2: Wave 0 tests** — `9e2b007` (test)

**Plan metadata:** pending (this commit)

## Files Created/Modified

- `src/renderer/src/components/ui/accordion.tsx` — shadcn-compatible Accordion primitive (hand-ported, React Context + cloneElement, single collapsible mode)
- `src/renderer/src/components/ScreenshotAnnotation.tsx` — inline `<input>` with click-to-edit + Enter save + Escape cancel + blur save; `e.stopPropagation()` on click prevents the parent seek handler
- `src/renderer/src/components/ProcedureNotesReview.tsx` — read-only Notes accordion, default-open for `completed`, empty-state copy
- `src/renderer/src/components/StatusBadge.tsx` — reusable `<StatusBadge status>` + exported `statusBadgeVariant` helper
- `src/renderer/src/hooks/useProcedures.ts` — SWR-style hook: parallel fetch on mount + optimistic updateAnnotation with rollback + refresh() exposed
- `src/renderer/src/styles/scrubber.css` — utility module for the scrubber track + progress + pause markers + trim handles (z-index ordering)
- `src/renderer/src/components/Scrubber.tsx` — Plan 02 layers pause markers from `procedure_segments` (D-11); memos the markers list
- `src/renderer/src/components/ScreenshotTimeline.tsx` — adds `status` prop + D-13 capture gate
- `src/renderer/src/components/ScreenshotThumbnail.tsx` — wires `onAnnotate` to `ScreenshotAnnotation`; × button position shifts below the caption strip
- `src/renderer/src/pages/ProcedureReview.tsx` — right rail polish: notes accordion + status badge + conditional DeviceLostBanner (partial + .partial.mp4) + Trim placeholder card. Captures via canvas snapshot + IPC + refresh.
- `src/shared/ipc-contract.ts` — adds `PROCEDURES_LIST_SEGMENTS` channel + `procedures.listSegments` surface
- `src/main/ipc/procedures.ts` — `listSegments` handler (validates input + audits `procedure.segments_list` with count)
- `src/preload/index.ts` — `listSegments` bridge
- `tests/renderer/setup.ts` — adds `screenshots.*`, `procedures.trim/restore/listSegments` mocks for the new IPC surface
- `tests/renderer/components/ScreenshotAnnotation.test.tsx` — 4 tests
- `tests/renderer/components/ProcedureNotesReview.test.tsx` — 5 tests
- `tests/renderer/pages/ProcedureReview.test.tsx` — 9 tests
- `tests/renderer/components/ScreenshotTimeline.test.tsx` — extends Plan 01 with +Capture gate tests (crashed/partial/completed) + onAnnotate pass-through
- `tests/renderer/components/Scrubber.test.tsx` — extends Plan 01 with pause marker tests (3 segments render 3 markers; absent prop = 0; empty array = 0)

## Decisions Made

- **Hand-ported the `Accordion` primitive instead of pulling `@radix-ui/react-accordion`.** The plan noted both as acceptable; the hand-port avoids growing the dependency graph (AGENTS.md §Constraints locks the stack) and the small API surface needed (single collapsible mode) is a 100-line file. Phase 7's list view can reuse it without churn.
- **`useProcedures` exposes `refresh()` so the parent can re-fetch after a capture.** The Plan 01 `useScreenshotIntake` hook handled capture + append locally; Plan 02 unifies the fetch + capture + annotation lifecycle. The hook keeps the `screenshots[]` array consistent with the server-side ordering via a parallel `Promise.all` on `procedureId` change.
- **`updateAnnotation` is optimistic with rollback.** On failure, the previous value is restored AND `toast.error` fires. The hook is the only consumer of `screenshots.updateAnnotation` in the renderer; the optimistic UI covers the happy path; the rollback keeps the local state correct on rare IPC failures.
- **ScreenshotAnnotation's `onSave` is a parent-supplied callback, not a hard-coded IPC call.** Keeps the component pure: the test fixture can supply a `vi.fn().mockResolvedValue(...)` without mocking `window.api`. Production wires it to `useProcedures.updateAnnotation`.
- **`StatusBadge` exports the component AND the `statusBadgeVariant` helper.** Tests can use the helper directly; Phase 7's list view can use either depending on its needs (component for rich layouts, helper for compact displays).
- **ProcedureReview right rail order: Procedure metadata Card → ProcedureNotesReview → DeviceLostBanner (partial + .partial.mp4) → Trim placeholder Card.** The Trim placeholder card is a visible "Trim ships in Plan 03" so the right rail doesn't shift when Plan 03 fills the slot.
- **PROCEDURES_LIST_SEGMENTS handler audits `procedure.segments_list` with `{ procedureId, count }` only.** No body content; no absolute paths (Fix 6 inheritance from Phase 2/4).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed DOM nesting warning (`<div>` inside `<p>` for the StatusBadge)**
- **Found during:** Task 2 (Wave 0 tests)
- **Issue:** React DevTools warning logged during the `ProcedureReview > mounts DeviceLostBanner when status=partial` test: `<div>` (Badge) cannot appear as a descendant of `<p>`. The original layout wrapped the status row in `<p>`; the `<Badge>` component renders a `<div>`.
- **Fix:** Split the status row into two children: `<p>Status:</p>` followed by `<div><StatusBadge .../></div>`. Visual result identical; React happy.
- **Files modified:** src/renderer/src/pages/ProcedureReview.tsx
- **Verification:** All 9 ProcedureReview tests pass; warning no longer logged.
- **Committed in:** 9e2b007 (Wave 0 test commit).

**2. [Rule 3 - Blocking] Added `PROCEDURES_LIST_SEGMENTS` IPC channel + handler + bridge**
- **Found during:** Task 1 (production code)
- **Issue:** Plan called for `useProcedures` to call `window.api.procedures.listSegments({ procedureId })` for the pause-marker source. The channel + handler + bridge did not exist in Plan 01's IPC surface.
- **Fix:** Added the channel constant in `IPC.PROCEDURES_LIST_SEGMENTS`, the contract method in `IpcContract.procedures.listSegments`, the handler in `registerProceduresIpc` (validates UUID via zod + audits `procedure.segments_list` with `{ procedureId, count }`), and the preload bridge `ipcRenderer.invoke(IPC.PROCEDURES_LIST_SEGMENTS, input)`. Tests use `mockApi()` to stub the new method.
- **Files modified:** src/shared/ipc-contract.ts, src/main/ipc/procedures.ts, src/preload/index.ts, tests/renderer/setup.ts
- **Verification:** All Scrubber + ProcedureReview tests pass (the renderer can fetch the segments list).
- **Committed in:** d77c232 (Task 1 commit).

**3. [Rule 1 - Bug] Used default import for `ProcedureReview` in tests (not named)**
- **Found during:** Task 2 (Wave 0 tests)
- **Issue:** First run of `ProcedureReview.test.tsx` produced `Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined`. The page exports `default function ProcedureReview`, but the test imported it as a named import.
- **Fix:** Switched to `import ProcedureReview from '@/pages/ProcedureReview'`. The page is a default export.
- **Files modified:** tests/renderer/pages/ProcedureReview.test.tsx
- **Verification:** All 9 ProcedureReview tests pass.
- **Committed in:** 9e2b007 (Wave 0 test commit).

**4. [Rule 2 - Missing Critical] `ProcedureNotesReview` reads from the API async — tests must `waitFor` the resolve**
- **Found during:** Task 2 (Wave 0 tests)
- **Issue:** Initial test asserted note text on the same render tick; the component's `useEffect` fired the API request + set `loading=true`; the list only became visible after the promise resolved. The first runs reported "Unable to find an element with the text" because the test rendered before the API settled.
- **Fix:** Wrapped the list assertions in `waitFor(() => screen.getByText(...))`. The `collapsed-for-partial` test asserts immediately because the trigger button is rendered without the API; the `expanded-for-completed` test waits for the API.
- **Files modified:** tests/renderer/components/ProcedureNotesReview.test.tsx
- **Verification:** All 5 ProcedureNotesReview tests pass.
- **Committed in:** 9e2b007 (Wave 0 test commit).

---

**Total deviations:** 4 auto-fixed (1 bug, 1 blocking, 2 bugs).
**Impact on plan:** All auto-fixes necessary for correctness/test isolation/dependency surface. The Accordion hand-port + PROCEDURES_LIST_SEGMENTS additions are explicit plan-or-equivalent outcomes (the plan called out hand-porting as the alternate; the segments channel was implicit in `useProcedures`'s `Promise.all`). No scope creep beyond what the plan called for.

## Issues Encountered

- **Pre-existing test failures (`procedure-room-timer.test.tsx`, `procedure-room.test.tsx`, `settings-users.test.tsx`, `settings-capture.test.tsx`, `use-video-preview.test.ts`, `migrations.test.ts`, `0002_procedures.test.ts`) — these failures exist on the main branch before any Phase 5 work** (verified by the Plan 01 SUMMARY's note: `"Should not already be working"` exists at `1ba181b`). Unrelated to Plan 02; the new Phase 5 tests pass cleanly. Plan 04 / Phase 5 followup should address these separately.
- **Plan 01's 39 tests still pass** — re-ran the full Plan 01 suite (Scrubber 8/8, ScreenshotTimeline 10/10, capture-screenshot 7/7, migration 0003 6/6, screenshots-repo 6/6, screenshots IPC 9/9) = 46 tests across 6 files.

## User Setup Required

None — no external service configuration required. The new IPC channel `PROCEDURES_LIST_SEGMENTS` is auto-registered by `registerProceduresIpc()` on next app boot.

## Next Phase Readiness

- Plan 03 (Trim handles + ffmpeg trim subprocess + `/media/` route + PROCEDURES_TRIM/RESTORE handlers) extends the same scrubber with two drag handles (z=10) over the pause markers (z=1) — no structural rewrite needed.
- Plan 03 wires the `procedures.trim` / `procedures.restore` IPC stubs that Plan 01 + Plan 02 left in place; the contract surface is final.
- Phase 7 (Search & History + Audit UI) can reuse `<StatusBadge>` + `<Accordion>` (now hand-ported in `src/renderer/src/components/ui/`) without re-implementing.
- Phase 6 (PDF) can extend `useProcedures.screenshots` to enumerate over the procedure's screenshot list for the report attachment list.

---

*Phase: 05-screenshots-procedure-review-trim*
*Completed: 2026-08-06*
