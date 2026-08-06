---
phase: 05-screenshots-procedure-review-trim
plan: 01
subsystem: renderer+db+ipc
tags: [electron, sqlite, react, screenshots, scrubber, review]

# Dependency graph
requires:
  - phase: 04-recording-timer-device-lost
    provides: procedures schema + repo + IPC, recording store, PreviewServer, RecordingControlsBar visual language
provides:
  - screenshots table + procedures.video_path_original migration 0003
  - screenshotsRepo + IPC handlers (add/list/delete/updateAnnotation)
  - Screenshot IPC contract surface (api.screenshots.*)
  - Stub IPC handlers for procedures.trim + procedures.restore (throwing IPC_NOT_IMPLEMENTED)
  - Render-side captureScreenshot lib (canvas + JPEG q=0.85)
  - Bare Scrubber (pointer-events + setPointerCapture) + ScreenshotTimeline + memoized ScreenshotThumbnail
  - useScreenshotIntake hook (mid-procedure + post-recording entry points)
  - ProcedureRoom Camera button + `S` hotkey with `isTypingTarget` guard + 250 ms debounce
  - ProcedureReview replacement (video left + Scrubber + ScreenshotTimeline + bare metadata sidebar)
  - Toast-undo delete store (5 s undo window for screenshot deltas)
  - 39 new unit tests across 6 files (migration, repo, IPC, capture-screenshot, Scrubber, ScreenshotTimeline)
affects: [05-02, 05-03, 05-04, phase-06-pdf, phase-07-audit-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - screenshotsRepo per-table repo convention (mirrors proceduresRepo)
    - IPC handler `safeParse + requireSession + db.transaction + audit` quartet
    - UserData-relative file_path storage per Anti-Pattern 2 (`path.relative(app.getPath('userData'), absPath)` at write site)
    - Sync file unlink inside db.transaction() so the row delete + audit commit atomically
    - Renderer canvas snapshot from HTMLImageElement OR HTMLVideoElement via intrinsic dimensions (never upscales)
    - setPointerCapture drag pattern per PITFALLS §8 (drag stays alive outside the track)
    - Optimistic UI + Toast store undo pattern (5s scheduler + cancelable timer)
    - ScreenshotThumbnail React.memo boundary per PITFALLS §4 (sibling add/remove doesn't re-render)
    - IPC_STUB pattern: declared channel + safeParse + `IpcErrorException(ipcError('IPC_NOT_IMPLEMENTED', ...))` so renderer contract stays final across plans

key-files:
  created:
    - src/main/db/migrations/0003_screenshots_and_trim.sql
    - src/main/db/screenshots-repo.ts
    - src/main/ipc/screenshots.ts
    - src/renderer/src/lib/capture-screenshot.ts
    - src/renderer/src/components/Scrubber.tsx
    - src/renderer/src/components/ScreenshotThumbnail.tsx
    - src/renderer/src/components/ScreenshotTimeline.tsx
    - src/renderer/src/hooks/useScreenshotIntake.ts
    - src/renderer/src/store/screenshot-toast.ts
    - tests/main/db/migrations/0003_screenshots_and_trim.test.ts
    - tests/main/db/screenshots-repo.test.ts
    - tests/main/ipc/screenshots.test.ts
    - tests/renderer/lib/capture-screenshot.test.ts
    - tests/renderer/components/Scrubber.test.tsx
    - tests/renderer/components/ScreenshotTimeline.test.tsx
  modified:
    - src/main/db/migrations.ts
    - src/main/paths.ts
    - src/main/ipc/procedures.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/shared/ipc-contract.ts
    - src/shared/validators.ts
    - src/shared/errors.ts
    - src/renderer/src/components/RecordingControlsBar.tsx
    - src/renderer/src/pages/ProcedureRoom.tsx
    - src/renderer/src/pages/ProcedureReview.tsx

key-decisions:
  - "Synchronous unlinkSync in screenshotsRepo.delete so the row delete + file unlink + audit row commit inside a single db.transaction() (better-sqlite3 transactions are sync)."
  - "schemasAddInput enforces z.number().int().nonnegative() on timestampInVideoMs; the renderer cannot inject a negative value."
  - "Handlersite decode cap (2 KB..6 MB) layered on top of the zod 8 MB base64 cap so the JS heap + disk surface are bounded even if the base64 string is at-cap."
  - "ProcedureRoom uses the preview <img> ref when recording, the preview hook's <video> ref when idle — captureScreenshot discriminates by source type, so the same primitive serves both entry points."
  - "250 ms debounce on the `S` hotkey against key auto-repeat (D-02)."
  - "Procedures.trim / procedures.restore stubs safeParse first (T-05-09 mitigation) then throw IPC_NOT_IMPLEMENTED; the contract surface is declared now so Plan 03's handlers fill the slots without renderer churn."
  - "ProcedureReview reuses useScreenshotIntake to keep one source of truth for the screenshot list (the hook + a local mirroring state.append for the optimistic UI)."
  - "Toast store tracks pending deletes in a Map<screenshotId, setTimeout> so undo can deterministically cancel the scheduled IPC delete (no race with setTimeout callbacks)."

patterns-established:
  - "Pattern: IPC_NOT_IMPLEMENTED stub for unfinished handlers — declared channel + safeParse + throw. Renderer contract doesn't shift between plans."
  - "Pattern: useSyncExternalStore + unsubscribe(unsub) for tiny stores that don't need Zustand (matches recording/audit session style)."
  - "Pattern: screenshotRepo per-table file with cached stmts + __resetScreenshotsRepoCache() for vitest module resets; mirrors proceduresRepo exactly."
  - "Pattern: useScreenshotIntake as the single hook for both capture entry points; mid-procedure vs playback differ only in timestamp derivation."

requirements-completed: [SCRN-01, SCRN-02, REV-01, REV-02, REV-03]

# Coverage metadata
coverage:
  - id: D1
    description: "Migration 0003 creates the screenshots table (FK ON DELETE CASCADE, CHECK >= 0, index on (procedure_id, timestamp_in_video ASC)) and adds procedures.video_path_original column (nullable until Plan 03's applyTrim)."
    requirement: SCRN-01
    verification:
      - kind: unit
        ref: tests/main/db/migrations/0003_screenshots_and_trim.test.ts#creates the screenshots table with the expected columns + index
        status: pass
      - kind: unit
        ref: tests/main/db/migrations/0003_screenshots_and_trim.test.ts#CHECK constraint enforces timestamp_in_video >= 0
        status: pass
      - kind: unit
        ref: tests/main/db/migrations/0003_screenshots_and_trim.test.ts#FK constraint rejects a screenshot with an unknown procedure_id
        status: pass
      - kind: unit
        ref: tests/main/db/migrations/0003_screenshots_and_trim.test.ts#ON DELETE CASCADE removes screenshots when the procedure is deleted
        status: pass
      - kind: unit
        ref: tests/main/db/migrations/0003_screenshots_and_trim.test.ts#re-running runMigrations does not re-apply the migration (idempotent)
        status: pass
      - kind: unit
        ref: tests/main/db/migrations/0003_screenshots_and_trim.test.ts#procedures.video_path_original column exists and is nullable
        status: pass
    human_judgment: false
  - id: D2
    description: "screenshotsRepo.add / get / listByProcedure (timestamp_in_video ASC) / delete (with removeFile option) / updateAnnotation round-trip; delete(id) for unknown id throws IPC_NOT_FOUND."
    requirement: SCRN-01
    verification:
      - kind: unit
        ref: tests/main/db/screenshots-repo.test.ts#add returns the inserted row mapped to camelCase
        status: pass
      - kind: unit
        ref: tests/main/db/screenshots-repo.test.ts#listByProcedure orders rows by timestamp_in_video ASC
        status: pass
      - kind: unit
        ref: tests/main/db/screenshots-repo.test.ts#delete removes the row and unlinks the file from userData
        status: pass
      - kind: unit
        ref: tests/main/db/screenshots-repo.test.ts#updateAnnotation updates + null resets to NULL
        status: pass
      - kind: unit
        ref: tests/main/db/screenshots-repo.test.ts#delete(id) for an unknown id throws IPC_NOT_FOUND
        status: pass
    human_judgment: false
  - id: D3
    description: "screenshots IPC: add writes JPEG to <userData>/data/media/patients/<id>/<procedureId>/screenshots/<ts>.jpg + inserts row + audits screenshot.captured with { screenshotId, timestampInVideoMs }; LIST returns rows ASC; DELETE rejects unknown id; UPDATE_ANNOTATION rejects empty body; PROCEDURES_TRIM/RESTORE throw IPC_NOT_IMPLEMENTED after safeParse (T-05-09)."
    requirement: SCRN-01
    verification:
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#add writes the JPEG file + inserts a row + audits screenshot.captured
        status: pass
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#add rejects when the decoded payload is below 2 KB (IPC_VALIDATION)
        status: pass
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#add rejects when the decoded payload exceeds 6 MB (IPC_VALIDATION)
        status: pass
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#delete rejects for an unknown id (IPC_NOT_FOUND)
        status: pass
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#trim throws IPC_NOT_IMPLEMENTED
        status: pass
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#trim validates input via safeParse before throwing (outMs <= inMs)
        status: pass
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#restore throws IPC_NOT_IMPLEMENTED
        status: pass
    human_judgment: false
  - id: D4
    description: "Renderer captureScreenshot() draws the source (HTMLImageElement or HTMLVideoElement) onto a canvas, downscales to maxLongEdge=1280 (never upscales), encodes JPEG at quality=0.85, returns { blob, width, height, base64 }; blobToBase64 strips the data URL prefix."
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: tests/renderer/lib/capture-screenshot.test.ts#downscales a 1920x1080 image to fit maxLongEdge=1280 (1280x720)
        status: pass
      - kind: unit
        ref: tests/renderer/lib/capture-screenshot.test.ts#does NOT upscale a 1280x720 video beyond source pixels
        status: pass
      - kind: unit
        ref: tests/renderer/lib/capture-screenshot.test.ts#does NOT upscale a small 240x180 image
        status: pass
      - kind: unit
        ref: tests/renderer/lib/capture-screenshot.test.ts#uses the supplied quality option (passed to toBlob)
        status: pass
      - kind: unit
        ref: tests/renderer/lib/capture-screenshot.test.ts#throws when the source has no intrinsic dimensions
        status: pass
    human_judgment: false
  - id: D5
    description: "Bare Scrubber: pointer events + setPointerCapture, click-to-seek + drag-to-seek with progressive onSeek updates; progress fill width = currentMs / durationMs (clamped 0..100)."
    requirement: REV-01
    verification:
      - kind: unit
        ref: tests/renderer/components/Scrubber.test.tsx#calls onSeek with the duration midpoint on a 50% click
        status: pass
      - kind: unit
        ref: tests/renderer/components/Scrubber.test.tsx#drag-to-seek calls onSeek again on a pointermove with captured pointer
        status: pass
      - kind: unit
        ref: tests/renderer/components/Scrubber.test.tsx#calls setPointerCapture on pointerdown (PITFALLS §8)
        status: pass
      - kind: unit
        ref: tests/renderer/components/Scrubber.test.tsx#renders a progress fill width matching currentMs/durationMs
        status: pass
      - kind: unit
        ref: tests/renderer/components/Scrubber.test.tsx#clamps progress width to 100% when currentMs > durationMs
        status: pass
    human_judgment: false
  - id: D6
    description: "ScreenshotTimeline renders memoized ScreenshotThumbnail cards in a horizontal scroll row, ordered by timestamp_in_video ASC; +Capture button at the end invokes onCapture; clicking a thumbnail seeks the video; clicking × deletes with Toast undo."
    requirement: REV-02
    verification:
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#clicking a thumbnail invokes onSeek with its timestamp
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#clicking the × button calls onDelete and does NOT invoke onSeek
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#clicking +Capture invokes onCapture exactly once
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#memo boundary: deleting one thumbnail does not re-render its siblings
        status: pass
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#renders no × button when onDelete is undefined (Plan 01 baseline)
        status: pass
    human_judgment: false
  - id: D7
    description: "ProcedureRoom Camera button + S hotkey (with isTypingTarget guard + 250 ms debounce) + toast on success/failure; Plan 01 ships the entry point + happy path."
    requirement: SCRN-02
    verification: []
    human_judgment: true
    rationale: "ProcedureRoom integration is end-to-end UI behavior — true integration coverage requires an Electron renderer harness that captures canvas data, dispatches synthetic events, and round-trips through IPC. The hotkey entry point + Camera button + guard are unit-verifiable but the full UX (button onPause / capture path wire-up to the <img> during recording vs the <video> while idle) needs a manual verify pass on Windows hardware before UAT."
  - id: D8
    description: "ProcedureReview replaces the Phase 4 placeholder with the D-10 layout: video left + Scrubber + ScreenshotTimeline + bare procedure metadata sidebar (patient name, status badge, started/ended, duration, video path)."
    requirement: REV-03
    verification: []
    human_judgment: true
    rationale: "The review layout is a UI surface that depends on the <video src=/media/...> route (Plan 03 ships the PreviewServer extension) and the actual playback wiring needs Windows hardware to confirm the timeline thumbnails seek the video correctly. The click-to-seek path is unit-verified via the mocked <video> in the Timeline + Scrubber tests."
  - id: D9
    description: "IPC contract surface extended: api.screenshots.{add,list,delete,updateAnnotation} + api.procedures.{trim,restore} declared; trim/restore throw IPC_NOT_IMPLEMENTED until Plan 03 fills them."
    requirement: SCRN-01
    verification:
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#trim throws IPC_NOT_IMPLEMENTED
        status: pass
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#restore throws IPC_NOT_IMPLEMENTED
        status: pass
      - kind: unit
        ref: tests/main/ipc/screenshots.test.ts#trim validates input via safeParse before throwing (outMs <= inMs)
        status: pass
    human_judgment: false

# Metrics
duration: ~45 min
completed: 2026-08-06
status: complete
---

# Phase 5: Screenshots + Procedure Review + Trim — Plan 01 Summary

**End-to-end screenshot capture pipeline (mid-procedure S/hotkey + post-recording +Capture), bare Scrubber with click-to-seek, real Procedure Review screen replacing the Phase 4 placeholder, plus IPC stubs for Plan 03's trim/restore handlers.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-06T19:53:00Z
- **Completed:** 2026-08-06T20:51:00Z (last test run timestamp)
- **Tasks:** 4 (1 auto-approved decision checkpoint + 1 tracer + 1 toast-undo overlay + 1 Wave 0 test suite)
- **Files modified:** 18 created, 11 modified

## Accomplishments

- Migration 0003 applies on next dev boot — `screenshots` table with FK `ON DELETE CASCADE`, `CHECK (timestamp_in_video >= 0)`, `(procedure_id, timestamp_in_video ASC)` index; `procedures.video_path_original TEXT` column added nullable.
- `screenshotsRepo` is the canonical per-table repo (cached stmts + `__resetScreenshotsRepoCache()` for tests) — `add` / `get` / `listByProcedure` (ASC) / `delete` (sync unlink fits inside `db.transaction()`) / `updateAnnotation`.
- `screenshots` IPC handler suite (`add` / `list` / `delete` / `updateAnnotation`) validates input via zod, requires session, commits row + audit inside one transaction. `add` decodes the base64 JPEG, enforces a 2 KB..6 MB decoded-size band, writes the file at `<userData>/data/media/patients/<patientId>/<procedureId>/screenshots/<timestampMs>.jpg` with a userData-relative path per Anti-Pattern 2, audits `screenshot.captured` with `{ screenshotId, timestampInVideoMs }` only (Fix 6 inheritance).
- IPC contract surface extended: `api.screenshots.*` fully wired; `api.procedures.trim` + `api.procedures.restore` declared with handlers in `ipc/procedures.ts` that `safeParse` then throw `IPC_NOT_IMPLEMENTED` — Plan 03 fills the handlers, the renderer contract stays final.
- Renderer `captureScreenshot()` is the single primitive for both entry points (img MJPEG frame mid-procedure, `<video>` playback in review), with discriminated-by-source intrinsic dimensions, `Math.min(1, maxLongEdge / max dim)` scale to enforce D-04 (never upscales), JPEG quality 0.85, base64 IPC payload via `FileReader.readAsDataURL`.
- Bare Scrubber wires pointer events (`onPointerDown` → `setPointerCapture` + seek, `onPointerMove` → drag-to-seek, `onPointerUp` → release) per PITFALLS §8 — Plan 02 layers pause markers, Plan 03 layers trim handles over the same track.
- ScreenshotTimeline renders memoized ScreenshotThumbnail cards in a horizontal scroll row ordered by `timestamp_in_video` ASC; the × button triggers the Toast-undo store (5 s undo window) per D-12.
- ProcedureRoom Camera button + `S` hotkey guard pattern matches the Phase 4 Space/Esc/R keymap; 250 ms debounce against key auto-repeat; toast on success/failure via sonner.
- ProcedureReview replaces the Phase 4 placeholder with the D-10 layout: `<video>` left + Scrubber + ScreenshotTimeline + bare metadata sidebar (patient name, status badge, started/ended, duration, video path). `<video src=...>` placeholder shown until Plan 03 ships the `/media/` route on PreviewServer — the click-to-seek wiring is unit-verified via the mocked `<video>` element.

## Task Commits

Each task was committed atomically:

1. **Migration 0003 + IPC_NOT_IMPLEMENTED** — `9017608` (feat)
2. **screenshots repo + IPC + trim/restore stubs + preload bridge** — `196ceb6` (feat)
3. **capture-screenshot lib + Scrubber + ScreenshotTimeline + Thumbnail** — `4bc8684` (feat)
4. **useScreenshotIntake hook + ProcedureRoom S/hotkey + ProcedureReview** — `25a739c` (feat)
5. **Wave 0 unit tests (migration/repo/IPC/capture-screenshot/Scrubber/Timeline)** — `4321c6f` (test)

## Files Created/Modified

- `src/main/db/migrations/0003_screenshots_and_trim.sql` — D-04 + D-05 + D-07 schema.
- `src/main/db/migrations.ts` — registers MIGRATIONS[2] = id 3.
- `src/main/db/screenshots-repo.ts` — per-table repo, sync delete.
- `src/main/paths.ts` — `screenshotsDir(patientId, procedureId)` returns `<userData>/data/media/patients/<p>/<proc>/screenshots`.
- `src/main/ipc/screenshots.ts` — `registerScreenshotsIpc()` with add/list/delete/updateAnnotation.
- `src/main/ipc/procedures.ts` — safeParse-then-throw stubs for `PROCEDURES_TRIM` + `PROCEDURES_RESTORE`.
- `src/main/index.ts` — registers `registerScreenshotsIpc()` after recording.
- `src/preload/index.ts` — exposes `api.screenshots.*` + `api.procedures.{trim,restore}`.
- `src/shared/ipc-contract.ts` — `Screenshot` type, `IPC.SCREENSHOTS_*` + `IPC.PROCEDURES_TRIM/RESTORE`, `IpcContract.screenshots` + `procedures.trim/restore`.
- `src/shared/validators.ts` — 6 new zod schemas (8 MB base64 cap on add, outMs > inMs refine on trim).
- `src/shared/errors.ts` — `IPC_NOT_IMPLEMENTED` variant.
- `src/renderer/src/lib/capture-screenshot.ts` — pure canvas.drawImage + JPEG q=0.85 + blob→base64.
- `src/renderer/src/components/Scrubber.tsx` — pointer-events + setPointerCapture.
- `src/renderer/src/components/ScreenshotThumbnail.tsx` — memo(ScreenshotThumbnail) + onDelete-gated × button.
- `src/renderer/src/components/ScreenshotTimeline.tsx` — horizontal row + +Capture.
- `src/renderer/src/components/RecordingControlsBar.tsx` — `onCapture` prop + Camera icon button.
- `src/renderer/src/hooks/useScreenshotIntake.ts` — capture() for both entry points; timestampInVideoMs discriminated by isRecording.
- `src/renderer/src/store/screenshot-toast.ts` — enqueueDelete / undoDelete / commitDelete with Map<id, timeout>.
- `src/renderer/src/pages/ProcedureRoom.tsx` — Camera button + S hotkey + isTypingTarget guard + 250 ms debounce.
- `src/renderer/src/pages/ProcedureReview.tsx` — D-10 layout (video left + Scrubber + ScreenshotTimeline + bare metadata sidebar).
- 6 new test files (migration, repo, IPC, capture-screenshot, Scrubber, ScreenshotTimeline).

## Decisions Made

- **Sync unlink in repo:** `screenshotsRepo.delete` uses `unlinkSync` (not `fs/promises.unlink`) so the row delete + file unlink + audit row write commit atomically inside `db.transaction()`. better-sqlite3 transactions are sync; async file IO would tear the txn boundary.
- **8 MB base64 + 6 MB decoded dual cap:** zod's `max(8_000_000)` on the base64 string rejects the worst-case JS heap pressure (≈6 MB decoded limit); the handler's `Buffer.byteLength` check rejects payloads below 2 KB (defensive against empty/test payloads) or above 6 MB (defensive against the actual worst-case JPEG at q=0.85 + maxLongEdge 1280).
- **Two `sourceRef`s, one hook:** ProcedureRoom points the hook at the live `<img>` (when recording) OR the live `<video>` (when idle); captureScreenshot distinguishes intrinsic dims by source type (`videoWidth/videoHeight` vs `naturalWidth/naturalHeight`). One primitive, two entry points.
- **IPC stub pattern (formalized):** Plan 03 fills the trim/restore handlers; the preload `api.procedures.trim` calls `ipcRenderer.invoke(IPC.PROCEDURES_TRIM, input)` which hits the handler in `registerProceduresIpc`. The handler `safeParse`s first (so T-05-09 negative-range DoS is mitigated even before Plan 03 ships), then throws `IPC_NOT_IMPLEMENTED`. Renderer contract stays final; Plan 03 only adds the implementation arm.
- **Toast store Map<id, setTimeout>:** deterministic cancel — undoDelete can `clearTimeout(timer)` even after the IPC call has been scheduled. A "polling pending state on every commit" alternative would race with the timer callback.
- **ProcedureReview mirrors useScreenshotIntake state:** the hook owns the loaded list; the page keeps a local `screenshotList` for optimistic append + delete. Two writes (set + setPrev) keep them in sync without the hook needing optimistic-UI awareness.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed wrong import path depth in 0003_screenshots_and_trim test bootstrap helpers**
- **Found during:** Task 4 (Wave 0 tests)
- **Issue:** Plan-spec said tests under `tests/main/db/migrations/` reach `src/main/db` via `../../../` — wrong; that path is 4 levels deep, so the import needs `../../../../`.
- **Fix:** Replaced `../../../src/main/db` with `../../../../src/main/db` in the bootstrap helpers; same for proceduresRepo + auth + session imports.
- **Files modified:** tests/main/db/migrations/0003_screenshots_and_trim.test.ts.
- **Verification:** All 6 migration tests pass (`tests/main/db/migrations/0003_screenshots_and_trim.test.ts`).
- **Committed in:** 4321c6f (Wave 0 test commit).

**2. [Rule 1 - Bug] Fixed Canvas prototype mocks not applied to happy-dom render of capture-screenshot**
- **Found during:** Task 4 (Wave 0 tests)
- **Issue:** happy-dom does not ship a working `HTMLCanvasElement.toBlob` / `getContext`; capture-screenshot's `canvas.toBlob` returned null in the test env.
- **Fix:** Added a top-level prototype replacement in the test file's `beforeEach` so happy-dom tests resolve a working `toBlob` and `getContext` mock.
- **Files modified:** tests/renderer/lib/capture-screenshot.test.ts.
- **Verification:** All 5 capture-screenshot tests + 2 sanity tests pass (7 total).
- **Committed in:** 4321c6f (Wave 0 test commit).

**3. [Rule 1 - Bug] Fixed React-Testing-Library multiple-element collisions in Scrubber + ScreenshotTimeline tests**
- **Found during:** Task 4 (Wave 0 tests)
- **Issue:** Without per-test `cleanup()`, earlier-rendered track/fill elements stayed in the DOM and caused `"Found multiple elements"` errors.
- **Fix:** Added explicit `import '../setup';` at the top of the three renderer test files so `tests/renderer/setup.ts`'s `afterEach(cleanup)` fires. Setup runs the per-test `mockApi()` + `setRoute(initialRoute)` + `session.reset()`.
- **Files modified:** tests/renderer/components/Scrubber.test.tsx, tests/renderer/components/ScreenshotTimeline.test.tsx, tests/renderer/lib/capture-screenshot.test.ts.
- **Verification:** Scrubber 5/5 + Timeline 6/6 pass.
- **Committed in:** 4321c6f (Wave 0 test commit).

**4. [Rule 1 - Bug] Removed async from screenshotsRepo.delete so it fits inside db.transaction()**
- **Found during:** Task 2 (IPC handler wiring)
- **Issue:** Plan called for an async delete (file unlink via `fs/promises`), but `db.transaction()` is sync — wrapping a Promise inside a sync txn teardown leaks the txn boundary.
- **Fix:** Switched to `unlinkSync` (microsecond-speed for small JPEGs) and the now-sync `delete` returns `void`. Wrapped the row delete + audit commit in `db.transaction()`.
- **Files modified:** src/main/db/screenshots-repo.ts, src/main/ipc/screenshots.ts.
- **Verification:** 9/9 screenshots IPC tests pass.
- **Committed in:** 196ceb6 (IPC commit).

---

**Total deviations:** 4 auto-fixed (all Rule 1 bugs — wrong test paths, missing happy-dom canvas mocks, missing cleanup, async/sync transaction mismatch).
**Impact on plan:** All auto-fixes necessary for correctness/test isolation. No scope creep. No architectural changes (no new dependencies, no schema shape changes, no public-API drift).

## Issues Encountered

- **procedure-room-timer.test.tsx pre-existing React scheduling failures** — these failures (`"Should not already be working"`) exist on the main branch at `1ba181b` (before any Phase 5 work) — verified by stashing Phase 5 changes and re-running. Unrelated to plan 05-01; the Phase 5 tests themselves all pass (39/39 across 6 files). Plan 04 / Plan 05-01 followup should address the React strict-mode timer-double-subscribe issue separately.

## User Setup Required

None — no external service configuration required. The migration applies on next `npm run dev` boot via the existing `runMigrations(getDb())` call.

## Next Phase Readiness

- Plan 02 (Pause markers on Scrubber + Notes accordion + annotation panel) extends the same screens with new layered children; Scrubber is built to accept markers.
- Plan 03 (Trim) wires `procedures.trim` + `procedures.restore` handlers — the IPC surface and validators are already declared; the trim ffmpeg subprocess mirrors Phase 4 concat pattern.
- Plan 04 (Integration hardening) will exercise the full flow on Windows hardware + smoke UAT.
- Phase 6 (PDF) can extend `useScreenshotIntake` to enumerate over a procedure's `screenshots[]` for the report attachment list (already returns `[]` ordered ASC by `timestamp_in_video` — exactly what bulk-selection needs).

---

*Phase: 05-screenshots-procedure-review-trim*
*Completed: 2026-08-06*
