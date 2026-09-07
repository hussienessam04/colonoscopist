---
slug: extra-screenshots-pack
created: 2026-09-07
type: polish
status: complete
---

# Summary: pack extras on page 1 + fix EBUSY detection through IPC wrapper

## Outcome

1. **Wrap-row extras pack on page 1.** The
   `EXTRA_THUMB_WIDTH` + `EXTRA_THUMB_HEIGHT` were shrunk
   from 120×100 to 110×88 (matches the right-column
   thumbnail size). The more compact vertical footprint
   lets a typical row of extras fit on page 1 alongside the
   main row content. @react-pdf/renderer paginates any
   remaining overflow to page 2.

2. **EBUSY detection now catches the Electron IPC transport
   wrapper.** The `isPdfLockedError` regex was tightened
   from `^EBUSY:` (start-anchored) to
   `/(?:^|\s)(EBUSY|EPERM|EACCES):/i` (match anywhere).
   The IPC boundary + Electron transport wrap the original
   OS error as
   `Error invoking remote method 'reports:regen-pdf':
   Error: EBUSY: resource busy or locked, open '...'`
   — the start-anchored regex missed this case, so the
   raw stack-trace string leaked through to the toast on
   Save changes. Now both `handleFinalize` (already wired
   in the previous round) and `handleRegenPdf` translate
   the error to the friendly
   `t("report.pdfLockedError")` — "PDF is open in another
   program. Close the PDF viewer and try again."

## What changed

**`src/main/pdf/report.tsx`**:

- `EXTRA_THUMB_WIDTH = 110` (was: 120).
- `EXTRA_THUMB_HEIGHT = 88` (was: 100).

**`src/renderer/src/lib/pdf-locked-error.ts`**:

- Regex changed from `/^EBUSY:|^EPERM:|^EACCES:/i` to
  `/(?:^|\s)(EBUSY|EPERM|EACCES):/i`. Matches the OS
  code at the start of the message OR after any
  whitespace — covers the wrapped-IPC case while still
  rejecting unrelated errors.
- File header comment updated to describe the IPC
  transport wrapper (Electron prefixes the message with
  `Error invoking remote method '...'`) and the new
  regex behavior.

## Diff stat

```
src/main/pdf/report.tsx                  |  19 +++++++++++--------
src/renderer/src/lib/pdf-locked-error.ts |  33 ++++++++++++++++------------
2 files changed, +30/-22
```

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- `npx vitest run tests/renderer/pages/report-editor.test.tsx`
  → 10/10 pass.
- Manual checklist:
  - Finalize a report with 8 screenshots (5 in right
    column, 3 in wrap row) → open PDF: page 1 has the
    right column + all 3 extras packed horizontally in
    the wrap row at the bottom. If the body overflows,
    @react-pdf/renderer paginates the overflow to page 2.
  - Open the rendered PDF in Edge → back in app, click
    Save changes → the friendly
    "PDF is open in another program. Close the PDF
    viewer and try again." toast appears (NOT the raw
    EBUSY stack-trace string). Same for click Finalize.

## Files

- `src/main/pdf/report.tsx` — smaller wrap-row thumbnails.
- `src/renderer/src/lib/pdf-locked-error.ts` — regex fix.
- `.planning/quick/20260907-extra-screenshots-pack/PLAN.md`
  — plan.
- `.planning/quick/20260907-extra-screenshots-pack/SUMMARY.md`
  — this file.

## Commit

`f88e5ae fix(pdf+toast): pack wrap-row extras on page 1 + fix EBUSY detection through IPC wrapper`