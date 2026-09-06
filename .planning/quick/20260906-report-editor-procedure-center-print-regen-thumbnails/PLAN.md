---
slug: report-editor-procedure-center-print-regen-thumbnails
created: 2026-09-06
type: polish
source: ad-hoc user report (4 issues)
---

# Quick Task: ReportEditor — procedure type centered + Re-render PDF moved to end + Print actually prints + thumbnail object-contain

## Issues

1. **Procedure type toggle is left-aligned.** The doctor wants
   it centered under the procedure meta-row.

2. **Re-render PDF button is in the top-right header.** Move it
   to the end of the page (after the Finalize button / save
   indicator area) where the doctor sees the natural workflow:
   fill in boxes → finalize → re-render → print.

3. **"Print (opens PDF)" opens the PDF in the OS viewer, then
   the doctor has to click Print again in the viewer toolbar.**
   Wire the Print button to actually trigger printing — load
   the PDF into the hidden iframe (already done by `PrintPreview`)
   and call `iframe.contentWindow.print()`. Falls back to the
   OS viewer if the iframe load fails.

4. **Screenshots crop the image (`object-cover`).** The doctor
   wants the full image to fit without cropping
   (`object-contain`). The thumbnail container stays a fixed
   110×120 — `object-contain` letterboxes the image so the
   whole frame is visible.

## Scope

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Procedure-type toggle: wrap in `flex justify-center` (or
    `text-center`) so the segmented control sits centered in the
    procedure block.
  - Drop "Re-render PDF" from the top-right header buttons. Add
    it next to / below the Finalize button area (so it's near
    the save indicator + finalize flow).
  - `handlePrint`: instead of `await window.api.reports.openPdf(...)`,
    trigger `printIframeRef.current?.()` (the new PrintPreview
    imperative handle). Fallback to openPdf on failure.
- `src/renderer/src/pages/ReportEditor.tsx`:
  - `<PrintPreview>` becomes a forwardRef with a `print()`
    method that resolves once the PDF blob is loaded + the iframe
    fires `load`, then calls `iframe.contentWindow.print()`.
- `src/renderer/src/components/ScreenshotThumbnail.tsx`:
  - `object-cover` → `object-contain` on the `<img>` so the
    full frame is visible inside the 110×120 box (letterboxed
    on tall/wide captures).

## Verification

- Existing tests should still pass (testids unchanged). Add a
  contract test for the iframe print() handle.
- Manual: open Print, verify the OS print dialog opens
  directly (not the PDF viewer).

## Out of scope

- Replacing the iframe approach with a `webContents.print()`
  IPC call. The iframe approach has known Chromium bugs but
  matches Phase 6 G-06-11's intended UX ("Print button embeds
  the actual generated PDF in a hidden iframe and calls
  `iframe.contentWindow.print()`"). Restoring that.
- Adding `webContents.print()` IPC for a more reliable print
  path. Defer.
