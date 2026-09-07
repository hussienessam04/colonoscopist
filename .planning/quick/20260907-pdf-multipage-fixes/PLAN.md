---
slug: pdf-multipage-fixes
created: 2026-09-07
type: bugfix+polish
source: ad-hoc user report (4 issues from the redesigned PDF on multi-page reports)
---

# Quick Task: PDF multi-page fixes — full-width bands + header on every page + drop line + signature restructure

## Issues

1. **Header image and footer image don't fill the full
   width.** The bands render at `width: '100%'` for header
   and `width: 'auto'` for footer, but both are inset by the
   page's left/right padding (32pt). The image inside is
   constrained by the band. Fix: bands stretch edge-to-edge
   (`position: 'absolute', left: 0, right: 0`, no inset
   margin), `width: '100%'`. The image inside fills the band
   width with `objectFit: 'contain'` so vertical empty
   space is filled by the band background.

2. **Body content slides under the absolute-positioned
   footer/header on page 2+.** The current layout puts the
   header in the BODY flow (not `fixed`) so it only appears on
   page 1, and the footer is `fixed: true` with `bottom: 32`.
   On page 2 the body content starts at the top of the page
   (under where the header WOULD be if it were fixed) and
   extends to the bottom (under the footer). Fix: make the
   header `fixed: true` too with `top: 0`; bump the page's
   `paddingTop` + `paddingBottom` so the body content sits
   inside the band area on every page.

3. **Header is missing on page 2+ when the PDF is multi-page.**
   Same root cause as #2 — header is part of the body flow.
   Fix: `fixed: true` on the header band (matches the footer).

4. **Black line still appears between boxes and signature.**
   The `signatureLine` style has
   `borderTopWidth: 1, borderColor: '#0f172a'` — a near-black
   underline where the doctor would sign. With the previous
   restructure (signature image + label + line all in one
   row), the line is visually a separator above the
   signature area. Drop the border entirely; the signature
   image IS the signature.

5. **Restructure the signature block: signature on one line,
   doctor name on the second line.** Currently
   `signatureBlock` is a single row with image + "Signature:"
   label + line + name. The doctor wants the signature image
   (the actual handwritten signature / stamp) on its own
   row, then the printed doctor name on the row below. No
   "Signature:" label, no underline — the signature image
   replaces both.

## Scope

- `src/main/pdf/report.tsx`:
  - `HEADER_BAND_STYLE`:
    `position: 'absolute', top: 0, left: 0, right: 0,
     width: '100%', height: 80, backgroundColor: '#E6EFF1',
     marginBottom: 0` (was: `width: '100%', marginBottom: 6,
     padding: 4`). Drop the padding (the image fills the
     band edge-to-edge).
  - `FOOTER_BAND_STYLE`:
    `position: 'absolute', bottom: 0, left: 0, right: 0,
     width: '100%', height: 80, backgroundColor: '#E6EFF1'`
     (was: `bottom: 32, left: 32, right: 32, width: 'auto',
     padding: 4`). Edge-to-edge like the header.
  - `HEADER_BAND_IMAGE_STYLE` + `FOOTER_BAND_IMAGE_STYLE`:
    keep `objectFit: 'contain'` so the image's natural
    aspect ratio is preserved inside the band.
  - `page` + `pageRtl.paddingTop`: 32 → 96 (header band 80 +
    16 gap). `paddingBottom`: 124 → 96 (footer band 80 + 16
    gap).
  - `signatureBlock`: `flexDirection: 'column'` (was:
    'row'). Drop `alignItems: 'flex-end'`.
  - Drop `signatureLine` style + its render.
  - Drop `signatureLabel` style + its render (no more
    "Signature:" text).
  - Signature block render: image on top (with `alignSelf:
    'flex-start'` so it stays left-aligned), doctor name as
    a Text below.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `report-editor.test.tsx` → 10/10 still pass.
- Manual: open a finalized report in the Report Editor →
  attach enough screenshots (8+) to force a multi-page PDF →
  open the PDF:
  - Header band + footer band both stretch edge-to-edge
    across the page (no 32pt side margin).
  - Body content sits inside the band area on every page
    (no overlap with header on page 1, no overlap with
    footer on any page, no overlap with header on page 2+).
  - Header appears on every page (page 1, page 2, page 3…).
  - Signature area shows the signature image on one row
    + the printed doctor name on the row below (no
    "Signature:" label, no underline).

## Out of scope

- Header band height tuning (still 80pt). If the doctor's
  uploaded header image has a different aspect ratio, the
  band background shows around the image (matching the
  always-render + tinted-strip behavior).
- Footer image aspect handling (same as header).
- Multi-page PDF pagination tuning (the body content flows
  naturally; the page break is automatic once the body
  exceeds the available height between the pinned bands).