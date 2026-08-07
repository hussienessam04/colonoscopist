---
status: diagnosed
trigger: "G-05-13 from 05-UAT.md — 'delete btn show toast msg but dont remove them' — × button on screenshot thumbnail shows the 'Screenshot deleted' toast but the screenshot remains visible in the timeline. After Plan 05-07 shipped gallery + delete + lightbox, this UAT gap was discovered."
created: 2026-08-07
updated: 2026-08-07
---

## Current Focus

hypothesis: Click × → handler fires → toast-undo store enqueues + schedules a 5s setTimeout → toast appears immediately. The renderer's `screenshots[]` state is NEVER mutated synchronously, so the thumbnail stays in the timeline until a refresh happens. In ProcedureRoom no refresh ever happens in-session; in ProcedureReview the `refresh()` call happens before the IPC has fired (still 5s away) so the DB still returns the same row and the optimistic comment is a lie.
test: Trace code path × click → onDelete → handler → state mutation → IPC. Verify each side.
expecting: One of three states — (1) hook exposes no `remove(id)` and no caller mutates state synchronously, OR (2) callers mutate but the toast-store enqueue short-circuits the mutation, OR (3) callers mutate and the toast-store is fine.
next_action: Write diagnosis to disk and return ROOT CAUSE FOUND.

## Symptoms

expected: |
  Clicking × on a screenshot thumbnail makes the thumbnail disappear from the timeline immediately and a "Screenshot deleted" toast with an Undo affordance appears. Clicking Undo within 5s restores the row.
actual: |
  Clicking × shows the toast but the screenshot thumbnail remains visible in the timeline. The toast disappears after ~5s. The DB state is unknown — likely the row IS being deleted 5s later via the toast-store's setTimeout, but the UI never reflects the change. Re-entering the page (or hard-refreshing the procedure) would show the row gone, confirming the IPC fires but the renderer's `screenshots[]` state is not synced.
errors: |
  No console error (the catch block in `screenshotToastStore.commitDelete` only `console.error`s; the renderer's `useScreenshotIntake` never sees the IPC result).
reproduction: |
  1. `npm run dev` to start Electron
  2. Patients list → row actions → "Open Procedure Preview" → Record 30s → Stop
  3. Procedure Review screen → click +Capture (post-recording capture path)
  4. Click × on the captured screenshot in the timeline
  5. Toast appears with "Screenshot deleted" + Undo button
  6. Expected: screenshot disappears from timeline immediately; Undo restores it within 5s
  7. Actual: screenshot stays in timeline; toast shows but no UI mutation
started: |
  Plan 05-07 (G-05-8 + G-05-10) — gallery + delete discoverability + Toast-undo plumbing + lightbox. The delete handler in both pages has been broken since this plan shipped.

## Eliminated

- hypothesis: The IPC `screenshots.delete` is failing silently and the screenshot stays in the DB and in the UI.
  evidence: |
    The IPC handler `src/main/ipc/screenshots.ts:177-207` deletes the row + unlinks the file + writes an audit row. It's straightforward and the `screenshots.delete` channel is wired. The toast store's `commitDelete` is the only caller; its catch block only logs. If the IPC were failing, the DB row would also stay. The user observation that the row disappears after a page navigation confirms the IPC succeeds eventually.
  timestamp: 2026-08-07

- hypothesis: `screenshotToastStore.enqueueDelete` schedules the IPC and the IPC fires but a renderer-side bug returns the wrong screenshots.
  evidence: |
    `enqueueDelete` (screenshot-toast.ts:44-58) only mutates the store's own `pending[]` state and arms a setTimeout. The IPC fires from `commitDelete` (screenshot-toast.ts:74-87). Neither path touches the `useScreenshotIntake` hook's `screenshots[]` state or the `useProcedures` hook's `screenshots[]` state. So even when the IPC succeeds, the consumer hook's state is never told.
  timestamp: 2026-08-07

- hypothesis: The handler swallows the IPC error in a catch block.
  evidence: |
    The handlers (`ProcedureRoom.handleScreenshotDelete`, `ProcedureReview.handleDelete`) don't have try/catch around `enqueueDelete`; the only catch is inside `commitDelete` in the store. The store's catch is the swallow — it `console.error`s but doesn't surface a toast or roll back any local state.
  timestamp: 2026-08-07

- hypothesis: `useScreenshotIntake` exposes a `remove(id)` action but the handler doesn't call it.
  evidence: |
    Read the entire file (`useScreenshotIntake.ts:33-99`). The hook returns `{ screenshots, capture, loading, error }` — there is no `remove` / `delete` action exported. The only `setScreenshots` calls are (a) initial load on `procedureId` change, (b) append on `capture()`. There is no way for any caller to remove a screenshot from this hook's state.
  timestamp: 2026-08-07

## Evidence

- timestamp: 2026-08-07
  checked: `src/renderer/src/hooks/useScreenshotIntake.ts` (full file)
  found: |
    Hook returns only `{ screenshots, capture, loading, error }`. The `useState` for `screenshots` is mutated only on:
    - `useEffect([procedureId])` initial load: `setScreenshots(rows)` (line 52)
    - `capture()`: `setScreenshots((prev) => [...prev, created])` (line 88)
    No `remove` / `delete` action exists. The `ScreenshotIntakeResult` type (lines 26-31) does not declare one.
  implication: |
    ProcedureRoom cannot remove a screenshot from the gallery's local state at all. The hook is append-only.

- timestamp: 2026-08-07
  checked: `src/renderer/src/store/screenshot-toast.ts` (full file)
  found: |
    `enqueueDelete` (lines 44-58) only mutates the store's own `pending[]` and arms a setTimeout. `commitDelete` (lines 74-87) fires `window.api.screenshots.delete({id})` but never reaches into `useScreenshotIntake` or `useProcedures` to update consumer state. Catch block (lines 82-86) only `console.error`s — silent failure on the renderer.
  implication: |
    The toast store is an isolated 5s windowed IPC scheduler with no coupling to consumer state. Optimistic UI is the consumer's responsibility; neither consumer implements it.

- timestamp: 2026-08-07
  checked: `src/renderer/src/pages/ProcedureRoom.tsx:175-184`
  found: |
    `handleScreenshotDelete(s)` does:
    1. `screenshotToastStore.enqueueDelete(s.id, s.procedureId)` — schedule IPC
    2. `toast('Screenshot deleted at ...', { duration: 5_000, action: { label: 'Undo', onClick: () => undoDelete(s.id) } })`
    No local state mutation. The comment block (lines 168-174) explicitly acknowledges: "the row stays visible until the next list refresh, which the next page mount triggers — same UX as the review timeline".
  implication: |
    The dev who wrote the code knew the row would stay visible and relied on a "next page mount" to trigger a refresh. During an active recording session the user does NOT remount, so the row stays visible for the rest of the session. The comment is the bug documentation in plain English.

- timestamp: 2026-08-07
  checked: `src/renderer/src/pages/ProcedureReview.tsx:220-233`
  found: |
    `handleDelete(s)` does:
    1. `void refresh().then(() => undefined)` — fire-and-forget a re-fetch
    2. `screenshotToastStore.enqueueDelete(s.id, s.procedureId)` — schedule IPC
    3. `toast('Screenshot deleted at ...', { duration: 5_000, action: ... })`
    No local optimistic mutation. The comment at line 222 says "Optimistic UI: remove the screenshot from local state immediately so the × visual feels instant (D-12). The Toast store schedules the actual IPC delete after 5s". But the code only calls `refresh()` (a re-fetch that returns the row because the IPC hasn't fired yet) and enqueues. The optimistic UI described in the comment is not implemented.
  implication: |
    ProcedureReview's handler is the same broken pattern as ProcedureRoom. The `refresh()` call is a no-op for delete because at the moment it executes, the DB row still exists (the toast-store's setTimeout hasn't fired). The comment lies about the behavior.

- timestamp: 2026-08-07
  checked: `src/renderer/src/hooks/useProcedures.ts:53-87`
  found: |
    `refresh()` re-fetches `procedures.get`, `procedures.listSegments`, `procedureNotes.list`, `screenshots.list` in parallel and overwrites local state with the IPC response. When called from `handleDelete` immediately, the IPC has not yet deleted the row, so the response still includes the to-be-deleted screenshot and the local state is unchanged.
  implication: |
    `refresh()` cannot serve as the "remove from local state" mechanism in a Toast-undo design where the IPC delete is delayed. Refresh after the toast store fires the IPC would work — but no one calls it then.

- timestamp: 2026-08-07
  checked: `src/main/ipc/screenshots.ts:177-207`
  found: |
    `SCREENSHOTS_DELETE` handler correctly deletes the row + unlinks the file + audits. No bug here.
  implication: |
    IPC layer is correct. The renderer-side consumer never observes the deletion, but the disk + DB are consistent.

- timestamp: 2026-08-07
  checked: `tests/renderer/pages/procedure-room-timer.test.tsx:615-650`
  found: |
    The "clicking the × button on a gallery thumbnail enqueues a Toast-undo delete" test only asserts:
    - `screenshotToastStore.__getState().pending` has length 1 with the right id
    - `screenshotToastStore.undoDelete(21)` clears the entry
    The test never checks the rendered gallery DOM (no `getAllByTestId('screenshot-thumbnail')` count assertion after the click). It verifies the store, not the UI.
  implication: |
    Test masking. The mock-resolved IPC and the store-only assertion mean the gallery UI staleness is invisible to the test suite. The green test in plan 05-07 cannot detect this bug.

- timestamp: 2026-08-07
  checked: `tests/renderer/pages/ProcedureReview.test.tsx`
  found: |
    No test for the delete flow in ProcedureReview at all (grep for `delete|enqueue|handleDelete` returns no matches in this file).
  implication: |
    The second consumer of the same broken pattern has zero test coverage. There is no test that even attempts to verify a delete on the review screen.

## Resolution

root_cause: |
  Both delete handlers (`ProcedureRoom.handleScreenshotDelete` at `src/renderer/src/pages/ProcedureRoom.tsx:175-184` and `ProcedureReview.handleDelete` at `src/renderer/src/pages/ProcedureReview.tsx:220-233`) rely on the toast-undo store to drive a delayed IPC delete 5 seconds after the click, but neither handler performs a synchronous local-state mutation to remove the thumbnail from the `screenshots[]` array. `useScreenshotIntake` (`src/renderer/src/hooks/useScreenshotIntake.ts:33-99`) does not expose a `remove(id)` action (only `capture`, `loading`, `error`); `useProcedures.refresh()` (`src/renderer/src/hooks/useProcedures.ts:53-87`) re-fetches before the IPC has fired, so the row is still in the DB and the response is identical. The toast-undo store's `enqueueDelete` (`src/renderer/src/store/screenshot-toast.ts:44-58`) only schedules the IPC — it has no reference to the consumer hooks and cannot mutate their state. As a result, the toast appears (UI shows feedback), but the timeline thumbnail stays mounted until the consumer component remounts (which never happens during a recording session or a review session).
fix: |
  (Not applied — diagnose-only.) Two coupled changes are required:
  1. Add `remove(screenshotId: number): void` to `useScreenshotIntake` that calls `setScreenshots((prev) => prev.filter((s) => s.id !== screenshotId))`. Call it from `handleScreenshotDelete` synchronously, BEFORE `screenshotToastStore.enqueueDelete`.
  2. In `ProcedureReview.handleDelete`, perform an optimistic `setScreenshots((rows) => rows.filter((r) => r.id !== s.id))` synchronously, BEFORE `enqueueDelete`. Drop the `void refresh()` call (or move it to fire only on toast-store `commitDelete` so undo restores the row).
  Plus: surface IPC failures as a `toast.error` (the `commitDelete` catch block currently only `console.error`s). Undo re-insert requires a soft-delete or a `restore` path; current repo is hard delete, so undo is a separate gap (G-05-13 missing-list item #3) — flag separately.
verification: |
  Manual repro: record 30s, +Capture, click × → thumbnail disappears in <16ms; toast shows; Undo within 5s restores the thumbnail. Reload the procedure → DB row count matches what the UI shows. Add a renderer test that asserts the gallery `<ScreenshotTimeline>` has one fewer `<ScreenshotThumbnail>` after a × click, and that the test mocks the toast-store `commitDelete` so the IPC isn't actually fired during the test.
files_changed: []
guardrail_verdict: not_applicable — diagnose-only
oracle_type: derived (UI list length must equal IPC `screenshots.list` result; toast must show)
test_coverage_gap: |
  - `tests/renderer/pages/procedure-room-timer.test.tsx:615-650` only asserts the store's `pending` array, not the rendered gallery DOM.
  - `tests/renderer/pages/ProcedureReview.test.tsx` has no delete test.
  - No `tests/renderer/store/screenshot-toast.test.ts` exists; no `tests/renderer/hooks/useScreenshotIntake.test.ts` exists.
  The store's `commitDelete` IPC failure path is also untested (no rejection-case assertion).

## Files Involved

- `src/renderer/src/hooks/useScreenshotIntake.ts:33-99` — Hook returns `{ screenshots, capture, loading, error }`. No `remove` action. Append-only state. The "transport for the capture action" design intentionally excludes mutation, but the gallery delete UX requires a remove path the hook does not provide.
- `src/renderer/src/store/screenshot-toast.ts:44-87` — `enqueueDelete` schedules IPC + stores pending entry; `commitDelete` fires IPC + removes pending entry. Neither path updates the consumer's `screenshots[]`. Silent catch on failure.
- `src/renderer/src/pages/ProcedureRoom.tsx:175-184` — Handler calls only `enqueueDelete` + `toast`. The comment at lines 168-174 documents the bug as an intentional design choice ("the row stays visible until the next list refresh, which the next page mount triggers") that doesn't match the in-session UX.
- `src/renderer/src/pages/ProcedureReview.tsx:220-233` — Handler calls `void refresh().then(...)` + `enqueueDelete` + `toast`. The comment at line 222 claims "Optimistic UI: remove the screenshot from local state immediately" but the code does not implement optimistic removal. `refresh()` re-fetches a list that still contains the row.
- `src/renderer/src/components/ScreenshotTimeline.tsx:42-82` — Pure presentational; renders the `screenshots` array. Correctly re-renders if the array changes, but the array is never mutated by any of its consumers. No bug here, but the chain of trust ends at this component.
- `src/renderer/src/components/ScreenshotThumbnail.tsx:54-57` — `handleDelete` stops propagation, calls `onDelete?.(screenshot)`. Correctly wires to the parent's handler; no bug here.
- `src/shared/ipc-contract.ts:353-358` — `screenshots.delete({ id })` contract is correct. No bug.
- `src/main/ipc/screenshots.ts:177-207` — IPC handler deletes row + unlinks file + audits. Correct.
- `tests/renderer/pages/procedure-room-timer.test.tsx:615-650` — Test asserts only the store's `pending` array. Does not assert gallery DOM. Test masking.
- `tests/renderer/pages/ProcedureReview.test.tsx` — No delete test. Test gap.
- `tests/renderer/setup.ts:148` — `delete: vi.fn().mockResolvedValue(undefined)` — mock return shape is wrong (real contract is `Promise<{ ok: true }>`), but this is unrelated to G-05-13. Flag separately.
