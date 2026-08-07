---
status: diagnosed
trigger: "G-05-8/9/10/12 UAT findings — ProcedureRoom screenshot gallery + thumbnail × discoverability + lightbox + Trim visual timeline"
created: 2026-08-07T17:15:00.000Z
updated: 2026-08-07T17:15:00.000Z
goal: find_root_cause_only
---

## Current Focus

goal: find_root_cause_only — return ROOT CAUSE FOUND for all 4 gaps, group fixes
next_action: done — four gaps diagnosed; await plan-phase to schedule the two fix plans

## Symptom Grouping (decides fix-plan shape)

| Gap | Symptom | Group |
|-----|---------|-------|
| G-05-8 | Mid-procedure screenshots invisible in ProcedureRoom (no gallery panel) | Gallery |
| G-05-9 | × button on thumbnail not discoverable | Gallery |
| G-05-10 | No full-size lightbox on thumbnail click | Gallery |
| G-05-12 | Trim panel shows only text + red region, no frame-level visual | Trim timeline (separate plan) |

All three "Gallery" gaps touch the same surface (`ScreenshotTimeline` + `ScreenshotThumbnail` + a new `useScreenshotIntake` consumer in `ProcedureRoom`) and reuse the same IPC paths (`screenshots.list` + `screenshots.delete` + the `/media/` route) — they belong in ONE plan. G-05-12 touches a different surface (`TrimControls` + `Scrubber`) and reuses different state (trim in/out, captured-screenshot positions). It goes in a SEPARATE plan.

---

## G-05-8 — ProcedureRoom screenshot gallery + delete

### Symptoms
expected: While recording, the doctor can press `S` or click the Camera button to capture a frame AND see the captured screenshot appear in a gallery panel inside ProcedureRoom, with delete (Toast-undo) per thumbnail.
actual: Captures land in the DB (`useScreenshotIntake.capture()` calls `window.api.screenshots.add(...)`, see `useScreenshotIntake.ts:83-87`) and the `screenshots[]` array in hook state grows (`useScreenshotIntake.ts:88`), but the ProcedureRoom page NEVER renders anything that consumes `screenshotIntake.screenshots` or `screenshotIntake.loading`. The captured frames are invisible until the user navigates to `ProcedureReview` post-stop.
reproduction: `npm run dev` → open Procedure Room → click Record → press `S` twice → observe no visible list of screenshots appears anywhere on the page. Stop recording → Procedure Review DOES show them.
errors: none surfaced to the user; the feature silently fails to render.
started: always broken (Plan 01 wired the capture IPC; the visible-side rendering was never plumbed).

### Current state

`src/renderer/src/pages/ProcedureRoom.tsx:144-150` instantiates the hook:
```ts
const screenshotIntake = useScreenshotIntake({ procedureId, sourceRef, isRecording, startedAt });
```
…then only uses `.capture()` (line 158, called from `handleScreenshotCapture`). The returned `screenshots`, `loading`, `error` fields are destructured but never read.

`useScreenshotIntake.ts:39-63` does populate `screenshots` from `window.api.screenshots.list({ procedureId })` on mount (so the data is reachable) and `useScreenshotIntake.ts:88` appends each new capture to the same state — the gallery data path is 100% complete on the hook side.

`ScreenshotTimeline` is mounted ONLY in `ProcedureReview.tsx:321-329`. A grep across the renderer confirms zero other consumers (`grep "ScreenshotTimeline" src/` returns the import + the single mount).

### Root cause

**Plan scope omission in 05-01/05-02, not a runtime bug.** The Phase 5 plan scope locked `ScreenshotTimeline` to the post-recording review surface. `05-01-PLAN.md` (must_haves.truths) explicitly limits the deliverable to REV-02 ("Clickable screenshot timeline seeks `<video>` to the timestamp of each thumbnail") + REV-03 ("Post-recording screenshot capture via `<video>` + canvas snapshot"), both scoped to `ProcedureReview`. `05-02-PLAN.md` extends the ScreenshotTimeline with annotation + Toast-undo but does NOT add a `ProcedureRoom` consumer. `05-02-PLAN.md:46` notes "ProcedureRoom — no UI changes; Plan 02's only job in the Procedure Room is to ensure the `S` hotkey + Camera button remain wired (carry-forward verification — no changes from Plan 01)" — which means the gallery mounting was deliberately out of scope, not forgotten mid-implementation.

The hook (`useScreenshotIntake`) was built dual-purpose per `useScreenshotIntake.ts:1-13` ("1. ProcedureRoom S hotkey + Camera button (mid-procedure)… 2. ProcedureReview +Capture button (post-recording)"), but only #2 ever consumed the screenshots list. The hook returns the data, the page ignores it.

This is the documented test-3 gap from `05-UAT.md` ("the mid-procedure screenshot experience is incomplete") restated as a planning gap rather than a runtime gap.

### Evidence

- `useScreenshotIntake.ts:26-31` — return type exposes `screenshots: Screenshot[]`, `loading: boolean`, `error: string | null`
- `useScreenshotIntake.ts:44-63` — `useEffect` on `procedureId` calls `window.api.screenshots.list({ procedureId })` and seeds local state
- `useScreenshotIntake.ts:88` — every successful capture appends `setScreenshots((prev) => [...prev, created])`
- `ProcedureRoom.tsx:144-164` — hook is destructured but only `.capture()` is read
- `ProcedureRoom.tsx:263-405` — render body has NO `<ScreenshotTimeline>` element; the right aside is a `<ProcedureNotesPanel>` + `<DeviceLostBanner>`
- `grep -r "ScreenshotTimeline" src/` → exactly 2 matches: the import in `ProcedureReview.tsx` and the single `<ScreenshotTimeline>` mount there
- `ipc-contract.ts:355` — `screenshots.list({ procedureId })` exists and is fully wired; `ProcedureRoom` already calls it indirectly via `useScreenshotIntake`

### Why the test suite didn't catch it

`tests/renderer/pages/procedure-room-timer.test.tsx` (the only ProcedureRoom page test, 563 lines) focuses on the timer + recording subscription + pause/resume + lastLost banner. It does NOT render the page in "mid-procedure screenshots captured" state, nor does it assert any gallery DOM. The closest assertion is `expect(screen.getByTestId('procedure-duration'))` for the timer label.

`tests/renderer/components/ScreenshotTimeline.test.tsx` unit-tests the gallery component in isolation (always-visible ×, click-to-seek, +Capture gate) but never mounts it inside `ProcedureRoom` to verify the integration. `ScreenshotTimeline` is tested as a leaf component, not as part of a page flow.

`useScreenshotIntake` has no direct unit test file (no `useScreenshotIntake.test.ts` exists — verified via glob). Its `screenshots[]` population behavior is exercised only through the ProcedureRoom page test, which never asserts on it.

### Files involved

- `src/renderer/src/pages/ProcedureRoom.tsx` — add `<ScreenshotTimeline>` mount in the existing right aside (or a new compact strip below the preview pane) + wire `onCapture={handleScreenshotCapture}` + a delete handler that calls `screenshotToastStore.enqueueDelete` + `window.api.screenshots.delete({ id })` (already exists in `ipc-contract.ts:356`)
- `src/renderer/src/components/ScreenshotTimeline.tsx` — no change; reuse as-is
- `src/renderer/src/store/screenshot-toast.ts` — already exposes `enqueueDelete` + `undoDelete` (imported by `ProcedureReview.tsx:31`); reuse the same store
- `src/renderer/src/hooks/useScreenshotIntake.ts` — no change; the hook is already correct
- `src/renderer/src/pages/ProcedureReview.tsx` — no change (this is additive)

### Suggested fix direction (1 sentence)

Mount a compact `<ScreenshotTimeline>` (or a new `<MidProcedureGallery>` wrapper around it) in `ProcedureRoom.tsx`'s right aside, fed from `screenshotIntake.screenshots` + the same `handleScreenshotCapture` + a new delete handler that calls `screenshotToastStore.enqueueDelete` + `window.api.screenshots.delete` (Toast-undo reuses the existing store).

---

## G-05-9 — Delete button visibility on timeline thumbnails

### Symptoms
expected: Doctor can immediately find the delete affordance on each screenshot thumbnail — clearly visible (not hidden behind hover), reasonably large, well-contrasted, with a discoverable label.
actual: Doctor reports "i need to be able to delete them" — the × control is hard to find at a glance. They learn it exists after pressing the thumbnail accidentally doesn't delete.
reproduction: Open Procedure Review → click `+Capture` twice → look at the timeline strip. The × is in the DOM at top-right of each thumbnail, but it reads as a small dark glyph against the captured medical frame.
errors: none; the control does work, it's just visually weak.
started: shipped this way from Plan 02 (the × + Toast-undo wiring landed in 05-02 commit `9e2b007` per `05-VERIFICATION.md:43`).

### Current state

`src/renderer/src/components/ScreenshotThumbnail.tsx:102-111` renders the delete control:
```tsx
{onDelete ? (
  <button
    type="button"
    onClick={handleDelete}
    aria-label={`Delete screenshot at ${formatDurationHHMMSS(screenshot.timestampInVideoMs)}`}
    className="absolute right-1 top-6 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-red-600"
  >
    ×
  </button>
) : null}
```

The button IS always rendered (not hover-only) — the UAT hypothesis "hover-only" is incorrect; the button is in the DOM unconditionally when `onDelete` is defined. `ScreenshotTimeline.test.tsx:140-152` explicitly verifies this: "renders no × button when onDelete is undefined (Plan 01 baseline)".

However, the visual discoverability is genuinely weak:
- **`h-5 w-5`** = 20×20px hit target (below the 24×24 minimum a gloved clinician can reliably hit)
- **`text-xs`** = 12px font size for the `×` glyph
- **`bg-black/60`** = translucent black, blends into dark frames and competes with bright frames
- **`top-6`** = 1.5rem from the top of the card — when the annotation caption strip (`top-0` + `py-0.5` = ~1.25rem) is present (`onAnnotate` wired in ProcedureReview), the × sits immediately below the caption, visually competing with it for the same top-right region
- **`hover:bg-red-600`** is the only state change — no focus ring, no always-on red border, no icon weight change

### Root cause

**Visual hierarchy omission in Plan 02, not a runtime bug.** The deletion affordance was wired for correctness (the click handler is correct, Toast-undo integration is correct, `e.stopPropagation()` prevents the seek-on-click parent handler from firing — `ScreenshotThumbnail.tsx:48-50`). The deliverable scope was "delete works", not "delete is discoverable in a clinical context". The button dimensions + contrast + icon weight were chosen to fit the 120×110 card layout without crowding the annotation caption, not to maximize discoverability.

The UAT audit note (`05-UAT.md` G-05-9 reason) "either the × is hover-only (hidden by default) or otherwise not discoverable" was the right concern in spirit (discoverability) but misdiagnosed the mechanism (the button is in fact always visible).

### Evidence

- `ScreenshotThumbnail.tsx:102-111` — class list (verified: no `opacity-0` + `group-hover` pattern anywhere; the button is rendered unconditionally)
- `ScreenshotTimeline.tsx:14-27` — passes `onDelete` through to each thumbnail
- `ScreenshotTimeline.test.tsx:140-152` — confirms the × button is rendered whenever `onDelete` is defined (the test calls `getAllByLabelText(/Delete screenshot at/)` and expects 2 matches)
- `ScreenshotTimeline.test.tsx:55-74` — confirms clicking × calls `onDelete` with the right arg and does NOT trigger `onSeek`
- No test asserts the button is **visible** (no assertion on computed style, bounding box, opacity, or hit target size)

### Why the test suite didn't catch it

The existing tests assert:
- The button is in the DOM when `onDelete` is defined (`ScreenshotTimeline.test.tsx:140-152`)
- Clicking it calls `onDelete` (`ScreenshotTimeline.test.tsx:55-74`)

Neither test verifies the button's *visual discoverability* — there is no test that asserts:
- Minimum hit-target size (e.g., `expect(button).toHaveStyle({ minWidth: '24px' })`)
- Permanent visibility (vs `opacity: 0` revealed on hover)
- Color contrast ratio against the thumbnail background
- Position doesn't conflict with adjacent controls (annotation strip)

A "button is present in the DOM" assertion passes whether the button is 16×16 or 40×40, whether it has 60% opacity or 100%, whether it uses a subtle gray glyph or a bold red badge.

### Files involved

- `src/renderer/src/components/ScreenshotThumbnail.tsx:102-111` — bump `h-5 w-5` to `h-6 w-6` (24×24), bump `text-xs` to `text-sm`, switch `bg-black/60` to `bg-red-600` with `text-white` (no opacity blur — solid red disc), add `focus-visible:ring-2 focus-visible:ring-white` for keyboard discoverability, reposition to `top-1 right-1` when `onAnnotate` is set so it doesn't crowd the caption strip
- `src/renderer/src/components/ScreenshotThumbnail.tsx:107` — keep the hover state change but add a subtle shadow (`shadow-md`) for affordance
- `tests/renderer/components/ScreenshotTimeline.test.tsx` — add a discoverability assertion: `expect(deleteButtons[0]).toBeVisible()` + assertion on computed `minWidth >= 24` (happy-dom doesn't compute layout, so this is best-effort; alternative: snapshot-style assertion on the className list to lock in `h-6 w-6 bg-red-600`)

### Suggested fix direction (1 sentence)

Replace the 20×20 translucent-black × glyph with a 24×24 solid-red badge using a stronger × icon (or the word "Delete"), reposition it to `top-1 right-1` so it doesn't collide with the annotation strip, and add a regression test that asserts the className list locks the new size + color (DOM presence alone is not enough to catch discoverability regressions).

---

## G-05-10 — Lightbox / full-size view

### Symptoms
expected: Clicking a thumbnail in `ScreenshotTimeline` opens a full-size lightbox/modal showing the captured JPEG at its native resolution (~1280×720 per `D-04` capture-screenshot spec) so the doctor can verify clinical detail before finalizing the report.
actual: Clicking a thumbnail only calls `onSeek(screenshot.timestampInVideoMs)` (`ScreenshotThumbnail.tsx:47`) — the `<video>` seeks but the screenshot's actual JPEG bytes never get a render surface larger than the 120×90 thumbnail area.
reproduction: Procedure Review → click `+Capture` → click the new thumbnail → video seeks to the timestamp; the user never sees the high-resolution JPEG.
errors: none; the click handler is correct, it just does the wrong (or insufficient) thing.
started: always broken. `ScreenshotThumbnail` has never had a lightbox/modal consumer; the deliverable was scoped to "seek only".

### Current state

`src/renderer/src/components/ScreenshotThumbnail.tsx:47`: `const handleClick = (): void => onSeek(screenshot.timestampInVideoMs);` — single side-effect, no lightbox trigger.

`src/renderer/src/components/ScreenshotTimeline.tsx`: no lightbox state, no modal mount, no `onClick` callback to a parent modal handler.

`src/renderer/src/pages/ProcedureReview.tsx:60-220`: no `selectedScreenshot` / `lightboxOpen` state in the page. No modal/dialog component mounted. No `window.api.screenshots.get` or full-size URL composition (the IPC contract at `ipc-contract.ts:353-358` only exposes `add/list/delete/updateAnnotation` — no per-row fetch, but `list` already returns `filePath` so no extra IPC is needed).

The `/media/` route on the MediaServer (`src/main/recorder/preview-server.ts` per `05-03-PLAN.md:46`) serves files under `data/media/patients/<patientId>/<procedureId>/<file>` — this is currently used for the trimmed/original `video.mp4` only. The same route accepts a `screenshots/<ts>.jpg` filename and would serve it without any new server work, since `Screenshot.filePath` follows the `data/media/patients/<p>/<proc>/screenshots/<ts>.jpg` shape (verified from the `ProcedureReview.test.tsx` fixture, line 76-83 + `useScreenshotIntake.ts` fixture).

Grep for `lightbox|Lightbox|fullsize|full-size` across the renderer returns zero matches — no modal exists.

### Root cause

**Plan scope omission in 05-01/05-02, not a runtime bug.** The plan `must_haves.truths` for REV-02 ("Clickable screenshot timeline seeks `<video>` to the timestamp of each thumbnail") locks the click side-effect to seek-only. The 1280-px JPEG is captured per `D-04` but the only render surface in the plan scope was the 120×90 thumbnail strip. There is no `Modal` / `Dialog` (shadcn) consumer in Phase 5 code; the `ui/dialog.tsx` primitive would need to be added or an inline fixed-position overlay would have to be written.

The Phase 5 CONTEXT (`05-CONTEXT.md`) notes "screen the doctor can verify a capture before finalizing the procedure report" as part of REV-02's spirit, but no plan task picked up the lightbox requirement — it was deferred to "Phase 6+" implicitly. `05-VERIFICATION.md:78` (Deferred to Phase 6+) lists "REV-05 — video annotations" but does NOT list the lightbox, which means it was likely considered out of scope at plan time rather than consciously deferred.

### Evidence

- `ScreenshotThumbnail.tsx:47` — click handler is `onSeek` only; no `onOpen` / no modal trigger
- `ScreenshotTimeline.tsx:14-27` — props surface has `onSeek` + `onCapture` + `onDelete` + `onAnnotate`, no `onOpen` / `onShowFullsize`
- `grep -r "lightbox|Lightbox|fullsize|full-size" src/renderer/src` → zero matches
- `ProcedureReview.tsx` — no `selectedScreenshot` / `lightboxOpen` useState; no `<Dialog>` mount
- `ProcedureReview.tsx:123-127` — the `/media/<patientId>/<procedureId>/<file>` URL composition is only built for `procedure.videoPath`, never for a screenshot's `filePath`
- `Screenshot.filePath` (from `ipc-contract.ts:215-222`) follows the `data/media/patients/<p>/<proc>/screenshots/<ts>.jpg` shape, so the existing `/media/` route serves it without any new IPC contract work

### Why the test suite didn't catch it

The test suite asserts the click handler triggers `onSeek` with the right timestamp (`ScreenshotTimeline.test.tsx:35-53`). It does not assert the absence of a lightbox, nor does it mock a missing modal mount. A test that asserted "clicking a thumbnail opens a modal" would have failed before any feature work began, signaling the gap — but no such test exists, because the plan never asked for one.

The plan spec for REV-02 explicitly accepts seek-only as the deliverable truth ("Clickable screenshot timeline seeks `<video>` to the timestamp of each thumbnail"). Tests are designed against the spec, not against user intent.

### Files involved

- `src/renderer/src/components/ScreenshotThumbnail.tsx:47` — extend the click to accept an optional `onOpen?: (s: Screenshot) => void` callback; if both `onSeek` and `onOpen` are defined, the click fires `onOpen` first; if only `onSeek`, behavior is unchanged. Easiest: keep seek-on-click as the default and add a double-click handler (or a dedicated "View fullsize" button on the card) for the lightbox. Even simpler: add a small "expand" icon next to the × that opens the lightbox.
- `src/renderer/src/components/ScreenshotTimeline.tsx` — add `onOpen` prop, pass through
- `src/renderer/src/components/ScreenshotLightbox.tsx` (new) — fixed-position overlay with the JPEG `<img src={mediaUrl + '/media/' + patientId + '/' + procedureId + '/' + filename} />`, close on Esc / click-outside / × button, shows timestamp + annotation, reuses `screenshotToastStore.enqueueDelete` for parity with timeline delete
- `src/renderer/src/pages/ProcedureReview.tsx` — mount `<ScreenshotLightbox>` with `selectedScreenshot` state; pass `onOpen={setSelectedScreenshot}` to `<ScreenshotTimeline>`
- `src/renderer/src/pages/ProcedureRoom.tsx` — same if the gallery mount (G-05-8) lands in the same plan

### Suggested fix direction (1 sentence)

Add a `<ScreenshotLightbox>` modal (fixed-position overlay, close on Esc / click-outside / ×) that consumes the existing `/media/` route with `screenshot.filePath`, wire it through a new `onOpen` prop on `ScreenshotThumbnail` + `ScreenshotTimeline`, and trigger it from a dedicated expand affordance on each thumbnail (keeps seek-on-click semantics for users who don't discover the new affordance).

---

## G-05-12 — Visual timeline in Trim UI

### Symptoms
expected: When the doctor toggles Trim mode, the right rail shows a clear frame-level visual representation of the trim range: in-frame preview thumbnail, out-frame preview thumbnail, a tick scale under the scrubber (every 5s/10s), and a mini-timeline showing where captured screenshots fall relative to the trim window.
actual: The right rail `TrimControls` panel only renders text labels ("In: 00:00:05 · Out: 00:00:25") + an `Apply` button + a `Restore` button (`TrimControls.tsx:86-95`). The Scrubber shows two handles + a red-shaded cut region (`Scrubber.tsx:165-176`), but there is no frame preview, no tick scale, and no screenshot-position overlay.
reproduction: Procedure Review → click Trim → drag handles to 5s and 25s → the right rail shows only HH:MM:SS text. The doctor has to play + scrub to figure out what each handle's frame corresponds to.
errors: none; the labels are correct, the visual is just sparse.
started: shipped this way from Plan 03 (TrimControls + Scrubber trim handles landed in 05-03 per `05-VERIFICATION.md:42-43`).

### Current state

`src/renderer/src/components/TrimControls.tsx:86-95` — only renders the `In: HH:MM:SS · Out: HH:MM:SS` labels. No thumbnails, no ticks, no screenshot-position visualization. The component receives `inMs` / `outMs` / `durationMs` / `status` / `trimMode` / `setTrimMode` / `applying` / `restoring` / `apply` / `restore` — all numeric/boolean controls, no Screenshot-shaped data, no Scrubber reference.

`src/renderer/src/components/Scrubber.tsx:116-123` — only renders `segments` (pause markers). It does NOT render `screenshots` (captured screenshot positions). It does NOT render a tick scale (no `0s / 5s / 10s / 15s / 20s / 25s / 30s` markers below the track). It does NOT show in-frame or out-frame preview thumbnails.

`src/renderer/src/components/TrimControls.tsx:43-55` — props surface:
```ts
status, videoPathOriginal, inMs, outMs, durationMs, trimMode, setTrimMode, applying, restoring, apply, restore
```
No `screenshots` / `onSeek` / `onSeekToIn` / `onSeekToOut` props. No way to render frame previews without extending the surface.

`src/renderer/src/pages/ProcedureReview.tsx:338-350` — `TrimControls` is mounted with the 10 above props. `screenshots` is available in scope (line 60 destructures it from `useProcedures`) but is not passed down.

### Root cause

**Plan scope omission in 05-03, not a runtime bug.** The plan `must_haves.truths` for REV-04 explicitly defines the trim UX as "two draggable handles + red-shaded cut region between them" (`05-03-PLAN.md:47`, `05-03-PLAN.md:69`). Frame-level visual feedback (in-frame thumbnail, out-frame thumbnail, tick scale, screenshot-position overlay) is not in any truth. The plan was explicitly tested against this minimal UX — `tests/renderer/components/TrimControls.test.tsx:33-38` asserts only the `trim-in-label` / `trim-out-label` text content.

The Scrubber's pause-marker support (`Scrubber.tsx:116-123`) was designed to render `ProcedureSegment[]`, not `Screenshot[]`. The contract doesn't have a `screenshots` prop on Scrubber. Extending Scrubber to also render captured-screenshot positions requires either (a) a new prop `screenshots?: Screenshot[]` on Scrubber with positioning logic mirroring `markers` at `pctFor(s.timestampInVideoMs, durationMs)`, or (b) a separate `<TrimScreenshotOverlay>` component rendered adjacent to (or overlaid on) the Scrubber.

### Evidence

- `TrimControls.tsx:43-55` — prop list has no `screenshots`, no `onSeek`, no preview-frame data path
- `TrimControls.tsx:86-95` — renders only text labels (`data-testid="trim-in-label"` + `data-testid="trim-out-label"`) and two buttons
- `Scrubber.tsx:19-33` — props are `durationMs`, `currentMs`, `onSeek`, `segments`, `trimMode`, `inMs`, `outMs`, `onTrim` — no `screenshots` prop, no `screenshotsMarkerClassName` slot
- `Scrubber.tsx:155-164` — only pause-marker DOM; zero tick scale, zero screenshot-overlay DOM
- `Scrubber.tsx:165-193` — only trim handles + red region; zero in-frame / out-frame preview popovers
- `ProcedureReview.tsx:60` — `screenshots` IS available in scope from `useProcedures`, but `ProcedureReview.tsx:338-350` does not pass it down to `TrimControls`
- `TrimControls.test.tsx` — only asserts text labels, button enable/disable, button click → callback. No visual-element assertions beyond text content

### Why the test suite didn't catch it

The tests assert the canonical "trim UX works" contract:
- `TrimControls.test.tsx:33-38` — `trim-in-label` and `trim-out-label` text content
- `TrimControls.test.tsx:27-31` — Apply + Restore buttons render
- `TrimControls.test.tsx:40-77` — disabled states for partial / no original / invalid range / in-flight
- `TrimControls.test.tsx:79-84` — `trimMode=false` hides everything
- `Scrubber.test.tsx:103-129` — trim handles render with `data-testid="scrubber-trim-handle-in/out"` + `data-testid="scrubber-trim-region"`

The tests verify the **mechanism** (handles drag, region shades, buttons enable/disable) but NOT the **visual sufficiency** (no test asserts a frame preview exists, no test asserts a tick scale, no test asserts a screenshot-position marker is shown). The spec was tested, but the spec was minimal.

### Files involved

- `src/renderer/src/components/TrimControls.tsx:29-55` — extend props with `screenshots: Screenshot[]` and `onSeek: (ms: number) => void`
- `src/renderer/src/components/TrimControls.tsx:86-95` — add a `<TrimTimelinePreview>` (in-frame thumbnail at left, out-frame thumbnail at right) — fetch the frame by seeking `<video>` to `inMs` / `outMs` and using `captureScreenshot(videoRef)` (already exists at `src/renderer/src/lib/capture-screenshot.ts`)
- `src/renderer/src/components/Scrubber.tsx:19-33` — add `screenshots?: Screenshot[]` prop; render small overlay dots on the track at `pctFor(s.timestampInVideoMs, durationMs)` (mirror `markers` logic at line 116-123)
- `src/renderer/src/components/Scrubber.tsx:134-148` — add a tick-scale strip below the track (every 5s or 10s depending on `durationMs`) — render only when `trimMode === true`
- `src/renderer/src/pages/ProcedureReview.tsx:338-350` — pass `screenshots={screenshots}` + `onSeek={handleSeek}` to `TrimControls`
- `tests/renderer/components/TrimControls.test.tsx` — add: `data-testid="trim-in-preview"` + `data-testid="trim-out-preview"` assertions
- `tests/renderer/components/Scrubber.test.tsx` — add: when `screenshots` prop is supplied, renders one `data-testid="scrubber-screenshot-marker"` per row at the expected left percent

### Suggested fix direction (1 sentence)

Extend `TrimControls` to render in-frame + out-frame JPEG previews (sourced via `captureScreenshot(videoRef)` at `inMs` / `outMs`) and pass `screenshots` to `Scrubber` as a new optional prop that renders dot markers at each capture's `timestampInVideoMs / durationMs` position, plus a tick-scale strip below the track when `trimMode === true` — group all three additions into a single "Trim visual timeline" plan.

---

## Resolution

root_cause: (see per-gap sections above — all four are plan-scope omissions, not runtime bugs)
fix: not in this diagnostic — fixes belong in two separate plans: (1) Gallery plan covering G-05-8 + G-05-9 + G-05-10; (2) Trim-visual plan covering G-05-12
verification: not in this diagnostic
files_changed: []

---

## Eliminated

(none yet — these are documented UAT gaps from `05-UAT.md`, not hypotheses to falsify)

## Evidence Summary

| Gap | Root Cause Type | Files | Tests Missed It Because |
|-----|-----------------|-------|------------------------|
| G-05-8 | Plan scope omission (05-01/02) | `ProcedureRoom.tsx` (no timeline mount) | page test asserts timer + recording, never gallery DOM |
| G-05-9 | Plan scope omission (05-02) | `ScreenshotThumbnail.tsx:102-111` | asserts button is present, not visible/discoverable |
| G-05-10 | Plan scope omission (05-01/02) | `ScreenshotThumbnail.tsx:47` + new modal needed | tests assert seek-on-click, not lightbox absence |
| G-05-12 | Plan scope omission (05-03) | `TrimControls.tsx` + `Scrubber.tsx` props | tests assert text labels + handles, not visual sufficiency |

## Plan Grouping

**Plan A — Screenshot gallery + delete + lightbox** (G-05-8 + G-05-9 + G-05-10):
- 1 feature area (the screenshot timeline UX across both ProcedureRoom and ProcedureReview)
- Same IPC paths (`screenshots.list` / `screenshots.delete` / `/media/` route)
- Same component surface (`ScreenshotTimeline` + `ScreenshotThumbnail`)
- Roughly 1 plan, 3-4 tasks (mount gallery in ProcedureRoom; bump × button discoverability; new `<ScreenshotLightbox>` modal + `onOpen` prop wiring)

**Plan B — Trim visual timeline** (G-05-12):
- Different feature area (the trim UX visual feedback)
- Different state surface (in/out frame previews need `videoRef` capture + new Scrubber `screenshots` prop + tick scale)
- Different components (`TrimControls` + `Scrubber`, no ScreenshotTimeline touch)
- 1 plan, 1-2 tasks (extend TrimControls with frame previews + extend Scrubber with screenshot markers + tick scale)
