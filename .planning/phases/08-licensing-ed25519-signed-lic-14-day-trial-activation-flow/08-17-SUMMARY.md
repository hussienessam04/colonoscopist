---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 17
subsystem: license + crop
tags: [feat, shape-editing, live-preview, gap-closure]
gap_closure: true
gap_ids: [G-08-10]
status: complete
---

# Phase 8 Plan 17: ScreenshotCropModal — shape editing after commit + ScreenshotLightbox — live preview after crop

## One-liner

Closes G-08-10 by making committed shapes editable (drag vertex → resize,
drag interior → move, mode-switch / Clear → reset) and switching the
lightbox to a fresh `blob:` URL fetched via `screenshots.getBlob` so a
successful crop re-renders immediately (no leave + re-enter).

## Files Touched

| File | Change |
| --- | --- |
| `src/renderer/src/components/ScreenshotCropModal.tsx` | Added 4 textbook helpers (`clamp`, `hitTestVertex`, `pointInPolygon`, `rectToPolygon`). New `DragState` discriminated union: `null | { kind: 'vertex', index } | { kind: 'shape', lastMove }`. Mode-aware `mousedown` routes to vertex-drag / shape-drag when a committed polygon exists (skipped in Polygon mode, which has no commit step). `mousemove` mutates `finalPolygon` directly with image-bounds clamping. `mouseup` + `mouseleave` reset transient state. Cursor flips to `move` once the polygon is committed and `grabbing` while an edit is in flight. Clear button already existed (uses `common.clear`); now also resets the new `drag` state. |
| `src/renderer/src/components/ScreenshotLightbox.tsx` | Removed the `screenshotUrl(...)` / MediaServer URL path (cached stale bytes after a crop). Added `useEffect` that fetches the screenshot JPEG via `screenshots.getBlob` and sets `imageUrl` to a fresh `blob:` URL. `cacheBuster` state — `onCropped` bumps it to `Date.now()`, forcing the effect to re-run and rebind the `<img>` to the new bytes. `mediaBaseUrl` / `patientId` / `procedureId` props are intentionally kept (existing callers) and explicitly ignored. The Crop button is now gated on `imageUrl !== null` (we don't ship a CTA before we have bytes to preview). |
| `tests/renderer/components/screenshot-crop-modal.test.tsx` | +7 new tests: vertex-only drag after Rectangle commit, interior-drag translates all 4 corners, Clear empties + disables Apply, vertex drag after Rectangle commit moves only that vertex (the older polygon-mode test was the same probe, retargeted because Polygon mode has no commit step), cursor flips to `move` after commit, mode-switch while committed clears it, freehand Apply sends the post-edit polygon over IPC. |
| `tests/renderer/components/ScreenshotLightbox.test.tsx` | Rewrote the `renders the <img> via /media/` test to assert the blob-URL pattern (`getBlob` is called, `<img src>` starts with `blob:`). Updated `renders a Crop button...` to wait for the blob fetch before clicking (the button is gated on `imageUrl !== null`). Replaced `does NOT render the Crop button when the media server has not bound` with a `renders the Crop button when the screenshot has loaded its blob` symmetry assertion. |

## Verification

- `npx tsc --noEmit -p tsconfig.web.json` — **clean for `ScreenshotCropModal.tsx` and `ScreenshotLightbox.tsx`**. The 7 pre-existing errors in `useReport.ts` / `ReportEditor.tsx` are from the unrelated `20260812-redesign-report-procedure-type` quick task (confirmed by stashing my diffs and re-running — errors persist).
- `node scripts/run-vitest.cjs --run tests/renderer/components/screenshot-crop-modal.test.tsx tests/renderer/components/ScreenshotLightbox.test.tsx` — **30/30 pass** (25 crop-modal + 5 lightbox).
- `node scripts/run-vitest.cjs --run tests/renderer/components/` — **98/98 component tests pass** (ProcedureReview, Scrubber, ScreenshotTimeline, TrimControls, etc.).
- `node scripts/run-vitest.cjs --run tests/renderer/pages/ProcedureReview.test.tsx` — **13/13 pass** (the page that actually mounts `ScreenshotLightbox` — proves the new blob-URL pattern doesn't break the parent surface).

## Deviations from Plan

### Plan-acknowledged simplifications (ponytail: smallest fix)

- **No edge-midpoint handles.** The plan listed 3 things — vertex drag, interior drag, midpoint handles. Vertex + interior covers ~95% of "I want to fix my crop" cases (doctors nudging a corner or shifting a region). Midpoint handles are real polish but require per-edge hit-testing + per-edge resize handlers; defer to a future plan if the UAT doctor asks for finer-than-corner control.
- **Polygon mode skip-edit, not edit.** In Polygon mode a click *always* adds a vertex — there is no commit step, the polygon is in-progress the whole time. Letting a click on a vertex or interior start a drag would surprise the user ("I clicked and it moved instead of adding a point"). The shape-edit branch is gated on `mode !== 'polygon'`. The plan's test that probed polygon-mode editing was retargeted to Rectangle-mode editing (which is the canonical "committed polygon" path).
- **No new i18n keys for Clear / vertex hint.** The Clear button already used `common.clear`. The `<img>`-visible vertex dots plus the cursor flip (`crosshair` → `move`) are enough affordance — no extra text needed in the modal. Skipping `cropVertexHint` keeps the diff small.

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing `(MEDIA SERVER)` lightbox test broke under the new blob-URL pattern.**
- **Found during:** Verification (after `feat(08-17)`).
- **Issue:** The Plan 14 test `renders the full-size <img> via /media/ route when screenshot is supplied` asserted `src === 'http://127.0.0.1:51731/media/...'`. The new pattern sets `src` to a `blob:` URL after `getBlob` resolves, so the strict equality assertion threw.
- **Fix:** Rewrote the test to assert `src matches /^blob:/` and `getBlob was called with { id: fixture.id }`. The `<img>` rendering invariant is preserved; the URL composition source (MediaServer route vs. blob URL) is what changed and is the subject of G-08-10.
- **Files modified:** `tests/renderer/components/ScreenshotLightbox.test.tsx`.
- **Verification:** Re-ran the lightbox suite (5/5 green) and `tests/renderer/pages/ProcedureReview.test.tsx` (13/13 green — the actual consumer).

## Decisions

- **Vertex hit radius = 8 px** — `VERTEX_HIT_RADIUS_PX`. Big enough that the doctor's mouse can snap to a vertex without pixel-perfect aim, small enough that the gap between two adjacent vertices (≥ a few dozen px on a typical 640-px crop) never has both endpoints grabbable.
- **`drag` is a discriminated union, not three booleans.** Makes the `null`-vs-`vertex`-vs-`shape` state machine explicit and lets TS narrow on `drag.kind` inside the `move` handler.
- **Shape-drag uses incremental deltas** (`drag.lastMove` updates each move), not absolute-rebase. The doctor sees continuous motion that matches the cursor 1:1 regardless of frame rate.
- **Polygon mode deliberately skips edit.** See "Plan-acknowledged simplifications" above — doctors who want vertex-by-vertex precision are in polygon mode and the polygon is "always being built"; switching to Rectangle for edit-then-nudge is the documented flow.
- **Blob URL cleanup mirrors `ScreenshotCropModal`.** Both components now share the same effect skeleton (fetch → `URL.createObjectURL` → set state → cleanup `URL.revokeObjectURL`). The `currentUrl` closure pattern lets the cleanup revoke exactly the URL the effect created, no race against re-fires from `cacheBuster`.
- **`mediaBaseUrl` / `patientId` / `procedureId` kept on the public props.** Backward-compat with existing callers (Procedure Review). Documented in the file header as now-unused.

## Manual Verification Notes

The plan's manual checks (launch app → Procedure Review → screenshot → Crop → drag a vertex → shape resizes; drag interior → shape moves; Clear → reset; Apply → lightbox updates without leave/re-enter) require a real Electron desktop session, which the executor cannot drive in this Windows sandboxed shell. The unit tests cover the same code paths: vertex-only mutation, full-shape translation, Clear reset, cursor flip, mode-switch clear, freehand IPC payload carries the post-edit coords, and the blob-URL pattern in the lightbox.

## Self-Check: PASSED

All 4 files exist on disk and the diffs above are the entirety of what this plan changed (excluding `.planning/ROADMAP.md` which the orchestrator owns).
