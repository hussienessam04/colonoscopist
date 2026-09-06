---
slug: fix-print-pdf
created: 2026-09-07
type: bugfix
source: ad-hoc user report (print preview still broken)
---

# Quick Task: fix Report Editor Print — preview shows "This app doesn't support print preview"

## Issue

Clicking Print in the Report Editor still shows the OS print
dialog with the message **"This app doesn't support print
preview"**. The doctor cannot see the PDF before sending it to
the printer, so printing blind.

## Root cause

The current `REPORTS_PRINT` handler
(`src/main/ipc/reports.ts`) creates a `BrowserWindow`,
calls `loadURL(pathToFileURL(abs).toString())`, then
`printWin.webContents.print({ silent: false,
printBackground: true, pageSize: 'Letter' })`.

Chromium's `webContents.print()` needs a live compositor
surface to render the preview pane inside the OS print
dialog. The window is currently created with
`show: true, x: -10000, y: -10000` (off-screen) AND then
`printWin.minimize()` is called. **Minimizing pauses the
compositor on Windows** (the window goes into the "minimized"
state where Windows stops allocating a render surface). Without
a compositor, Chromium can't paint the preview, so the OS print
dialog falls back to "This app doesn't support print preview".

Two prior quick tasks tried variants of this dance (hidden
window → off-screen + minimized window). Both fail for the same
underlying reason: hidden or minimized windows don't have an
active compositor on Windows.

## Fix

Replace the BrowserWindow + `webContents.print()` dance with
`shell.openPath(abs)` — the same path `handleOpenPdf` already
uses successfully. The PDF opens in the clinic's default PDF
viewer (Edge, Adobe Reader, etc.), which has a fully working
native print dialog with preview. The doctor prints from there
(File → Print, or Ctrl+P).

This is the simplest reliable fix:

- `shell.openPath` is one line.
- The system viewer always supports PDF print with preview.
- The doctor already does this from the "Open PDF" button today;
  the "Print" button now does the same thing (so the print flow
  becomes consistent).

## Scope

- `src/main/ipc/reports.ts`: replace the `REPORTS_PRINT` handler
  body — drop the `BrowserWindow` / `printWin.minimize()` /
  `webContents.print()` dance. Resolve the report's pdfPath,
  verify the file exists, then `await shell.openPath(abs)`.
  Audit the action as `report.pdf_printed` with metadata
  `openedForPrint: true` (the actual print happens in the
  system viewer, not in our process — audit metadata reflects
  that).
- Renderer code unchanged. `handlePrint` still calls
  `window.api.reports.print({ id })`.
- `REPORTS_PRINT` stays in `EXEMPT_CHANNELS` (printing remains
  a routine read on existing data).
- `REPORTS_PRINT` IPC contract signature unchanged.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- Manual: from a finalized report in the Report Editor, click
  Print → system PDF viewer opens the report → Ctrl+P shows a
  preview → print succeeds.

## Out of scope

- Removing the "Open PDF" button (now functionally a duplicate
  of Print). The doctor didn't ask for that; can be cleaned up
  later if desired.
- A first-class "preview pane" inside the Report Editor itself.
  Out of scope — the system viewer is the preview surface.