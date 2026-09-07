---
slug: procedure-review-3-columns
created: 2026-09-07
type: polish
source: ad-hoc user request after procedure-review-full-width-rail
---

# Quick Task: Procedure Review — 3-column layout (video | notes + Trim + Metadata + Report CTA | screenshots)

## Issue

Currently the page has 2 columns:
- Left: video + Scrubber (under the "Timeline" label)
- Right: Notes + Screenshots + Trim + Procedure metadata + Report CTA (stacked)

The doctor wants a 3-column layout:
- (1) Video + Scrubber
- (2) Notes + Trim + Procedure metadata + Report CTA
- (3) Screenshots

In other words: split the right rail into a "middle rail"
(Notes + Trim + Metadata + Report CTA) and a "right rail"
(Screenshots only). Same idea as the Report Editor's
right-side screenshot column — a dedicated screenshots
column on the far right of the page.

## Scope

- `src/renderer/src/pages/ProcedureReview.tsx`:
  - The outer `section` grid becomes a 3-column grid:
    `lg:grid-cols-[minmax(0,1fr)_320px_320px]` (video
    flexes, the middle rail is 320pt, the screenshots
    rail is 320pt). On smaller screens the columns stack
    (single column at <lg).
  - The 2nd column (middle rail) contains: Notes, Trim,
    Procedure metadata card, Report CTA card. Each in its
    own `RAIL_CARD_CHROME` card.
  - The 3rd column (screenshots rail) contains: the
    `ScreenshotTimeline` in a single `RAIL_CARD_CHROME`
    card.
  - The left column keeps the video + Scrubber.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `ProcedureReview.test.tsx` → 13/13 still pass.
- `procedure-room-timer.test.tsx` → 20/20 still pass.
- Manual: open a finalized procedure → page renders as
  three columns: video + scrubber (left), notes + trim +
  metadata + report CTA (middle), screenshots (right).

## Out of scope

- Re-arranging the order of cards in the middle rail
  (Notes → Trim → Procedure metadata → Report CTA — same
  order as before).
- The screenshots rail chrome (uses the same
  `RAIL_CARD_CHROME` + small-caps "Screenshots" label
  from the previous quick task; nothing new).
- Adding a ScreenshotLightbox trigger (already wired).