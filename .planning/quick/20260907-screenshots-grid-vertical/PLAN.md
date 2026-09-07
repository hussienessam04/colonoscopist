---
slug: screenshots-grid-vertical
created: 2026-09-07
type: polish
source: ad-hoc user request after procedure-review-3-columns
---

# Quick Task: Procedure Review — enhance Screenshots box + vertical-grid overflow

## Issue

The new "Screenshots" column (third column from the
previous quick task) currently uses
`ScreenshotTimeline` with `layout="row"` (default) —
horizontal scroll of single-row thumbnails. The doctor
wants:

1. **Vertical grid layout** for the screenshots — use the
   existing `layout="grid"` branch (2-column vertical grid
   with `overflow-y-auto`) so thumbnails wrap onto
   multiple rows + the grid scrolls vertically inside the
   card. Matches the right-side screenshot column in the
   Report Editor.

2. **Enhanced Screenshots box chrome** — the rail card is
   currently a bare `RAIL_CARD_CHROME` + small-caps label
   + `ScreenshotTimeline`. Add:
   - A mono count badge next to the label
     (`screenshots.length` formatted as
     `<span className="font-mono tabular-nums">N</span>` so
     the doctor can scan the count at a glance).
   - A subtle hairline divider between the label row and
     the timeline so the section title reads as a distinct
     block.
   - The card itself uses `flex flex-col` + a fixed-height
     content area (`max-h-[70vh] overflow-y-auto`) so the
     screenshots grid scrolls inside the card without
     growing the page vertically.

## Scope

- `src/renderer/src/pages/ProcedureReview.tsx`:
  - In the Screenshots rail `<aside>`, pass
    `layout="grid"` to the `ScreenshotTimeline`.
  - Enhance the Screenshots card: small-caps label +
    mono count + hairline divider + the
    `ScreenshotTimeline` (grid layout) wrapped in a
    scrollable container (`max-h-[70vh] overflow-y-auto`).

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `ProcedureReview.test.tsx` → 13/13 still pass.
- `procedure-room-timer.test.tsx` → 20/20 still pass.
- Manual: open a finalized procedure with many captures →
  Screenshots card renders the count + a 2-column grid of
  thumbnails that scrolls vertically inside the card.

## Out of scope

- ScreenshotThumbnail component internals (no change —
  the grid layout prop just changes the container chrome).
- The horizontal-scroll layout (kept available for other
  callers via the `layout` prop).
- Replacing the vertical scroll with infinite-scroll or
  virtualization (out of scope for a quick task).