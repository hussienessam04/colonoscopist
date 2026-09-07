---
slug: pdf-5-screenshots-locked-toast
created: 2026-09-07
type: bugfix+polish
status: complete
---

# Summary: PDF — vertical max 5 screenshots + friendly EBUSY toast on Finalize

## Outcome

1. **Screenshots: vertical max 5, rest in flex/wrap row.**
   `RIGHT_COL_THUMB_COUNT = 5` (was: undefined / all). The
   right column shows the first 5 screenshots stacked
   vertically; the rest fall through to the `extraRow` wrap
   row below the signature (`flexWrap: 'wrap'` +
   `flexDirection: 'row'` handle the horizontal pagination
   across multiple lines). On a typical page with 4 anatomy
   boxes, the right column has ~440pt of vertical space →
   exactly 5 thumbnails fit at 88pt each; any overflow goes
   to the wrap row.

2. **Friendly EBUSY toast on Finalize.**`handleFinalize`'s
   catch block now uses the same `isPdfLockedError` helper
   that `handleRegenPdf` already uses. When the rendered
   PDF is open in Edge / Adobe Reader and Windows returns
   `EBUSY: resource busy or locked, open '...'`, the user
   sees the friendly `report.pdfLockedError` translation
   ("PDF is open in another program. Close the PDF viewer
   and try again.") instead of the raw stack-trace string.

3. **Bands confirmed `objectFit: 'cover'`.** The doctor
   manually updated `HEADER_BAND_IMAGE_STYLE.objectFit` to
   `"cover"` (double quotes); `FOOTER_BAND_IMAGE_STYLE`
   was already `'cover'`. Both bands now render with
   `objectFit: 'cover'` — the image fills the band's
   content area edge-to-edge, cropping any aspect-ratio
   overflow. No code change needed; just confirming.

## What changed

**`src/main/pdf/report.tsx`**:

- `RIGHT_COL_THUMB_COUNT = 5` constant added.
- `rightThumbs = attachedScreenshots.slice(0,
  RIGHT_COL_THUMB_COUNT)` (was: `attachedScreenshots` —
  no limit).
- `extraThumbs = attachedScreenshots.slice(
  RIGHT_COL_THUMB_COUNT)` (was: `[]`).

**`src/renderer/src/pages/ReportEditor.tsx`**:

- `handleFinalize`'s catch block: uses `isPdfLockedError`
  to detect EBUSY/EPERM/EACCES and translate to
  `t("report.pdfLockedError")`; falls back to the existing
  `err.message` / `t("procedure.finalizeFailed")` for
  other errors.

## Diff stat

```
src/main/pdf/report.tsx        | +12/-7
src/renderer/.../ReportEditor.tsx | +9/-4
3 files changed (incl. plan), +99/-22 (net +77)
```

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- `npx vitest run tests/renderer/pages/report-editor.test.tsx`
  → 10/10 pass.
- Manual checklist:
  - Finalize a report with 8 screenshots → open PDF:
    right column shows 5 thumbnails stacked vertically;
    remaining 3 thumbnails render in the wrap row below
    the signature.
  - Open the rendered PDF in the system viewer (Edge) →
    back in the app, click Save changes → the friendly
    "PDF is open in another program. Close the PDF viewer
    and try again." toast appears (NOT the raw EBUSY
    stack-trace string). Same for click Finalize.
  - Band images fill the band's content area edge-to-edge
    via `objectFit: 'cover'`.

## Files

- `src/main/pdf/report.tsx` — 5-screenshot cap + wrap
  row for overflow.
- `src/renderer/src/pages/ReportEditor.tsx` —
  `handleFinalize` friendly EBUSY toast.
- `.planning/quick/20260907-pdf-5-screenshots-locked-toast/PLAN.md`
  — plan.
- `.planning/quick/20260907-pdf-5-screenshots-locked-toast/SUMMARY.md`
  — this file.

## Commit

`56ffb14 fix(pdf+editor): vertical max 5 screenshots + friendly EBUSY toast on Finalize`