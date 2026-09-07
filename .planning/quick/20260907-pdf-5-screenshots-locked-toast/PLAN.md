---
slug: pdf-5-screenshots-locked-toast
created: 2026-09-07
type: bugfix+polish
source: ad-hoc user report (manual change to cover + 5-screenshot cap + EBUSY toast)
---

# Quick Task: PDF — vertical max 5 screenshots + friendly EBUSY toast on Finalize

## Issues

1. **Screenshots: vertical max 5, rest in flex/wrap row.**
   The previous round set `rightThumbs = attachedScreenshots` (no
   limit; the right column tries to fit all). On a typical
   report this caused pagination issues — the right column
   overflowed the page and the overflow spilled awkwardly.
   Per their clarification: max 5 screenshots vertically in the
   right column; the rest in a horizontal wrap row below.

2. **The user already changed the bands to `objectFit: 'cover'`.**
   They updated `HEADER_BAND_IMAGE_STYLE.objectFit` manually
   to `"cover"` (double quotes); my code already had `'cover'`
   on `FOOTER_BAND_IMAGE_STYLE`. No change needed here —
   just confirming.

3. **`handleFinalize` shows raw EBUSY error message instead
   of the friendly "PDF is open in another program" toast.**
   `handleRegenPdf` already uses the `isPdfLockedError`
   helper to translate EBUSY/EPERM/EACCES into the
   user-friendly `report.pdfLockedError` translation. But
   `handleFinalize` falls through to `err.message` for any
   caught error — so when `reports.regenPdf` (called
   inside `handleFinalize`) fails because the PDF is open
   in the system viewer, the user sees:
   `Error invoking remote method 'reports:regen-pdf':
   Error: EBUSY: resource busy or locked, open '...'`
   instead of the friendly toast. Fix: route
   `handleFinalize`'s catch block through the same
   `isPdfLockedError` helper.

## Scope

- `src/main/pdf/report.tsx`:
  - `rightThumbs = attachedScreenshots.slice(0, 5)`.
  - `extraThumbs = attachedScreenshots.slice(5)`.
  - `RIGHT_COL_THUMB_COUNT = 5` (was: undefined / all).
- `src/renderer/src/pages/ReportEditor.tsx`:
  - `handleFinalize`'s catch block: use the same
    `isPdfLockedError` helper that `handleRegenPdf`
    already uses. Translate EBUSY/EPERM/EACCES into
    `t("report.pdfLockedError")`; fall back to the
    current `err.message` / `t("procedure.finalizeFailed")`
    for other errors.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `report-editor.test.tsx` → 10/10 still pass.
- Manual:
  - Finalize a report with 8 screenshots → open PDF:
    right column shows 5 thumbnails stacked vertically;
    remaining 3 thumbnails render in the wrap row below
    the signature.
  - Open the rendered PDF in the system viewer (Edge) →
    back in the app, click Save changes → the friendly
    "PDF is open in another program. Close the PDF viewer
    and try again." toast appears (NOT the raw EBUSY
    stack-trace string). Same for click Finalize.

## Out of scope

- Tuning the right-column width or thumbnail size (still
  110pt × 88pt).
- Restricting the 5-cap to dynamic page-height (it's a
  hard cap; if 5 is too many for a particular page, the
  right column still overflows and @react-pdf/renderer
  paginates).
- The `report.pdfLockedError` translation already exists
  in EN + AR; no i18n changes needed.