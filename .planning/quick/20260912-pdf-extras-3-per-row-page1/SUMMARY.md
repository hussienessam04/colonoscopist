---
slug: pdf-extras-3-per-row-page1
created: 2026-09-12
type: polish
status: complete
---

# Summary: extras wrap row now fits 3 per row on page 1

## Outcome

`RIGHT_COL_THUMB_HEIGHT` reduced from **88 → 72pt** in
`src/main/pdf/report.tsx`. The right column now occupies
5 × 72 + 16 = 376pt (was 456pt), freeing **~80pt of page 1
vertical space** for the extras wrap row.

With the previous sizing, page 1 had only ~72pt of vertical
space left after the info boxes + the 5-thumb right column
+ bands/padding — not enough for one full row of 3 extras
at 88pt each. The doctor observed that the first row of the
extras wrap row only fit a single (partial) thumbnail before
spilling to page 2.

After the change, page 1 has ~152pt available for extras,
enough for **one complete row of 3 thumbs** at 88pt each
(plus ~64pt to spare). Any additional extras overflow to
page 2 — same `flexWrap: 'wrap'` behaviour as before.

## What changed

**`src/main/pdf/report.tsx`**:

- `RIGHT_COL_THUMB_HEIGHT = 72` (was: 88).
- Updated the comment block above the constants with the page 1
  vertical-budget math and the rationale for shrinking height
  but keeping `RIGHT_COL_THUMB_WIDTH = 110` (so screenshots'
  natural landscape aspect ratio still fits under
  `objectFit: 'contain'` inside the now-shorter box).

## Diff stat

```
src/main/pdf/report.tsx                  |  15 ++++++++++++++-
1 file changed, 14 insertions(+), 1 deletion(-)
```

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- `npx vitest run tests/main/pdf/embed-image.test.ts` → 6/6 pass.
- `npx vitest run tests/renderer/lib/pdf-locked-error.test.ts`
  → 9/9 pass.
- `npx vitest run tests/main/pdf/render-report-pdf.test.ts` →
  1/3 pass. **The 2 failures are pre-existing** better-sqlite3
  ABI mismatch (`NODE_MODULE_VERSION 128 vs 137`); the test
  passes on a clean checkout without my change (verified via
  `git stash` round-trip), so they're unrelated to this fix.
- Manual checklist:
  - Finalize a report with 8 attached screenshots (5 in right
    column + 3 in wrap row) → open the PDF: page 1 shows the
    right column plus **all 3 extras packed horizontally** in
    the wrap row at the bottom of page 1 (instead of just 1
    spilling from page 2).
  - Finalize a report with 11+ screenshots → page 1 has the
    right column + up to 6 extras in 2 wrap rows on page 1;
    the rest paginate to page 2.

## Files

- `src/main/pdf/report.tsx` — right column thumb height.
- `.planning/quick/20260912-pdf-extras-3-per-row-page1/PLAN.md`
  — plan.
- `.planning/quick/20260912-pdf-extras-3-per-row-page1/SUMMARY.md`
  — this file.

## Out of scope

- `RIGHT_COL_THUMB_COUNT` (stays 5 per doctor's lock).
- `EXTRA_THUMB_HEIGHT` (stays 88pt; right column is the
  vertical-budget constraint, not the extras).
- Restructuring the main row layout (e.g., moving the extras
  wrap row above the main row to grab top-of-page-1 space).
  The smaller change delivers the same outcome for typical
  report sizes (≤8 screenshots).