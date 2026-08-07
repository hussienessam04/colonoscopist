---
phase: 05-screenshots-procedure-review-trim
plan: 07
subsystem: ui
tags: [screenshot, gallery, lightbox, dialog, discoverability, shadcn, toast-undo]
gap_closure: true
gap_ids:
  - G-05-8
  - G-05-9
  - G-05-10
status: complete

# Dependency graph
requires:
  - phase: 05-screenshots-procedure-review-trim
    provides: "useScreenshotIntake hook (Plan 01) returning { screenshots, capture, loading, error } from window.api.screenshots.list + append-on-capture; ScreenshotTimeline + ScreenshotTimeline components (Plan 01/02) with onSeek + onCapture + onDelete + onAnnotate; screenshotToastStore (Plan 02) enqueueDelete + undoDelete + commitDelete; MediaServer /media/ route (Plan 04) accepting <patientId>/<procedureId>/<leafFile> paths; shadcn Dialog primitive in src/renderer/src/components/ui/dialog.tsx"
provides:
  - "ProcedureRoom renders a mid-procedure gallery panel fed by useScreenshotIntake.screenshots (G-05-8)"
  - "Per-thumbnail delete affordance is a 24×24 solid-red badge at top-1 right-1 with focus-visible:ring-2 (G-05-9 discoverability baseline)"
  - "ScreenshotLightbox modal showing the captured JPEG at its native 1280-px resolution via the existing /media/ route (G-05-10)"
  - "onOpen?: (s: Screenshot) => void prop on ScreenshotThumbnail + ScreenshotTimeline so the parent page can mount its own lightbox"
  - "Contract-guard tests that lock the × button class list and the expand-icon / lightbox URL composition against regression"
affects:
  - "Phase 5 plan 05-08 (trim visual timeline) — should reuse the same lightbox/delete affordance patterns"
  - "Phase 5 plan 05-09 (any remaining gap-closure)"
  - "Phase 6 (report editor) — will reference Screenshot.filePath the same way; no new contract surface"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline SVG icon (Maximize2) instead of a new lucide-react import — no new dep for a one-off affordance (ponytail: stdlib first)"
    - "shadcn Dialog primitive reused for a controlled modal where parent owns `null`/row state — single useState<Screenshot | null> with onOpenChange = (open) => { if (!open) onClose(); }"
    - "Testid-tagged affordance buttons so a regression to seek-only click is caught at the unit-test layer (T-05-57 + T-05-58 mitigation)"
    - "Toast-undo delete parity across surfaces — gallery, timeline, AND lightbox all call the same screenshotToastStore.enqueueDelete so the doctor's mental model is one delete, one undo"
    - "Contract-guard tests assert class lists + DOM presence for discoverability-critical affordances, not just callback wiring"

key-files:
  created:
    - src/renderer/src/components/ScreenshotLightbox.tsx
    - tests/renderer/components/ScreenshotLightbox.test.tsx
  modified:
    - src/renderer/src/components/ScreenshotThumbnail.tsx
    - src/renderer/src/components/ScreenshotTimeline.tsx
    - src/renderer/src/pages/ProcedureRoom.tsx
    - src/renderer/src/pages/ProcedureReview.tsx
    - tests/renderer/components/ScreenshotTimeline.test.tsx
    - tests/renderer/pages/procedure-room-timer.test.tsx

key-decisions:
  - "Inline SVG Maximize2 instead of lucide-react Maximize2 import — saves a new dep for a 4-path icon used in exactly one place"
  - "expand affordance is a dedicated <button> on top-LEFT (× stays top-RIGHT) so the two affordances are independent visually and structurally — Doctor's mental model: red = destructive, slate = expand"
  - "Gallery passes onSeek={noop} and intentionally NOT onAnnotate — mid-procedure, no video to seek and no review-time annotation flow"
  - "Lightbox delete reuses handleDelete from ProcedureReview (same Toast-undo handler) so a delete from inside the lightbox is undoable identically to a delete from the timeline"
  - "handleScreenshotDelete in ProcedureRoom mirrors ProcedureReview's handleDelete but drops the void refresh().then() — the room's gallery re-renders from useScreenshotIntake.screenshots directly; the toast store's pending entry is the source of truth for 'deleted' from the user's POV"
  - "× button is repositioned to top-1 right-1 (was top-6 right-1) to avoid collision with the annotation caption strip that sits at top-0 in review context — discoverable + non-conflicting in both contexts"

patterns-established:
  - "Two independent affordances on a thumbnail card: outer <div> click = seek; dedicated <button> = expand; e.stopPropagation() on the button prevents parent seek"
  - "Test guard for discoverability = className string contains the discoverable tokens (h-6 w-6 bg-red-600). DOM presence alone is insufficient — a 16×16 grey glyph would still be in the DOM"
  - "Mid-procedure gallery surfaces WITHOUT a ProcedureRoom page-level state change — the existing useScreenshotIntake hook already populates `screenshots[]`; the gallery is just a consumer of existing state. No new IPC, no new hook surface."

requirements-completed:
  - SCRN-02
  - REV-02

# Coverage metadata — one entry per shipped deliverable
coverage:
  - id: D1
    description: "ProcedureRoom right-aside gallery mounts <ScreenshotTimeline> fed by useScreenshotIntake.screenshots; delete uses screenshotToastStore.enqueueDelete + Toast-undo (G-05-8)"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: "tests/renderer/pages/procedure-room-timer.test.tsx#ProcedureRoom screenshot gallery (G-05-8) > mounts a gallery fed by useScreenshotIntake.screenshots during recording"
        status: pass
      - kind: unit
        ref: "tests/renderer/pages/procedure-room-timer.test.tsx#ProcedureRoom screenshot gallery (G-05-8) > clicking the × button on a gallery thumbnail enqueues a Toast-undo delete"
        status: pass
    human_judgment: false
  - id: D2
    description: "× button on every ScreenshotThumbnail is a 24×24 solid-red badge (h-6 w-6 bg-red-600) at top-1 right-1 with focus-visible:ring-2 + shadow-md (G-05-9)"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: "tests/renderer/components/ScreenshotTimeline.test.tsx#ScreenshotTimeline > × button has discoverable class list (h-6 w-6 bg-red-600) — G-05-9 contract guard"
        status: pass
    human_judgment: false
  - id: D3
    description: "ScreenshotThumbnail + ScreenshotTimeline accept onOpen?: (s: Screenshot) => void and render a dedicated expand affordance (Maximize2 inline SVG, top-left) with e.stopPropagation() to keep seek-on-click intact (G-05-10 affordance)"
    requirement: REV-02
    verification:
      - kind: unit
        ref: "tests/renderer/components/ScreenshotTimeline.test.tsx#ScreenshotTimeline > clicking the expand icon calls onOpen with the screenshot and does NOT trigger onSeek — G-05-10"
        status: pass
      - kind: unit
        ref: "tests/renderer/components/ScreenshotTimeline.test.tsx#ScreenshotTimeline > does not render the expand icon when onOpen is undefined (back-compat)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ScreenshotLightbox modal renders the full-size JPEG via /media/<patientId>/<procedureId>/<fileName> (reuses ProcedureReview's URL composition + the existing server path-escape regex); Esc / click-outside / × button dismiss; delete parity with timeline (G-05-10)"
    requirement: REV-02
    verification:
      - kind: unit
        ref: "tests/renderer/components/ScreenshotLightbox.test.tsx#ScreenshotLightbox > renders nothing visible when screenshot is null (closed state)"
        status: pass
      - kind: unit
        ref: "tests/renderer/components/ScreenshotLightbox.test.tsx#ScreenshotLightbox > renders the full-size <img> via /media/ route when screenshot is supplied — G-05-10"
        status: pass
      - kind: unit
        ref: "tests/renderer/components/ScreenshotLightbox.test.tsx#ScreenshotLightbox > clicking the close button calls onClose"
        status: pass
    human_judgment: false
  - id: D5
    description: "ProcedureReview wires onOpen={setLightboxScreenshot} to the existing <ScreenshotTimeline> mount and renders <ScreenshotLightbox> at the page root with onDelete={handleDelete} (Toast-undo reuse)"
    requirement: REV-02
    verification: []
    human_judgment: true
    rationale: "Windows hardware smoke requires a connected capture device + real mid-procedure capture flow + a doctor inspecting the lightbox at native 1280-px resolution — out of scope for unit tests; /gsd-verify-work 5 re-runs UAT after this SUMMARY exists"
  - id: D6
    description: "End-to-end UX re-run on Windows hardware: mid-procedure S-hotkey capture visible in room gallery; click × deletes with Toast undo; click expand opens lightbox at native 1280-px resolution; Esc / click-outside close"
    verification: []
    human_judgment: true
    rationale: "Hardware smoke (capture device + Windows ffmpeg + doctor visual review) — out of scope for unit tests; /gsd-verify-work 5 re-runs UAT after this SUMMARY exists"

# Metrics
duration: 25min
completed: 2026-08-07
---
# Phase 5 Plan 7: Gallery + Delete + Lightbox Summary

**G-05-8/9/10 closed: mid-procedure screenshots are now visible in ProcedureRoom via a gallery panel, the × button is a discoverable 24×24 solid-red badge, and a new ScreenshotLightbox modal opens from a dedicated expand affordance showing the captured JPEG at native 1280-px resolution.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-07T19:30:00Z
- **Completed:** 2026-08-07T19:55:00Z
- **Tasks:** 3 / 3 complete
- **Files modified:** 6 (2 created, 4 modified)
- **Tests:** 499 / 499 pass (491 baseline + 8 new contract-guard assertions, no regressions)

## Accomplishments

- **Mid-procedure gallery (G-05-8).** `ProcedureRoom` now mounts `<ScreenshotTimeline>` in the right aside (below `ProcedureNotesPanel` + `DeviceLostBanner`) fed by the existing `useScreenshotIntake.screenshots` state. The mount is gated on `isRecording || screenshots.length > 0` so it takes zero vertical space when irrelevant. The +Capture button reuses the room's `handleScreenshotCapture` so the S hotkey and the timeline button are interchangeable. Delete uses `screenshotToastStore.enqueueDelete` + Toast-undo — same store the review timeline uses.
- **Discoverable delete affordance (G-05-9).** The × button on every `<ScreenshotThumbnail>` was bumped from a 20×20 translucent-black `h-5 w-5 bg-black/60 text-xs` (positioned at `top-6 right-1` where it collided with the annotation caption strip) to a 24×24 solid-red `h-6 w-6 bg-red-600 text-sm` (positioned at `top-1 right-1`) with `shadow-md` + `focus-visible:ring-2 focus-visible:ring-white` + `hover:bg-red-700`. The hit target is large enough for a gloved clinician to tap without a hover-reveal; the red is high-contrast against any captured frame; the focus ring makes the affordance discoverable for keyboard users. The existing `e.stopPropagation()` keeps the parent seek click from firing.
- **Full-size lightbox (G-05-10).** A new `<ScreenshotLightbox>` component composes the full-size URL the same way `ProcedureReview.tsx:123-127` does (`filePath.replace(/^.*[\\/]/, '')` extracts the leaf filename, then `${mediaBaseUrl}/media/${patientId}/${procedureId}/${fileName}`). The shadcn `<Dialog>` primitive handles Esc / click-outside / focus trap. The lightbox has a dedicated `screenshot-lightbox-close` button + a destructive `screenshot-lightbox-delete` button that reuses the same `handleDelete` the timeline uses (parity: a delete from the lightbox is undoable the same way as a delete from the timeline).
- **Independent seek + expand affordances.** ScreenshotThumbnail accepts an optional `onOpen?: (s: Screenshot) => void` prop. When present, a dedicated expand button (inline Maximize2 SVG, top-left of the card) fires `onOpen(s)`. The button's `e.stopPropagation()` prevents the parent seek click from also firing. When `onOpen` is absent, the expand button doesn't render — back-compat for callers that don't want a lightbox.
- **Contract-guard tests for discoverability.** Three regression tests now lock the discoverability baseline:
  1. `× button has discoverable class list (h-6 w-6 bg-red-600)` — any regression to the old `h-5 w-5 bg-black/60` shape is caught at the unit-test layer (T-05-58 mitigation).
  2. `clicking the expand icon calls onOpen with the screenshot and does NOT trigger onSeek` — locks the seek/expand independence (T-05-57 mitigation).
  3. `does not render the expand icon when onOpen is undefined (back-compat)` — keeps legacy callers' DOM unchanged.
- **Lightbox contract tests.** Three new tests in `tests/renderer/components/ScreenshotLightbox.test.tsx` cover: closed-state null-safety (no `<img>` in the DOM when `screenshot === null`); full-size URL composition (`http://127.0.0.1:51731/media/p1/proc1/5000.jpg` from `data/media/p1/screenshots/5000.jpg`); close-button callback.
- **Gallery contract tests.** Two new tests in `procedure-room-timer.test.tsx` under `describe('ProcedureRoom screenshot gallery (G-05-8)')`: gallery mount fed by the hook (2 thumbnails + +Capture button visible during recording); × button click enqueues a pending entry in the toast store and `undoDelete` clears it.

## Task Commits

Each task was committed atomically per the per-task contract:

1. **Task 1: Gallery in ProcedureRoom + × discoverability + expand affordance prop surface** — `c0d6382` (feat)
2. **Task 2: ScreenshotLightbox modal + ProcedureReview onOpen mount** — `9465012` (feat)
3. **Task 3: Gallery mount tests + × class-list assertion + lightbox tests** — `bc1b8b3` (test)

**Plan metadata:** pending docs commit (`docs(05-07): complete plan 07 - gallery + delete + lightbox (G-05-8/9/10)`)

## Files Created/Modified

- `src/renderer/src/components/ScreenshotThumbnail.tsx` — × button bumped to `h-6 w-6 bg-red-600 text-sm` at `top-1 right-1` with `shadow-md` + `focus-visible:ring-2 focus-visible:ring-white` + `hover:bg-red-700`. New optional `onOpen?: (s: Screenshot) => void` prop; when present, a dedicated expand button (inline Maximize2 SVG, top-left) fires `onOpen(s)` with `e.stopPropagation()` to keep the parent seek click intact. New `handleExpand` handler.
- `src/renderer/src/components/ScreenshotTimeline.tsx` — added `onOpen?: (s: Screenshot) => void` to `ScreenshotTimelineProps`; forwarded to each `<ScreenshotThumbnail>`. No DOM changes otherwise.
- `src/renderer/src/pages/ProcedureRoom.tsx` — imports `ScreenshotTimeline` + `screenshotToastStore` + `Screenshot` type. New `handleScreenshotDelete` callback mirrors `ProcedureReview.handleDelete` but drops the `void refresh().then(...)` (room's gallery re-renders from the hook's local state). The right-aside mount wraps `<ScreenshotTimeline>` in a `{isRecording || screenshotIntake.screenshots.length > 0 ? <div data-testid="procedure-room-gallery-section">...</div> : null}` gate with a section header (`<h3>Captured screenshots</h3>`).
- `src/renderer/src/components/ScreenshotLightbox.tsx` (new) — shadcn `<Dialog>`-backed modal. Props: `{ screenshot: Screenshot | null; patientId; procedureId; mediaBaseUrl: string | null; onClose; onDelete?; testId? }`. URL composition mirrors `ProcedureReview.tsx:123-127`. Closes via Esc, click-outside, or explicit × button. When `onDelete` is supplied, renders a destructive `Delete` button (lucide `Trash2`) that fires `onDelete(s)`.
- `src/renderer/src/pages/ProcedureReview.tsx` — imports `ScreenshotLightbox`; adds `lightboxScreenshot` state; passes `onOpen={setLightboxScreenshot}` to the existing `<ScreenshotTimeline>` mount; renders `<ScreenshotLightbox>` at the page root (below the `<section>`) with `onDelete={handleDelete}` (Toast-undo reuse) and defensive empty-string `patientId`/`procedureId` for the initial `procedure === null` render.
- `tests/renderer/components/ScreenshotTimeline.test.tsx` — added 3 tests: × button class list (`h-6` + `w-6` + `bg-red-600`); expand icon onOpen (locks the seek/expand independence); back-compat (no expand icon when `onOpen` undefined).
- `tests/renderer/components/ScreenshotLightbox.test.tsx` (new) — 3 tests: closed-state null-safety, full-size URL composition (with the leaf filename extraction), close button calls `onClose`.
- `tests/renderer/pages/procedure-room-timer.test.tsx` — added a new `describe('ProcedureRoom screenshot gallery (G-05-8)')` block with 2 tests: gallery mount with 2 seed rows; × click enqueues a pending delete + `undoDelete` clears it. Added `within` to the testing-library import + `screenshotToastStore` import.

## Decisions Made

- **Inline SVG Maximize2 instead of lucide-react Maximize2 import.** Saves a new dep for a 4-path icon used in exactly one place. Per Ponytail ladder: stdlib + native first.
- **expand affordance on top-LEFT, × on top-RIGHT.** Two independent affordances visually separated: red = destructive, slate = expand. A future `aria-describedby` could distinguish them further; the visual + position is sufficient for now.
- **Gallery passes `onSeek={noop}` and intentionally NOT `onAnnotate`.** Mid-procedure, there's no video to seek and no review-time annotation flow. Annotations belong to Procedure Review.
- **Lightbox delete reuses `handleDelete` from ProcedureReview.** Same Toast-undo handler — the doctor's mental model is "one delete, one undo" across gallery + timeline + lightbox.
- **`handleScreenshotDelete` in ProcedureRoom mirrors `ProcedureReview.handleDelete` but drops `void refresh().then(...)`.** The room's gallery re-renders from `useScreenshotIntake.screenshots` directly. The toast store's pending entry is the source of truth for "deleted" from the user's POV. The optimistic state-update dance is only needed in review where the source is `useProcedures().screenshots` (not a hook-managed local state).
- **× button repositioned to `top-1 right-1` (was `top-6 right-1`).** The old position collided with the annotation caption strip (which sits at `top-0` in review context). The new position is discoverable in both contexts (gallery has no caption strip, but review does).
- **Testid `screenshot-thumbnail-expand` on the expand button.** Makes the affordance individually targetable for the contract-guard test + any future Playwright smoke test.

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed exactly as written.

### Documented Plan Adjustments

**1. Two-affordance visual separation (× top-right, expand top-LEFT).**

The plan called for an "expand affordance to the LEFT of the × button (top-left of the card)" — same as what shipped. Documented for the record: I chose **top-LEFT** for the expand so the two affordances don't visually cluster in the same corner; red-on-top-right (destructive) + slate-on-top-left (expand) is easier to scan in a clinical context than two stacked top-right buttons.

**2. `handleScreenshotDelete` drops the `void refresh().then(...)` from ProcedureReview's pattern.**

The plan listed both options ("verify whether `screenshotIntake.refresh?.()` is exposed; if not, just enqueue and rely on page-reload to clear"). I confirmed `useScreenshotIntake` does NOT expose a `refresh` function (lines 26-31 of the hook return `{ screenshots, capture, loading, error }` only). The page doesn't need an explicit refresh — `screenshotToastStore.__getState().pending[].screenshotId` is the source of truth for "deleted from the user's POV" because the toast's 5s timer is what hides the row (the hook's local `screenshots[]` still holds the row until the next list refresh, which the next page mount triggers). This matches the plan's "if not, just enqueue" branch.

**3. Test guard uses `className.includes('h-6')` etc., not `toHaveClass('h-6')`.**

`@testing-library/jest-dom`'s `toHaveClass` does substring matching, but I used `expect(cls).toContain('h-6')` for explicitness (the assertion is clearly "this exact substring must be in the class list"). Same behavior; the assertion reads more clearly to a code reviewer.

## Issues Encountered

None. All 499 tests pass on first run after Task 3. No pre-commit hook failures. No type errors on `npm run typecheck:web`.

## Verification Summary

- `npm run typecheck:web` — PASS (no errors)
- `npm run test:unit -- --run tests/renderer/components/ScreenshotTimeline.test.tsx tests/renderer/components/ScreenshotLightbox.test.tsx tests/renderer/pages/procedure-room-timer.test.tsx tests/renderer/pages/ProcedureReview.test.tsx` — PASS (45/45 tests on the gap-relevant files)
- `npm run test:unit` (full suite) — PASS (499/499 tests across 63 files, no regressions)

Acceptance criteria (per plan frontmatter):

- [x] `src/renderer/src/pages/ProcedureRoom.tsx` imports `ScreenshotTimeline` + `screenshotToastStore` + `Screenshot` type.
- [x] The right aside gains a gallery mount gated on `isRecording || screenshots.length > 0` with `testId="procedure-room-gallery"`.
- [x] `handleScreenshotDelete` is the same Toast-undo pattern as `ProcedureReview.handleDelete` (slightly streamlined: no `void refresh().then(...)`).
- [x] Gallery's `onAnnotate` is intentionally NOT passed.
- [x] `ScreenshotThumbnail.tsx` × button is `h-6 w-6 bg-red-600 text-sm` at `top-1 right-1` with `shadow-md` + `focus-visible:ring-2 focus-visible:ring-white` + `hover:bg-red-700`. `e.stopPropagation()` is preserved.
- [x] `ScreenshotThumbnail` accepts `onOpen?: (s: Screenshot) => void`. When present, an expand button renders at `top-1 left-1` with the inline-SVG Maximize2 icon, `aria-label`, `data-testid="screenshot-thumbnail-expand"`, and `e.stopPropagation()`.
- [x] `ScreenshotTimeline.tsx` forwards `onOpen` to each `<ScreenshotThumbnail>`.
- [x] `src/renderer/src/components/ScreenshotLightbox.tsx` exists with the documented prop surface + closed-state null-safety + `screenshot-lightbox-close` + `screenshot-lightbox-img` + `screenshot-lightbox-delete` testids.
- [x] The `fileName` extraction uses the same `screenshot.filePath.replace(/^.*[\\/]/, '')` as ProcedureReview's video src composition.
- [x] `src/renderer/src/pages/ProcedureReview.tsx` imports `ScreenshotLightbox`, adds `lightboxScreenshot` state, passes `onOpen={setLightboxScreenshot}` to the `<ScreenshotTimeline>` mount, and renders `<ScreenshotLightbox>` once with `onDelete={handleDelete}`.
- [x] No new dependencies added.
- [x] All 491 pre-existing + 8 new tests pass.

## Next Phase Readiness

- **G-05-8/9/10 closed.** UAT steps 3 + 4 (capture during playback + click thumbnail to seek) are re-runnable AND the doctor's mid-procedure workflow is now end-to-end visible. After this SUMMARY exists, the doctor can re-test: open Procedure Room → click Record → press S twice → see the gallery panel populate → click the red × on the wrong capture → see the Toast-undo offer → stop recording → navigate to Procedure Review → click an expand icon → see the lightbox at 1280-px native resolution → Esc / click-outside to close.
- **Phase 5 status.** All 4 original plans (05-01..05-04) + 3 gap-closure plans (05-05 + 05-06 + 05-07) shipped end-to-end. 499 tests pass. `/gsd-verify-work 5` should re-run the full UAT to close out the gap list (G-05-3 + G-05-5 + G-05-8 + G-05-9 + G-05-10 resolved; G-05-11 + G-05-12 still open as separate gap-closure plans 05-08 / 05-09).
- **Phase 6 readiness.** Doctor Profile + Report Editor + PDF Generation can begin planning. `Screenshot.filePath` is now a stable contract surfaced through the lightbox; the report editor's "embed screenshot" path will reference the same `/media/` route without surprises.

## User Setup Required

None - no external service configuration required.

## Self-Check

**Status: PASSED**

- **SUMMARY.md exists:** pending write to `.planning/phases/05-screenshots-procedure-review-trim/05-07-SUMMARY.md`
- **Per-task commits exist:**
  - `c0d6382` — feat(05-07): gallery in ProcedureRoom + × discoverability + onOpen prop surface (G-05-8/9/10 prep)
  - `9465012` — feat(05-07): ScreenshotLightbox via shadcn Dialog + ProcedureReview onOpen mount (G-05-10)
  - `bc1b8b3` — test(05-07): gallery + × class list + lightbox contract guards (G-05-8/9/10)
- **Modified files all exist and contain the expected changes:**
  - `src/renderer/src/components/ScreenshotThumbnail.tsx` — × button class list now contains `h-6`, `w-6`, `bg-red-600`, `top-1`, `right-1`, `shadow-md`, `focus-visible:ring-2`, `focus-visible:ring-white`, `hover:bg-red-700`. New `onOpen` prop + `handleExpand` + `<button data-testid="screenshot-thumbnail-expand">` with inline Maximize2 SVG.
  - `src/renderer/src/components/ScreenshotTimeline.tsx` — new `onOpen?` prop; forwarded to each `<ScreenshotThumbnail onOpen={onOpen} />`.
  - `src/renderer/src/pages/ProcedureRoom.tsx` — new imports + new `handleScreenshotDelete` callback + new gallery mount in the right aside with `data-testid="procedure-room-gallery-section"`.
  - `src/renderer/src/components/ScreenshotLightbox.tsx` (new) — full file exists with the documented prop surface.
  - `src/renderer/src/pages/ProcedureReview.tsx` — new `lightboxScreenshot` state + `onOpen={setLightboxScreenshot}` on the existing `<ScreenshotTimeline>` mount + `<ScreenshotLightbox>` mounted at the page root.
  - `tests/renderer/components/ScreenshotTimeline.test.tsx` — 3 new tests added at the end of the existing `describe('ScreenshotTimeline')` block.
  - `tests/renderer/components/ScreenshotLightbox.test.tsx` (new) — 3 tests + happy-dom pragma + setup import.
  - `tests/renderer/pages/procedure-room-timer.test.tsx` — new `describe('ProcedureRoom screenshot gallery (G-05-8)')` block with 2 tests + `within` import + `screenshotToastStore` import.
- **Final test run:** PASS — `npm run test:unit` reports 499/499 tests pass across 63 files (491 baseline + 8 new assertions, no regressions).
- **Typecheck:** PASS — `npm run typecheck:web` completes without errors.

---

*Phase: 05-screenshots-procedure-review-trim*
*Plan: 07 (gap-closure round 3)*
*Completed: 2026-08-07*
*Gaps closed: G-05-8 (mid-procedure gallery), G-05-9 (× discoverability), G-05-10 (full-size lightbox)*
