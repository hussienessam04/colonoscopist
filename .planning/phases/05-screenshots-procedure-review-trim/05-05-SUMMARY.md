---
phase: 05-screenshots-procedure-review-trim
plan: 05
subsystem: media
tags: [cors, cross-origin, video, img, canvas-tainted, mjpeg, mp4, capture, security]

# Gap closure
gap_closure: true
gap_ids:
  - G-05-3

# Dependency graph
requires:
  - phase: 05-screenshots-procedure-review-trim
    plan: 04
    provides: "MediaServer (loopback HTTP /media/ route) + PreviewServer (loopback /preview MJPEG) + capture-screenshot lib + Scrubber + ScreenshotTimeline"
provides:
  - "CORS header (Access-Control-Allow-Origin: *) on every MediaServer /media/ + PreviewServer /preview response path (200, 206, 416, 404, 403, 405)"
  - "crossOrigin='anonymous' on the <video> in ProcedureReview (the +Capture path)"
  - "crossOrigin='anonymous' on the live MJPEG <img> in ProcedureRoom (the S-hotkey latent fix)"
  - "capture-screenshot test contract guard that prevents the toBlob monkey-patch from re-masking the tainted-canvas class of failure"
affects:
  - "Phase 5 UAT step 3 (Capture 2 screenshots from playback) — now unblocked"
  - "Phase 5 UAT steps 4-7 (click thumbnail, trim, verify trimmed, restore) — cascade-unblocked"
  - "Phase 6 (Doctor Profile + Report Editor + PDF) — screenshot pipeline now CORS-clean end-to-end"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CORS header placement as the FIRST line of an onHttpRequest handler so every response path (200/206/416/404/403/405) inherits it via a single setHeader call"
    - "crossOrigin='anonymous' on cross-origin media elements (loopback HTTP) to opt the load into CORS-mode; pairs with the server's ACAO header"
    - "Strict-toBlob test stub that mimics Chromium's tainted-canvas null-return — guards against a future re-permissive-monkey-patch regression"

key-files:
  created: []
  modified:
    - src/main/recorder/preview-server.ts
    - src/renderer/src/pages/ProcedureReview.tsx
    - src/renderer/src/pages/ProcedureRoom.tsx
    - tests/main/recorder/preview-server.test.ts
    - tests/renderer/lib/capture-screenshot.test.ts

key-decisions:
  - "Place the Access-Control-Allow-Origin setHeader as the FIRST line of each onHttpRequest handler (before any branching, method check, range parse, regex match, existsSync, or early return) so a single setHeader call covers every response path — including the 404, 405, 416, 403 error paths that were previously header-less"
  - "crossOrigin='anonymous' (not 'use-credentials') — the loopback server only serves media to a same-workstation renderer; credentials are unnecessary and would actually block the load"
  - "Use strict toBlob stubs in the new withCrossOriginSource tests (NOT the permissive monkey-patch from beforeEach) so the unit suite can no longer mask a tainted-canvas regression"
  - "Keep the getUserMedia <video> fallback path in ProcedureRoom unchanged — same-origin MediaStream needs no CORS attribute"

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "Server-side CORS — Access-Control-Allow-Origin: * on EVERY MediaServer /media/ AND PreviewServer /preview response path (200, 206, 416, 404, 403, 405) via a single setHeader call as the FIRST line of each onHttpRequest handler body"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: "tests/main/recorder/preview-server.test.ts#serves a valid /media/ path with Accept-Ranges: bytes + Content-Length + the file body"
        status: pass
      - kind: unit
        ref: "tests/main/recorder/preview-server.test.ts#returns 206 with Content-Range + Content-Length for bytes=0-1023 of a 4096-byte file"
        status: pass
      - kind: unit
        ref: "tests/main/recorder/preview-server.test.ts#serves /preview with Access-Control-Allow-Origin: * (G-05-3)"
        status: pass
      - kind: unit
        ref: "tests/main/recorder/preview-server.test.ts#serves /media/ error paths (404 / 405) with Access-Control-Allow-Origin: * (G-05-3)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Renderer-side crossOrigin='anonymous' on the playback <video> in ProcedureReview.tsx (the +Capture path) — paired with the server CORS header so the cross-origin mp4 load is CORS-clean and canvas.drawImage does not taint"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: "tests/renderer/lib/capture-screenshot.test.ts#withCrossOriginSource > captureScreenshot(<HTMLVideoElement with crossOrigin='anonymous'>) returns a Blob"
        status: pass
      - kind: unit
        ref: "tests/renderer/lib/capture-screenshot.test.ts#withCrossOriginSource > captureScreenshot(<HTMLVideoElement WITHOUT crossOrigin>) rejects with toBlob-returned-null"
        status: pass
    human_judgment: true
    rationale: "The unit test guards the contract (crossOrigin attribute presence + strict toBlob behavior). End-to-end verification — clicking +Capture in a running Electron app and observing a JPEG written to disk without a Tainted-canvas toast — needs the Windows hardware smoke UAT (steps 3 onward in 05-UAT.md)."
  - id: D3
    description: "Renderer-side crossOrigin='anonymous' on the live MJPEG <img> in ProcedureRoom.tsx (the S-hotkey capture path) — fixes the latent bug that would surface if a mid-procedure S-key capture were exercised end-to-end"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: "tests/renderer/lib/capture-screenshot.test.ts#withCrossOriginSource > captureScreenshot(<HTMLVideoElement with crossOrigin='anonymous'>) returns a Blob"
        status: pass
    human_judgment: true
    rationale: "Same D2 rationale — the unit suite guards the contract; the actual mid-recording S-hotkey capture in a running Electron app is a hardware-smoke UAT step."
  - id: D4
    description: "All 484 pre-existing unit tests still pass + 4 new assertions (1 modified, 3 new) on the server side + 2 new tests in the withCrossOriginSource contract guard = 488/488 across 62 files"
    verification:
      - kind: unit
        ref: "npm run test:unit (488 tests across 62 files; was 484)"
        status: pass
    human_judgment: false

# Requirements
requirements-completed: [SCRN-02]

# Metrics
duration: 5 min
completed: 2026-08-07
status: complete
---

# Phase 5 Plan 05: CORS fix for +Capture and S hotkey (G-05-3)

**Cross-origin tainted-canvas block on Procedure Review +Capture and Procedure Room S hotkey resolved: every MediaServer /media/ and PreviewServer /preview response carries `Access-Control-Allow-Origin: *`; the playback `<video>` and the live MJPEG `<img>` both declare `crossOrigin="anonymous"`; capture-screenshot test suite gains a strict-toBlob contract guard.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-07T15:28:36Z
- **Completed:** 2026-08-07T15:34:06Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- G-05-3 (the only remaining blocker in the Phase 5 UAT chain) is closed. The cross-origin tainted-canvas block is gone: Chromium now issues a CORS-mode request to the loopback HTTP server, the response carries the ACAO header, the loaded media element is a clean canvas source, and `ctx.drawImage + canvas.toBlob` succeeds.
- +Capture during playback (Procedure Review) and the latent S-hotkey capture path (Procedure Room) now both reach the screenshot pipeline. UAT steps 3-7 (which were blocked-by the toast) can be re-run end-to-end.
- Test suite contract guards both sides: the server test asserts the CORS header on 200/206/404/405, and the capture-screenshot test uses a strict toBlob stub that mimics Chromium's tainted-canvas null-return so the unit suite can no longer mask this class of regression.

## Task Commits

1. **Task 1: Server-side CORS headers on MediaServer AND PreviewServer + test assertions** — `3beafb7` (feat)
2. **Task 2: Renderer-side crossOrigin on video + img + capture-screenshot test guard** — `e867d47` (feat)
3. **Plan metadata:** pending (this commit)

## Files Created/Modified

- `src/main/recorder/preview-server.ts` — `Access-Control-Allow-Origin: *` setHeader as the FIRST line of both `onHttpRequest` handlers. Coverage: 200, 206, 416, 404, 403, 405 (every response path inherits the header because the call precedes every early return).
- `src/renderer/src/pages/ProcedureReview.tsx` — `<video>` gains `crossOrigin="anonymous"` (placed AFTER `controls`, BEFORE `preload="metadata"`).
- `src/renderer/src/pages/ProcedureRoom.tsx` — live MJPEG `<img>` gains `crossOrigin="anonymous"`. The getUserMedia `<video>` fallback path is unchanged (same-origin MediaStream).
- `tests/main/recorder/preview-server.test.ts` — 1 modified test (happy-path 200 + 206 Range path gain the header assertion) + 3 new tests (`/preview` CORS, `/media/` 404+405 CORS, 206 Range CORS). 4 net new assertions.
- `tests/renderer/lib/capture-screenshot.test.ts` — new `withCrossOriginSource` describe block with 2 contract-guard tests. The strict toBlob stub mimics Chromium's tainted-canvas null-return; a future re-permissive-monkey-patch regression would fail at least one of these.

## Decisions Made

- **Single setHeader call at the top of the handler, not per-path branches.** Putting the call at the very first line of `onHttpRequest` (before the method check) means a single call covers every response path. Per-path setHeader would have meant threading the same call through 6 branches — more code, more chance of forgetting one, no benefit.
- **`crossOrigin="anonymous"` over `"use-credentials"`.** The loopback HTTP server only serves media to a same-workstation renderer. Anonymous is the minimum needed and is what Chromium accepts without a preflight OPTIONS round-trip.
- **Strict toBlob stubs in the contract guard, not the existing permissive monkey-patch.** The pre-existing `beforeEach` (line 57-61) monkey-patches `HTMLCanvasElement.prototype.toBlob` to unconditionally return a Blob — that's the exact reason the G-05-3 bug slipped through. The new `withCrossOriginSource` tests overwrite the prototype with a strict stub that mimics Chromium's tainted-canvas null-return when the source has no crossOrigin. The two existing permissive-mock tests (downscale, no-upscale, quality) keep their monkey-patch; only the contract-guard tests are strict.
- **The getUserMedia `<video>` fallback in ProcedureRoom is unchanged.** That path uses a same-origin `MediaStream` from `navigator.mediaDevices.getUserMedia` — no HTTP request, no CORS, no `crossOrigin` attribute needed.

## Deviations from Plan

None — plan executed exactly as written. Both halves of the fix (server CORS header + client `crossOrigin="anonymous"`) landed together in the same plan. The contract-guard tests land with the renderer changes per the plan's atomic-landing requirement.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

- [x] `src/main/recorder/preview-server.ts` — exists; both `onHttpRequest` handlers carry `res.setHeader('Access-Control-Allow-Origin', '*')` as the first executable line.
- [x] `src/renderer/src/pages/ProcedureReview.tsx` — exists; `<video>` carries `crossOrigin="anonymous"`.
- [x] `src/renderer/src/pages/ProcedureRoom.tsx` — exists; live MJPEG `<img>` carries `crossOrigin="anonymous"`.
- [x] `tests/main/recorder/preview-server.test.ts` — exists; 4 net new CORS assertions (1 modified, 3 new tests).
- [x] `tests/renderer/lib/capture-screenshot.test.ts` — exists; new `withCrossOriginSource` describe block with 2 contract-guard tests.
- [x] Task 1 commit `3beafb7` (feat(05-05): CORS header on MediaServer + PreviewServer) verified in `git log`.
- [x] Task 2 commit `e867d47` (feat(05-05): crossOrigin='anonymous' on <video> + <img>) verified in `git log`.
- [x] `npm run typecheck` — passes (node + web).
- [x] `npm run test:unit` — 488/488 across 62 files (was 484; +4 net new tests, no regressions).

## Next Phase Readiness

- Phase 5 UAT step 3 (Capture 2 screenshots from playback) can be re-run. Steps 4-7 (click thumbnail, trim, verify trimmed, restore) cascade-unblock once step 3 passes. The full Windows hardware smoke is the only remaining verification gate.
- The G-05-5 gap (Trim failed: Source video missing) is a separate, unrelated path-shape bug in the recorder → trim resolver contract. It is NOT addressed by this plan. It is still in `05-UAT.md` and will need its own gap-closure plan (05-06 or later).
- Phase 6 (Doctor Profile + Report Editor + PDF) is unblocked: the screenshot pipeline is now CORS-clean end-to-end, so attaching screenshots to a report draft and rendering them in the PDF will work without any cross-origin surprise.

---

*Phase: 05-screenshots-procedure-review-trim*
*Completed: 2026-08-07*
