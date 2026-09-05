---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 16
subsystem: license + crop
tags: [feat, crop-mode, gap-closure]
gap_closure: true
gap_ids: [G-08-9]
status: complete
---

# Phase 8 Plan 16: ScreenshotCropModal — Rectangle + Free-hand crop modes

## One-liner

Added a 3-mode toggle (Rectangle | Free-hand | Polygon, Rectangle default)
to `ScreenshotCropModal` so doctors can crop with one drag instead of
clicking 4+ polygon vertices per selection.

## Files Touched

| File | Change |
| --- | --- |
| `src/renderer/src/components/ScreenshotCropModal.tsx` | Mode state + mode-aware mousedown/move/up handlers, mode-toggle UI, in-progress rectangle + freehand preview SVGs. Unified all three modes onto the existing `finalPolygon` (was `points`) so the IPC contract is unchanged. |
| `src/renderer/src/i18n/en/translation.json` | +4 keys: `cropModeRectangle`, `cropModeFreehand`, `cropModePolygon`, `cropModeHint`. |
| `src/renderer/src/i18n/ar/translation.json` | +4 keys (Arabic: مستطيل / يدوي حر / مضلع / اختر نمطاً، ثم اسحب للتحديد). |
| `tests/renderer/components/screenshot-crop-modal.test.tsx` | +6 new tests (default mode, Rectangle commit, Rectangle <10px rejection, Rectangle Apply IPC, Free-hand sampling, mode-switch clears, polygon-mode regression). Updated `clickPolygonVertices` helper to (a) click the Polygon mode button first and (b) use `mouseDown` instead of `click` because Plan 16 moved polygon-mode vertex-add off `onClick` and onto `onMouseDown` to share a single handler with the other modes. |

## Verification

- `npm run typecheck:web` — **passes for ScreenshotCropModal + translation.json** (the 7 pre-existing errors in `useReport.ts` / `ReportEditor.tsx` are from the unrelated `20260812-redesign-report-procedure-type` quick task — confirmed by stashing my changes and re-running).
- `node scripts/run-vitest.cjs --run tests/renderer/components/screenshot-crop-modal.test.tsx` — **18/18 pass** (12 pre-existing Plan 15 tests still green + 6 new Plan 16 tests).
- Full `tests/renderer/` vitest sweep — **341/341 unit tests pass**. The 9 "Failed Suites" under `tests/renderer/rtl/*.test.ts` are pre-existing infrastructure noise (Playwright tests being collected by vitest with the wrong `test()` import) and exist without my changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mouseup bbox used stale state — committed rectangle was off by the last mousemove's worth of drag.**
- **Found during:** Verification (first test run after the implementation).
- **Issue:** `handleSurfaceMouseUp` read the release point from `prev.end` (the React state set by the last `mousemove`). Under React 18 batching across close-spaced event ticks, `prev.end` lags by one event, so a drag (100,50)→(200,100)→(250,150)→release(300,200) committed a (100,50)→(250,150) rectangle instead of the full (100,50)→(300,200).
- **Fix:** `handleSurfaceMouseUp` now reads `pointFromEvent(e)` directly off the mouseup event and uses that as the final end point. The start point still comes from the functional `setRect` updater (which sees the latest committed start via React's queue). Freehand mode got the same treatment — the release point is appended as the final sample so the committed path always reaches the cursor's release position.
- **Files modified:** `src/renderer/src/components/ScreenshotCropModal.tsx`
- **Verification:** Test "Rectangle mode — one drag commits 4 corners" now asserts the exact (300,50)/(300,200) corner positions, and "Rectangle Apply sends the bbox polygon" asserts the natural-pixel bbox equals (200..600, 100..400) — both pass.

### Plan-acknowledged simplifications

- **Keyboard backspace on a committed rectangle** removes one corner and leaves a 3-vertex degenerate polygon. Apply still works (the IPC contract collapses to bbox regardless). Documented in the `handleKeyDown` comment; v1 acceptable, v1.1 can disable backspace in non-polygon modes if user feedback says so.
- **`onMouseLeave` cancels an in-progress drag.** This matches typical editor UX (think of dragging a selection in Figma). If the user wants to commit a partial drag, they keep the cursor on the surface. Documented inline; no extra behaviour needed.

## Decisions

- **Rectangle is the default mode** (per the plan). It's the 80% case for clinical crops (out-crop scope chrome, frame a polyp), so the first-time user lands on the path with the fewest clicks.
- **Unified all three modes onto `finalPolygon`.** Previously only the polygon mode used `points`. Rectangle mode now writes 4 corners on mouseup and freehand mode writes its sampled path; both end up in the same `finalPolygon` that the polygon mode populates incrementally. This kept the IPC contract and the `handleApply`/bbox pipeline untouched.
- **`FIREHAND_MIN_DELTA_PX = 5`** is the documented "trace but don't oversample" sweet spot. Tune up if SVG shows visible polyline zig-zag on fast drags; down if we hit 1k+ vertices per crop.
- **`RECT_MIN_DIM_PX = 10`** rejects accidental clicks (which would otherwise commit a 1-2px rectangle).

## Manual Verification Notes

The plan's manual steps (launch app → Procedure Review → screenshot → Crop → mode toggle visible with Rectangle default → drag → Apply works. Toggle to Free-hand → drag → Apply works. Toggle to Polygon → click-click-click → Apply works; AR language toggle) require a real Electron desktop session, which the executor cannot drive in this Windows sandboxed shell. The unit tests above cover the same code paths that those manual steps exercise (Rectangle commit → Apply IPC; Free-hand sampling → Apply IPC; Polygon regression; mode toggle visible; i18n keys resolve in both EN and AR).

## Self-Check: PASSED

All 4 files exist on disk and are committed as part of this plan's feat commit. The verification command outputs above were captured against the final state of those files.
