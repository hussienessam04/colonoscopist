---
slug: procedure-review-full-width-rail
created: 2026-09-07
type: polish
status: complete
---

# Summary: Procedure Review — full width + vertical screenshots next to Notes

## Outcome

Two layout changes per the doctor's ad-hoc request after
the `procedure-review-ui-enhance` quick task:

1. **Page takes full width.** Dropped `mx-auto max-w-7xl`
   from the outer wrapper. The document card + 2-column
   grid now span the full window width (matches the wider
   feel of the Report Editor). Kept the inner
   `flex flex-col gap-5` so header + section keep their
   rhythm.

2. **Screenshots vertical column next to Notes.** The
   `ScreenshotTimeline` moved out of the left column
   (where it sat BELOW the video + Scrubber) into the
   right rail, directly under the Notes card. Same shape
   as the Report Editor's screenshot column (right side,
   vertical stack). Wrapped in a `RAIL_CARD_CHROME` card
   with a small-caps "Screenshots" label +
   `data-testid="procedure-review-screenshots"`.

## What changed

**`src/renderer/src/pages/ProcedureReview.tsx`**:

- Outer wrapper: `mx-auto flex max-w-7xl flex-col gap-5`
  → `flex flex-col gap-5`.
- Missing-procedure-id block: same — dropped the
  `mx-auto max-w-7xl` wrapper so it matches.
- Left column: dropped the `ScreenshotTimeline` render.
  Now contains only the video + `Scrubber` (under a
    small-caps "Timeline" label).
- Right rail: added a new `RAIL_CARD_CHROME` card under
  Notes with a small-caps "Screenshots" label +
  `ScreenshotTimeline` instance. Order in the right rail:
  Notes → Screenshots → Trim → Procedure metadata → Report
  CTA.

## Diff stat

```
src/renderer/src/pages/ProcedureReview.tsx | 95 +++++++++++--------
  (1 file changed, +78/-17)
```

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- `npx vitest run tests/renderer/pages/ProcedureReview.test.tsx`
  → 13/13 pass.
- `npx vitest run tests/renderer/pages/procedure-room-timer.test.tsx`
  → 20/20 pass.
- Manual: open a finalized procedure → document surface
  spans the full window width; screenshots render in a
  vertical column in the right rail under Notes (not
  below the video).

## Files

- `src/renderer/src/pages/ProcedureReview.tsx` — full
  width + screenshot column move.
- `.planning/quick/20260907-procedure-review-full-width-rail/PLAN.md`
  — plan.
- `.planning/quick/20260907-procedure-review-full-width-rail/SUMMARY.md`
  — this file.

## Commit

`45335d4 feat(procedure-review): full width + screenshots column next to Notes`