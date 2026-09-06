---
slug: fix-print-pdf
created: 2026-09-07
type: bugfix
status: complete
---

# Summary: fix Report Editor Print — preview shows "This app doesn't support print preview"

## Outcome

`REPORTS_PRINT` IPC handler now opens the PDF in the clinic's
default PDF viewer (Edge / Adobe Reader / etc.) via
`shell.openPath(abs)`. The doctor prints from there with a
fully working native print preview (Ctrl+P or File → Print).

This is the same approach `handleOpenPdf` already uses
successfully — it works because the system viewer has its own
print pipeline, not Chromium's preview-less `webContents.print()`
path.

## Root cause

The prior `webContents.print()` implementation tried to render
the preview by:

1. Creating a `BrowserWindow` with `show: true` (compositor active).
2. Positioning it at `x: -10000, y: -10000` (off-screen).
3. Calling `printWin.minimize()` to hide it from view.
4. Loading the PDF and calling `webContents.print({ silent: false, ... })`.

Step 3 is the bug: **Windows pauses the compositor for minimized
windows**. Without a live compositor surface, Chromium can't paint
the preview pane inside the OS print dialog. Its fallback is the
literal string `"This app doesn't support print preview"`.

The two earlier attempts (`print-via-webcontents-save-changes-at-end`
and `pdf-min-bytes-print-preview-reveal-explorer`) both failed for
the same reason — they ended with the window hidden or minimized.

## What changed

**`src/main/ipc/reports.ts`** (`REPORTS_PRINT` handler):

- Dropped the entire `BrowserWindow` / `printWin.minimize()` /
  `webContents.print()` dance (~50 lines).
- Now resolves the report's pdfPath, verifies the file exists,
  then `await shell.openPath(abs)`. Returns `{ ok: true }` on
  success, or surfaces the OS error string as `IPC_INTERNAL` on
  failure (matches `handleOpenPdf` exactly).
- Audit row still emitted as `report.pdf_printed` with metadata
  `{ pdfPath, openedForPrint: true }` — the `openedForPrint` flag
  honestly flags that the actual print happens in the system
  viewer, not in our process.
- Removed unused `BrowserWindow` and `pathToFileURL` imports.

**No other changes:**

- `src/shared/ipc-contract.ts` — `REPORTS_PRINT` signature unchanged.
- `src/preload/index.ts` — `reports.print` bridge unchanged.
- `src/main/license/gate.ts` — `REPORTS_PRINT` stays in
  `EXEMPT_CHANNELS` (printing remains a routine read on existing
  data, same rationale as `SCREENSHOTS_GET_BLOB` / `SCREENSHOTS_CROP`).
- `src/renderer/src/pages/ReportEditor.tsx` — `handlePrint` still
  calls `window.api.reports.print({ id })`. No UI changes.
- `src/renderer/src/i18n/en|ar/translation.json` — `printButton`
  unchanged.

## Diff stat

```
src/main/ipc/reports.ts | 83 +++++++++++++++++----------------------------
1 file changed, 29 insertions(+), 54 deletions(-)
```

Net: −25 lines. Handler body went from ~65 lines to ~35.

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- Manual: from a finalized report in the Report Editor, click
  Print → system PDF viewer opens the report → Ctrl+P shows a
  preview → print succeeds.

## Files

- `src/main/ipc/reports.ts` — handler rewritten.
- `.planning/quick/20260907-fix-print-pdf/PLAN.md` — plan.
- `.planning/quick/20260907-fix-print-pdf/SUMMARY.md` — this file.

## Commit

`000e95c fix(reports): REPORTS_PRINT — open PDF via shell.openPath for native print preview`