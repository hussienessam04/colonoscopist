---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 14
subsystem: screenshots
tags: [screenshots, crop, ipc, audit, gap-closure]
status: complete
gap_closure: true
gap_ids: [G-08-7]
requires:
  - Phase 5 Plan 01 (screenshots capture + repo + /media route)
  - Phase 8 Plan 03 (licenseGated wrapper + EXEMPT_CHANNELS)
provides:
  - IPC.SCREENSHOTS_CROP channel + screenshots.crop bridge
  - cropScreenshot() main handler + screenshot.cropped audit action
  - ScreenshotCropModal component
affects:
  - src/renderer/src/components/ScreenshotLightbox.tsx
  - src/main/license/gate.ts (EXEMPT_CHANNELS)
tech-stack:
  added: []
  patterns:
    - renderer-side canvas crop, base64 over IPC (mirrors screenshots.add)
    - main validates bounds + owns the write path; renderer never composes a path
key-files:
  created:
    - src/main/screenshots/crop.ts
    - src/renderer/src/components/ScreenshotCropModal.tsx
    - tests/main/screenshots/crop.test.ts
    - tests/renderer/components/screenshot-crop-modal.test.tsx
  modified:
    - src/shared/ipc-contract.ts
    - src/shared/validators.ts
    - src/shared/errors.ts
    - src/main/ipc/screenshots.ts
    - src/main/license/gate.ts
    - src/preload/index.ts
    - src/renderer/src/components/ScreenshotLightbox.tsx
    - src/renderer/src/i18n/en/translation.json
    - src/renderer/src/i18n/ar/translation.json
    - tests/renderer/setup.ts
    - tests/renderer/components/ScreenshotLightbox.test.tsx
    - tests/main/license/gate.test.ts
decisions:
  - "Bytes ride the channel as base64 (jpegBase64), not Uint8Array — mirrors the proven screenshots.add shape and avoids structured-clone surprises across contextBridge"
  - "Screenshot id is a number (matches the existing screenshots row / delete / updateAnnotation surface), not the string the plan sketched"
  - "Out-of-bounds crop rect is rejected, never clamped — a mismatched rect means renderer and main disagree about the source image"
  - "Crop modal draws no display canvas; the <img> plus an absolutely positioned overlay is the whole editor"
  - "Cache-buster is only appended after the first successful crop, so the /media URL stays pristine for every other consumer"
requirements-completed: [SCRN-02 (extended)]
metrics:
  duration: ~40m
  completed: 2026-09-05
  files-touched: 16
  commits: 3
---

# Phase 8 Plan 14: Screenshot Crop Summary

A doctor viewing a screenshot at full size can now drag a rectangle over it and permanently crop the source JPEG, with the operation recorded as a `screenshot.cropped` audit row.

## What Changed

**Shared contract**

- `IPC.SCREENSHOTS_CROP` (`screenshots:crop`), `ScreenshotCropInput` / `ScreenshotCropResult` / `CropRect` types, and `screenshots.crop` on the bridge signature.
- `screenshotCropInput` zod schema (`.strict()`, 8 MB base64 cap matching `screenshots.add`).
- `IPC_SCREENSHOT_NOT_FOUND` + `IPC_INVALID_CROP` error codes.

**Main**

- `src/main/screenshots/crop.ts` — looks the row up by id, rejects a rect that exceeds the reported original dimensions, writes the bytes to the path the DB row owns (`userData` + `filePath`, never a renderer-supplied path), and emits `screenshot.cropped` with `{ originalWidth, originalHeight, cropRect, newWidth, newHeight, byteSize }`.
- `src/main/ipc/screenshots.ts` registers the handler through `licenseGated` for grep-consistency.
- `SCREENSHOTS_CROP` added to `EXEMPT_CHANNELS`: cropping is a routine action on data the doctor already captured. `SCREENSHOTS_ADD` stays gated, so new capture is still blocked when unlicensed.

**Renderer**

- `ScreenshotCropModal` — shadcn Dialog, drag-select overlay positioned against the image box, display→natural pixel conversion on Apply, offscreen canvas + `toBlob` + base64, then `window.api.screenshots.crop`. Apply is disabled until a selection exists; sub-4px drags are discarded as accidental clicks.
- `ScreenshotLightbox` gains a Crop button next to Delete and a cache-buster token — the crop overwrites the file in place, so the URL is unchanged and the browser would otherwise serve stale bytes. The token stays `0` (and the URL untouched) until the first successful crop.
- `screenshot.*` i18n namespace: 9 keys, EN + hand-written AR.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck:node` | No new errors (9 pre-existing report-schema errors unchanged) |
| `npm run typecheck:web` | No new errors (7 pre-existing ReportEditor errors unchanged) |
| `node scripts/check-license-gate.cjs` | `license gate OK (15 IPC files scanned, 14 exempt channels)` |
| `tests/main/screenshots/crop.test.ts` | 3/3 pass |
| `tests/renderer/components/screenshot-crop-modal.test.tsx` | 5/5 pass |
| `tests/renderer/components/**` + `tests/renderer/i18n` + `tests/main/license/gate*` + `tests/main/ipc/screenshots` | 105/105 pass across 15 files — no regressions in the lightbox or timeline suites |

**Pre-existing failures, out of scope** (verified failing at `774d304`, before either plan): `tests/main/ipc/reports.test.ts` (4 — `table reports has no column named findings`, the uncommitted report-templates migration) and `tests/main/license/pick-and-activate.test.ts` (4 — the test's `vi.mock` of `src/main/license` omits `invalidateLicenseCache`).

## Deviations from Plan

1. **`croppedBytes: Uint8Array` → `jpegBase64: string`.** The plan specified a raw `Uint8Array` over IPC. Every other binary payload in this codebase (`screenshots.add`, the profile uploads) rides as base64 for the same reason, and `z.instanceof(Uint8Array)` does not survive the contextBridge structured clone reliably. Same validation surface, one proven shape.
2. **`id` is a `number`, not a `string`.** `screenshots.id` is an INTEGER PRIMARY KEY; `delete` and `updateAnnotation` already take `{ id: number }`.
3. **`cropScreenshot(input, userId)` takes the user id as an argument** instead of reading `session.currentUserId` internally. The IPC handler already calls `requireSession()`, and passing it in keeps the function unit-testable without a session mock.
4. **No display canvas.** The plan sketched rendering the image to a `<canvas>` for display. The `<img>` plus an overlay div is fewer moving parts and inherits the browser's own scaling; a canvas is created offscreen only on Apply, where the pixels actually matter.
5. **Two extra renderer tests** beyond the planned three (Apply-disabled state, `IPC_INVALID_CROP` keeps the modal open) and two lightbox tests (button opens the modal; hidden when the media server has not bound).
6. **`tests/main/license/gate.test.ts` asserted `EXEMPT_CHANNELS.size === 13`.** Adding the crop channel makes it 14 — assertion and channel list updated (Rule 1, direct consequence of this plan).
7. **v1 ships without undo**, as the plan's `must_haves` anticipated. The audit row records the operation; restoring the original is not implemented.

## Known Stubs

None.

## Self-Check: PASSED

- All 4 created files present on disk; all 12 modified files present.
- Commits `bbbe173` (main + contract), `f6b7590` (renderer + i18n), `2c369b3` (tests) in `git log`.
