---
slug: pdf-min-bytes-print-preview-reveal-explorer
created: 2026-09-06
type: polish
source: ad-hoc user report (3 issues)
---

# Quick Task: lower MIN_PDF_BYTES + try visible-anchor print preview + drop Reveal in Explorer

## Issues

1. **`PDF too small: 2794 bytes`** — the `render-report-pdf.ts`
   sanity check (`MIN_PDF_BYTES = 5_000`) rejects PDFs that are
   smaller than 5 KB. A minimal report (no screenshots attached,
   empty boxes, short text) legitimately produces a ~2-3 KB
   PDF — the size sanity check was tuned for typical reports
   with screenshots embedded. Lower the threshold to a still-
   useful safety floor (1 KB) so minimal reports can be saved +
   printed.

2. **Print still no preview.** The current
   `webContents.print({ silent: false, printBackground: true,
   pageSize: 'Letter' })` from a hidden BrowserWindow opens the
   OS print dialog but Chromium can't render a preview because
   the source window is hidden (no compositor surface). Try
   showing the BrowserWindow (`show: true`) but positioning it
   off-screen + minimized so the doctor doesn't see it. The OS
   print dialog should then preview correctly. If that still
   fails, fall back to opening the PDF in the default viewer
   (matches what `shell.openPath` already does) with a toast
   telling the doctor to use the viewer's Print menu.

3. **Remove Reveal in Explorer button.** Drop the
   `report-editor-reveal-pdf` button + the
   `handleRevealPdf` callback + the
   `REPORTS_OPEN_PDF` `reveal` flag. The doctor doesn't use
   it; the screenshot timeline already shows the source files.

## Scope

- `src/main/pdf/render-report-pdf.ts`: lower `MIN_PDF_BYTES`
  from `5_000` to `1_000`. The real silent-failure signal is
  `0` bytes (truncated write), not 2-3 KB.
- `src/main/ipc/reports.ts`: make the print BrowserWindow
  `show: true` with `webPreferences.offscreen: false` so the
  compositor renders the PDF. Position `x: -10000, y: -10000`
  to keep it off-screen. If that still fails to show preview,
  fall back to `shell.openPath` (the OS viewer can always
  preview).
- `src/renderer/src/pages/ReportEditor.tsx`: drop the
  `handleRevealPdf` callback + the Reveal in Explorer button
  in the header button group.
- `src/renderer/src/i18n/en/translation.json` + AR: keep
  `revealPdfButton` (in case it's still referenced elsewhere)
  but drop the button usage.

## Verification

- 25/25 tests should still pass (testids unchanged; MIN_PDF_BYTES
  has no unit test).
- Manual: with no screenshots attached, click Finalize → no
  "PDF too small" error. Click Print → OS print dialog shows
  preview.

## Out of scope

- The full set of print dialog options (orientation, paper size,
  etc.) — those are user-controlled in the OS dialog itself.
- Re-adding Reveal in Explorer in a different location — the
  doctor wants it gone.
