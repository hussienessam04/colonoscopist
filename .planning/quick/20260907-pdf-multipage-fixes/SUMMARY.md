---
slug: pdf-multipage-fixes
created: 2026-09-07
type: bugfix+polish
status: complete
---

# Summary: PDF multi-page fixes — edge-to-edge bands + header on every page + signature restructure

## Outcome

Four follow-up fixes for the redesigned PDF (multi-page case):

1. **Bands edge-to-edge.** Both `HEADER_BAND_STYLE` and
   `FOOTER_BAND_STYLE` now use `position: 'absolute', top: 0`
   (or `bottom: 0`), `left: 0, right: 0, width: '100%'` —
   the bands stretch across the full page width with no
   inset margin. The image inside fills the band via
   `objectFit: 'contain'` so the band's tinted background
   shows around any image that doesn't exactly fit.

2. **Header appears on every page.** Added `fixed: true`
   to the header band render (was only on the footer). Both
   bands now appear on page 1, page 2, page 3, etc.

3. **Body padding bumped.** `page.paddingTop` +
   `page.paddingBottom`: 32 → 96 on both `page` + `pageRtl`
   (80 band + 16 gap). Body content sits inside the band
   area on every page; nothing slides under the pinned
   header or footer.

4. **Signature restructured to 2 rows.** The signature
   block is now `flexDirection: 'column'`:
   - Row 1: the doctor's actual signature image
     (the doctor's handwritten signature / stamp).
   - Row 2: the printed doctor name (bold).
   Dropped the `signatureLine` style + its render (the
   black underline between the boxes and the signature
   that the doctor complained about). Dropped the
   `signatureLabel` style + its render ("Signature: " text
   — no longer needed since the signature image IS the
   signature). Dropped the `alignItems: 'flex-end'` (rows
   now stack from the top).

## What changed

**`src/main/pdf/report.tsx`**:

- `HEADER_BAND_STYLE`:
  ```js
  position: 'absolute', top: 0, left: 0, right: 0,
  width: '100%', height: 80, backgroundColor: '#E6EFF1'
  ```
  (was: `width: '100%', height: 80, backgroundColor: '#E6EFF1',
  marginBottom: 6, padding: 4` — no absolute positioning).

- `FOOTER_BAND_STYLE`:
  ```js
  position: 'absolute', bottom: 0, left: 0, right: 0,
  width: '100%', height: 80, backgroundColor: '#E6EFF1'
  ```
  (was: `position: 'absolute', bottom: 32, left: 32, right: 32,
  width: 'auto', height: 80, backgroundColor: '#E6EFF1',
  padding: 4`).

- `page` + `pageRtl`: `paddingTop: 96, paddingBottom: 96,
  paddingLeft: 32, paddingRight: 32` (was: `padding: 32`
  with separate `paddingTop: 32, paddingBottom: 32`).

- `signatureBlock`: `flexDirection: 'column', alignItems:
  'flex-start', marginTop: 8, marginBottom: 6` (was:
  `flexDirection: 'row', alignItems: 'flex-end',
  marginBottom: 6, paddingTop: 6, paddingBottom: 6`).

- Added `signatureName` style (`fontSize: 10, fontWeight:
  'bold'`).

- Dropped `signatureLine` + `signatureLabel` styles.

- Header band render: added `fixed: true`.

- Signature block render: replaced the
  `signatureImage + signatureLabel + signatureLine` row
  with the `signatureImage` (row 1) + `doctorName` Text
  (row 2, bold, AR-flipped via `isAr`).

## Diff stat

```
src/main/pdf/report.tsx | +65/-64 (net +1)
```

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- `npx vitest run tests/renderer/pages/report-editor.test.tsx`
  → 10/10 pass.
- Manual checklist:
  - Bands span edge-to-edge across the page (no 32pt side
    margin).
  - Body content sits inside the band area on every page
    (no overlap with header on page 1, no overlap with
    footer on any page, no overlap with header on page
    2+).
  - Header appears on every page (page 1, page 2, page
    3…).
  - Signature area shows the signature image on row 1 +
    the printed doctor name on row 2 (no "Signature:"
    label, no underline).

## Files

- `src/main/pdf/report.tsx` — bands edge-to-edge + header
  fixed + signature restructure.
- `.planning/quick/20260907-pdf-multipage-fixes/PLAN.md`
  — plan.
- `.planning/quick/20260907-pdf-multipage-fixes/SUMMARY.md`
  — this file.

## Commit

`ecd6708 fix(pdf): edge-to-edge bands + header fixed on every page + signature image over name on row 2`