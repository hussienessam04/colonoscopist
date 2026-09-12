---
slug: pdf-extras-3-per-row-page1
created: 2026-09-12
type: polish
source: ad-hoc user report (extras wrap row first row shows only 1 instead of 3 on page 1)
---

# Quick Task: extras wrap row — fit 3 per row on page 1

## Issue

The extras wrap row (`flexDirection: 'row'` + `flexWrap: 'wrap'`)
lays extras horizontally, but page 1 only has ~72pt of vertical
space left after the main row. Since each extras thumb is 88pt
tall, only 1 (or a partial) thumb fits on page 1 — the rest
spills to page 2.

The doctor wants the FIRST ROW of the extras wrap row to fit 3
horizontal thumbnails on page 1 (instead of just one).

## Page 1 height budget

| Section                     | pt       |
| --------------------------- | -------- |
| paddingTop (band + gap)     | 96       |
| Info box 1 (instrument)     | ~36      |
| Info box 2 (patient)        | ~36      |
| Main row (right column dominates at 5×88 + 4×4 margin = 456pt) | ~456 |
| **Available for extras**    | **~72**  |
| paddingBottom (band + gap)  | 96       |
| Total                       | ~792     |

The right column at 5×88pt = 440pt + 16pt margin = 456pt is the
single biggest vertical consumer.

## Fix

Reduce the right column thumbnail height from 88pt to 72pt.
Saves 5 × 16 = 80pt on page 1.

After the change, page 1 has ~152pt available for extras. One
row of 3 extras (88pt tall) fits comfortably with ~64pt to
spare; a 2nd row (or partial) can spill to page 2 if there are
many extras.

## Scope

- `src/main/pdf/report.tsx`:
  - `RIGHT_COL_THUMB_HEIGHT = 72` (was: 88).
  - Update the comment block to explain the page-1 vertical
    budget math.

## Verification

- `npm run typecheck` → exits 0.
- Render a PDF with 8 attached screenshots (5 right column + 3
  extras) → page 1 shows the right column + all 3 extras
  packed horizontally at the bottom. No raw %PDF- byte issues,
  size > 5 KB.

## Out of scope

- Changing `RIGHT_COL_THUMB_COUNT` (stays 5 per doctor's lock).
- Restructuring main row layout.
- Reducing extras thumb size (kept at 88pt — visual consistency
  is preserved by leaving extras alone; right column is the
  constraint).

## Why not move extras above main row?

Could put extras at the top of page 1 (above main row) so
they always fit, but that changes the reference-image layout.
Reducing right column height is the smaller change that
delivers the same outcome for typical report sizes (≤8
screenshots).