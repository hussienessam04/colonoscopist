---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 18
subsystem: license + crop
tags: [fix, diagnostics, live-preview, retry, gap-closure]
gap_closure: true
gap_ids: [G-08-11]
status: complete
---

# Phase 8 Plan 18: Crop Modal Diagnostics + Live Preview + Retry + Media-Server Fallback

One-liner: ScreenshotCropModal now surfaces the actual IPC error code with a Retry button; receives cacheBuster from the Lightbox so the modal image refreshes after every successful crop; falls back to a read-only MediaServer URL display when getBlob fails.

## Files touched

| File | Change |
| --- | --- |
| `src/renderer/src/components/ScreenshotCropModal.tsx` | Diagnostic state (`imgErrorDetail` carrying the actual IPC code), `retryNonce` + `retry()` callback, new `cacheBuster` + `fallbackSrc` props, useEffect deps include `[screenshotId, retryNonce, cacheBuster, …]`, error UI with Retry + Show-only buttons, read-only sibling branch. |
| `src/renderer/src/components/ScreenshotLightbox.tsx` | Composes `fallbackSrc` via `screenshotUrl({ mediaBaseUrl, patientId, procedureId, filePath })`; passes `cacheBuster` + `fallbackSrc` to `<ScreenshotCropModal>`. |
| `src/renderer/src/i18n/en/translation.json` | New keys: `screenshot.cropRetry`, `screenshot.cropReadOnly`. |
| `src/renderer/src/i18n/ar/translation.json` | New keys: `screenshot.cropRetry`, `screenshot.cropReadOnly`. |
| `tests/renderer/components/screenshot-crop-modal.test.tsx` | 4 new test cases (Plan 18 block). |

## Verification results

- `npm run typecheck:web` → no new errors in Plan 18 files. (Pre-existing `useReport.ts` / `ReportEditor.tsx` errors are out of scope — same baseline as before this plan.)
- `node scripts/run-vitest.cjs --run tests/renderer/components/screenshot-crop-modal.test.tsx tests/renderer/components/ScreenshotLightbox.test.tsx` → **34/34 passed** (29 crop-modal + 5 lightbox).
- Full renderer-component sweep → **102/102 passed** across 10 test files (no regressions).

New test cases:

1. `Plan 18: getBlob ok:false surfaces the IPC code + Retry button` — error message contains `IPC_SCREENSHOT_NOT_FOUND`; Retry button is in the DOM.
2. `Plan 18: clicking Retry re-triggers the getBlob fetch` — first call resolves `ok:false`; clicking Retry bumps `retryNonce`; second call resolves `ok:true`; error UI clears.
3. `Plan 18: cacheBuster change re-fetches the blob URL (live preview after crop)` — bump `cacheBuster` via `rerender`; `getBlob` is called again; new `blob:` URL is distinct from the first.
4. `Plan 18: getBlob catch path surfaces the error message in the diagnostic` — `mockRejectedValue(new Error('IPC channel closed'))`; error message contains the throw message.

## Deviations from Plan

**None — plan executed exactly as written.**

### Plan-level notes (investigation outcomes)

- **getBlob root cause investigation:** This plan does NOT identify the upstream root cause of why `screenshots.getBlob` was returning `ok:false` in the original UAT. The plan's intent was to surface the actual code (so a future maintainer can grep it) and offer recovery paths (Retry + Show-only). The most likely candidates based on the plan's own hypothesis remain: stale `screenshotId` written to disk (e.g. row deleted), `userData` migration moved the file but not the path column, or a permission edge case. Without reproduction, no fix is warranted beyond the diagnostics added here.
- **Pre-existing typecheck baseline:** `useReport.ts` and `ReportEditor.tsx` have unrelated TS errors against the current `Report` shape (`findings`, `diagnosis`, etc.). Out of scope for Plan 18; documented here so the next plan (or an audit) doesn't conflate the baselines.

## Success criteria

- [x] Crop modal displays the image OR surfaces the actual IPC error code
- [x] Retry button works (verified by test #2)
- [x] After successful crop, modal image refreshes immediately (verified by test #3)
- [x] Fallback to read-only display when getBlob fails (rendered conditionally on `fallbackSrc !== null && showReadOnly`)
- [x] typecheck clean for Plan 18 files
- [x] All tests pass (34/34 in affected files; 102/102 across all renderer components)
- [x] NO modifications to STATE.md or ROADMAP.md
