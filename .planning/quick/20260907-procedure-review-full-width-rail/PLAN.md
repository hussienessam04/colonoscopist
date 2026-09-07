---
slug: procedure-review-full-width-rail
created: 2026-09-07
type: polish
source: ad-hoc user request after the procedure-review-ui-enhance quick task
---

# Quick Task: Procedure Review — full width + vertical screenshots next to Notes

## Issues

1. **Page takes full width.** Currently the page shell is
   constrained by `max-w-7xl` (80rem) + `mx-auto`. The
   doctor wants the page to span the full window width —
   matches the wider feel of the Report Editor
   (`max-w-7xl` there too, but the wider grid columns
   justify the full-window feel). Drop the `mx-auto` /
   `max-w-7xl` on the outer wrapper so the document card
   + grid use the full available width.

2. **Screenshots box vertical next to Notes.** Currently
   the `ScreenshotTimeline` lives BELOW the video (inside
   the left column). The doctor wants the screenshots in
   a vertical column next to `Notes` in the right rail —
   same shape as the Report Editor's screenshot column
   (right side, vertical stack). Move the
   `ScreenshotTimeline` out of the left column into the
   right rail, directly under the Notes card.

## Scope

- `src/renderer/src/pages/ProcedureReview.tsx`:
  - Outer wrapper: drop `mx-auto max-w-7xl`. Keep the
    `flex flex-col gap-5` so the header + grid keep their
    spacing; the content now spans full width.
  - Left column: drop the inner `<div className="flex
    flex-col gap-2">` that wraps `Scrubber` +
    `ScreenshotTimeline`. Now contains only the video +
    `Scrubber` (under a small-caps "Timeline" label).
  - Right rail: add a new `RAIL_CARD_CHROME` card under
    Notes with a small-caps "Screenshots" label + the
    `ScreenshotTimeline` instance. Keep the other rail
    cards (Trim, Procedure metadata, Report CTA) in the
    same vertical stack.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `ProcedureReview.test.tsx` → 13/13 still pass.
- `procedure-room-timer.test.tsx` → 20/20 still pass.
- Manual: open a finalized procedure → document surface
  spans the full window width; screenshots render in a
  vertical column in the right rail under Notes (not
  below the video).

## Out of scope

- Scrubber position (still below the video — the doctor
  didn't ask to move it).
- Trim / Procedure / Report CTA card order (Trim next,
  Procedure metadata, Report CTA — same order as before).
- New design tokens (chrome palette + small-caps
  constants from the previous task carry over; no new
  constants).