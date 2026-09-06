---
slug: remove-print-button
created: 2026-09-07
type: polish
status: complete
---

# Summary: drop the Report Editor Print button + REPORTS_PRINT IPC

## Outcome

The Report Editor header now shows only the **Open PDF** button
when the report is finalized. The Print button + `handlePrint`
callback + `REPORTS_PRINT` IPC channel + preload bridge + license
gate entry + i18n key are all gone.

Open PDF alone drives the PDF flow: `shell.openPath(abs)` opens
the report in the clinic's default viewer (Edge / Adobe Reader),
which has a fully working native print dialog with preview — the
doctor prints from there with Ctrl+P or File → Print.

This makes sense because the previous quick task
(`20260907-fix-print-pdf`) had already collapsed the two paths
into the same `shell.openPath()` call — two buttons doing the
same thing is just clutter.

## What changed

**Renderer** (`src/renderer/src/pages/ReportEditor.tsx`):

- Removed `Printer` from the `lucide-react` import.
- Removed the entire `<Button onClick={handlePrint}>` block in the
  finalized-report header (lines that rendered `report-editor-print`).
- Removed the `handlePrint` callback.
- Updated the file-top comment that described the previous
  PrintPreview iframe + `webContents.print()` pipeline.

**Main** (`src/main/ipc/reports.ts`):

- Removed the entire `ipcMain.handle(IPC.REPORTS_PRINT, ...)` block
  (~50 lines). It was just calling `shell.openPath(abs)` + writing
  the `report.pdf_printed` audit row — exactly what `REPORTS_OPEN_PDF`
  does today.

**Contract** (`src/shared/ipc-contract.ts`):

- Removed the `REPORTS_PRINT: 'reports:print'` constant.
- Removed the `print: (input: { id: string }) => Promise<{ ok: true }>`
  member of the preload bridge interface.

**Preload** (`src/preload/index.ts`):

- Removed the `print: (input) => ipcRenderer.invoke(IPC.REPORTS_PRINT, input)`
  bridge line.

**License gate** (`src/main/license/gate.ts`):

- Removed `IPC.REPORTS_PRINT` from `EXEMPT_CHANNELS` and its
  preceding quick-task comment.

**i18n**:

- `src/renderer/src/i18n/en/translation.json`: removed
  `"printButton": "Print"`.
- `src/renderer/src/i18n/ar/translation.json`: removed
  `"printButton": "طباعة"`.

## Diff stat

```
 src/main/ipc/reports.ts                   | 54 ++--------------------
 src/main/license/gate.ts                  |  4 --
 src/preload/index.ts                      |  1 -
 src/renderer/src/i18n/ar/translation.json |  1 -
 src/renderer/src/i18n/en/translation.json |  1 -
 src/renderer/src/pages/ReportEditor.tsx   | 74 +++++++++----------------------
 src/shared/ipc-contract.ts                |  8 ----
 7 files changed, 26 insertions(+), 117 deletions(-)
```

Net: **−91 lines** across 7 files.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `npx vitest run tests/renderer/pages/report-editor.test.tsx` →
  10/10 pass.
- Pre-existing `tests/main/ipc/reports.test.ts` failures are due to
  a `better-sqlite3` ABI mismatch (NODE_MODULE_VERSION 128 vs
  required 137) — environmental, unrelated to this change.

## Out of scope (kept for separate cleanup if needed)

- `report.printPdf` i18n key — dead code, but not touched by this
  task.
- `REPORTS_GET_PDF_BLOB` IPC channel + preload `getPdfBlob` bridge —
  also dead code (no caller in renderer source), but separate
  cleanup; not this task.

## Files

- 7 source files modified.
- `.planning/quick/20260907-remove-print-button/PLAN.md` — plan.
- `.planning/quick/20260907-remove-print-button/SUMMARY.md` — this
  file.

## Commit

`0077b24 feat(report-editor): drop Print button + REPORTS_PRINT — Open PDF alone drives the PDF flow`