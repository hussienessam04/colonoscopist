---
slug: print-via-webcontents-save-changes-at-end
created: 2026-09-06
type: polish+bugfix
source: ad-hoc user report (3 issues)
---

# Quick Task: use Electron webContents.print() for proper preview + remove premedication hint + rename + relocate Re-render PDF

## Issues

1. **Print preview still doesn't work.** The iframe approach
   (`window.print()` on a hidden PDF iframe) is unreliable —
   Chromium's print dialog can show "This app doesn't support
   print preview" when the iframe renders a PDF via blob URL.
   Switch to Electron's `webContents.print()` from the main
   process, which uses the OS-native print path with full
   preview. New IPC channel `REPORTS_PRINT` takes `{ id }` and
   calls `win.webContents.print({ silent: false,
   printBackground: true, pageSize: 'Letter' })`.

2. **Drop the premedication fallback hint.** The `<p>` under the
   Pre-medication input that says "Empty falls back to clinic
   default: <value>" / "Overriding the clinic default for this
   report" is noise — the input's placeholder already shows the
   fallback, and the override state is implicit from whether
   the input has a value. Remove the `<p>`.

3. **Re-render PDF button** —
   - Rename from "Re-render PDF" → "Save changes" (the doctor
     thinks of this as "save my work to disk", not as
     "re-generate the PDF" — even though both happen).
   - Move OUT of the screenshots rail (where the previous commit
     put it) and put it under the rail, at the end of the page
     document. The doctor wants a clear "save changes" affordance
     that's part of the report surface, not part of the
     screenshots.

## Scope

- `src/main/ipc/reports.ts`: add `REPORTS_PRINT` handler —
  resolves the report's pdfPath, opens it via `webContents.print`
  on a hidden BrowserWindow loaded with the PDF.
- `src/shared/ipc-contract.ts`: add `REPORTS_PRINT` constant +
  `print(input: { id: string }): Promise<{ ok: true }>` on the
  preload bridge.
- `src/preload/index.ts`: expose `reports.print({ id })`.
- `src/main/license/gate.ts`: add `REPORTS_PRINT` to
  EXEMPT_CHANNELS.
- `src/renderer/src/pages/ReportEditor.tsx`:
  - `handlePrint` now calls `window.api.reports.print({ id })`.
  - Drop the iframe-based `PrintPreview` + `printIframeRef`
    (no longer needed).
  - Drop the `<p>` hint under the Pre-medication input.
  - Rename "Re-render PDF" → "Save changes". Move out of the
    screenshots rail to the very end of the page (under the rail).
- `src/renderer/src/i18n/en/translation.json` + AR equivalent:
  - `report.regenPdfButton` → "Save changes" / "حفظ التغييرات".

## Verification

- 35/35 tests pass (10 report-editor + 15 ScreenshotTimeline
  + 10 reports-repo).
- `npm run typecheck` (both node + web) → exits 0.
- EN + AR JSON valid.

## Notes

- The PrintPreview iframe + `printIframeRef` are gone; `handlePrint`
  is a single `await window.api.reports.print({ id })` call.
- `REPORTS_PRINT` is added to EXEMPT_CHANNELS (printing is a
  routine read on existing data — same rationale as
  `SCREENSHOTS_GET_BLOB` / `SCREENSHOTS_CROP`).
- The hidden BrowserWindow used for printing is destroyed in
  the `finally` block to avoid leaking resources when the
  doctor cancels the print dialog.
- "Save changes" semantically maps better to the doctor's
  mental model (saving work to disk) than "Re-render PDF"
  (which is the implementation detail). The button still
  triggers `regenPdf` + the auto-save's pending writes.
