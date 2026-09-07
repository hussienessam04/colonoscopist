---
slug: pdf-polish-recommendation-borders
created: 2026-09-07
type: polish
source: ad-hoc user report (3 issues from the new PDF layout)
---

# Quick Task: PDF polish — bands always render + recommendation in left column + drop image borders

## Issues

1. **Header and footer don't appear in the PDF.** The new
   template hides the band entirely when
   `headerBox === null` / `footerBox === null`. The doctor
   hasn't uploaded header/footer images yet (or wants to verify
   the layout without them) — the page is supposed to have the
   header band + footer band reserved regardless of whether an
   image has been uploaded. Render the band area always; show the
   image when uploaded, show a thin placeholder strip when not.

2. **Recommendation should sit with the other anatomy boxes.**
   The new template renders the recommendation as a full-width
   bordered box BELOW the main row (anatomy + screenshots).
   The reference image shows it inside the same left column as
   the anatomy boxes (after Conclusion, before the signature
   line). Move it into `textColumn` so all the doctor's clinical
   text flows down one column.

   Also move the signature block into the same left column —
   the reference shows the signature line + doctor name at the
   bottom of the bordered area, not as a separate full-width
   row.

3. **Drop borders from screenshot images.** The reference image
   shows the screenshots on the right column without any border
   around each thumbnail. My template currently adds a
   `borderWidth: 1` on the wrap container for both the right
   column (`rightThumbWrap`) and the extra-screenshots row
   (`extraThumbWrap`). Remove the borders; keep the small
   bottom margin between thumbnails.

## Scope

- `src/main/pdf/report.tsx`:
  - Header / footer bands: render the `<Image>` only when the
    buffer is available. Always render the band area (the
    `maxHeight: 80` is preserved so the layout is stable with
    or without an image). Add a subtle background color so the
    band is visible even when empty.
  - `anatomyBox` already has the same border treatment as the
    recommendation — no style change needed; just relocate the
    recommendation render into the left column.
  - Move the recommendation + signature block renders from the
    page-level row sequence into `textColumn` (inside the main
    row's left column, after Conclusion).
  - Remove `borderWidth` / `borderColor` from `rightThumbWrap`
    and `extraThumbWrap`. The wrap still exists for the
    `marginBottom` spacing.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- Manual: render an actual PDF in dev and confirm the
  recommendation sits in the left column under Conclusion, the
  signature line + doctor name are at the bottom of the same
  left column, the screenshots have no borders, and the header
  + footer bands occupy their 80px strip even when no image is
  uploaded.

## Out of scope

- Adding a "default" header/footer image asset to the profile
  wizard — out of scope; the doctor can upload their own.
- Re-arranging the right-column screenshot count (still 4
  vertical, extras below the left column).