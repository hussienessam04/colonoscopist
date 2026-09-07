---
slug: pdf-polish-recommendation-borders
created: 2026-09-07
type: polish
status: complete
---

# Summary: PDF polish — always-render bands + recommendation in left column + drop image borders

## Outcome

Three follow-up issues from the redesigned PDF layout:

1. The header + footer bands now always render (whether or not
   the doctor has uploaded header/footer images). The bands
   show a thin tinted strip when no image is uploaded so the
   page layout stays stable.

2. The recommendation box + signature block moved from the
   page-level flow into the LEFT column of the main row (same
   `textColumn` as the anatomy boxes + conclusion). The
   recommendation renders via the same `anatomy()` helper +
   `anatomyBox` style as the other boxes — no separate
   treatment. The signature block stays at the bottom of the
   left column (matching the reference image where signature
   line + doctor name are the last items in the bordered
   clinical-text area).

3. Borders removed from screenshot thumbnails (both the right
   column + the extra-screenshots row). The wraps keep the
   `marginBottom` spacing between thumbnails.

## What changed

**`src/main/pdf/report.tsx`**:

- `HEADER_BAND_STYLE` + `FOOTER_BAND_STYLE`:
  - Old: `maxHeight: 80` + `objectFit: 'contain'` + `marginBottom/Top`
    on the `<Image>` directly (only rendered when buffer was present).
  - New: `height: 80` + `backgroundColor: '#E6EFF1'` + `padding: 4`
    on the `<View>` wrap (always rendered); new sibling
    `HEADER_BAND_IMAGE_STYLE` / `FOOTER_BAND_IMAGE_STYLE` =
    `{ width: '100%', height: '100%', objectFit: 'contain' }`
    applied to the inner `<Image>` (only rendered when buffer
    is present).
  - Added `data-testid='report-pdf-header-band'` /
    `data-testid='report-pdf-footer-band'` on the wraps so
    tests can assert the bands rendered even when no image is
    uploaded.

- `rightThumbWrap` / `extraThumbWrap` styles: dropped
  `borderWidth: 1` + `borderColor: '#cbd5e1'`. The wraps still
  carry the spacing.

- Layout structure: removed the page-level "Recommendation"
  + "Signature block" rows that sat below the main row.
  Both now render inside the left `textColumn` of the main
  row, after `anatomy('conclusion', ...)`. The signature
  block still uses `styles.signatureBlock` (image on the left,
  signature line + printed doctor name on the right).

## Diff stat

```
src/main/pdf/report.tsx | +71/-73 (+103/-82 net of style + reorder)
```

Net: **−2 lines** in the template (the band wraps and image
split net out roughly even with the removed page-level rows).

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- `npx vitest run tests/renderer/pages/report-editor.test.tsx` →
  10/10 pass.
- Manual: render an actual PDF in dev and confirm the bands
  reserve their 80px strip (tinted background) when no image
  is uploaded, the recommendation sits inside the left column
  under Conclusion, the signature line + doctor name are at
  the bottom of the same left column, and the screenshots have
  no borders.

## Files

- `src/main/pdf/report.tsx` — band always-render + recommendation
  moved into left column + image borders dropped.
- `.planning/quick/20260907-pdf-polish-recommendation-borders/PLAN.md` —
  plan.
- `.planning/quick/20260907-pdf-polish-recommendation-borders/SUMMARY.md` —
  this file.

## Commit

`3bc1543 feat(pdf): always-render header/footer bands + recommendation in left column + drop image borders`