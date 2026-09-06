---
slug: remove-print-button
created: 2026-09-07
type: polish
source: ad-hoc user request — Open PDF already does the same thing
---

# Quick Task: drop the Report Editor Print button + REPORTS_PRINT

## Issue

After quick task `20260907-fix-print-pdf` (switched
`REPORTS_PRINT` from `webContents.print()` to `shell.openPath()`),
the Print button and the Open PDF button both do the same thing:
open the PDF in the clinic's default viewer. Two buttons for one
action is redundant UI + redundant IPC.

The doctor asked to drop Print — Open PDF is enough.

## Scope

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Drop the `Printer` icon import.
  - Drop the `<Button onClick={handlePrint} data-testid="report-editor-print">` block.
  - Drop the `handlePrint` callback.
  - Update the file-top comment that described the PrintPreview iframe + webContents.print() pipeline.
- `src/main/ipc/reports.ts`:
  - Drop the entire `REPORTS_PRINT` ipcMain.handle handler.
- `src/shared/ipc-contract.ts`:
  - Drop the `REPORTS_PRINT: 'reports:print'` constant.
  - Drop the `print: (input: { id: string }) => Promise<{ ok: true }>` member of the preload bridge interface.
- `src/preload/index.ts`:
  - Drop the `print: (input) => ipcRenderer.invoke(IPC.REPORTS_PRINT, input)` bridge line.
- `src/main/license/gate.ts`:
  - Drop `IPC.REPORTS_PRINT` from `EXEMPT_CHANNELS` (and its preceding comment).
- `src/renderer/src/i18n/en|ar/translation.json`:
  - Drop `report.printButton` key.

## Out of scope

- `report.printPdf` i18n key — kept (might still be referenced by older code; not used by current source).
- `getPdfBlob` IPC channel — also dead code (no caller in source) but separate cleanup; not this task.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `npx vitest run tests/renderer/pages/report-editor.test.tsx` → 10/10 pass.
- Renderer report-editor integration test ids unchanged (`report-editor-open-pdf` still mounted).