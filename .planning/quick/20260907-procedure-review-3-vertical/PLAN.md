---
slug: procedure-review-3-vertical
created: 2026-09-07
type: polish
source: ad-hoc user request — collapse the 3-column grid into 3 stacked vertical sections
---

# Quick Task: Procedure Review — 3 vertical items (video | notes + trim + metadata + report CTA | screenshots)

## Issue

The current page layout is a 3-column grid:
- (1) Video + Scrubber (left, `procedure-review-left`)
- (2) Notes + Trim + Procedure metadata + Report CTA
  (middle, `procedure-review-middle`)
- (3) Screenshots (right, `procedure-review-screenshots-rail`)

The doctor wants a single-column vertical stack instead:
- (1) Video + Scrubber (top)
- (2) Notes panel (middle) — same chrome as the
  ProcedureRoom notes rail (`NotebookPen` icon + small-caps
  label + ProcedureNotesPanel + DeviceLostBanner). The
  Trim + Procedure metadata + Report CTA cards stay in the
  same vertical order below the Notes panel.
- (3) Screenshots (bottom) — full-width wrap-row
  thumbnails (`layout="row"` on the `ScreenshotTimeline`).

This matches the ProcedureRoom structure (live preview →
notes → captured-screenshots gallery) and gives the
screenshots room to breathe — no more "5 in a narrow
right column, then wrap row" cramped layout.

## Scope

- `src/renderer/src/pages/ProcedureReview.tsx`:
  - Drop the `lg:grid-cols-[minmax(0,1fr)_320px_320px]`
    3-column grid. Replace with a single-column flex
    layout: video card → notes panel (with Trim /
    metadata / Report CTA still inside the same panel) →
    screenshots card.
  - Move the Screenshots `RAIL_CARD_CHROME` from the
    right rail to the bottom of the page (full width).
  - The screenshots card drops the `max-h-[70vh]`
    scroll container — at full width the timeline's
    horizontal scroll handles overflow naturally; no need
    to cap the height.
  - Keep all `data-testid`s on each section
    (`procedure-review-left` / `procedure-review-middle` /
    `procedure-review-screenshots` /
    `procedure-review-screenshots-rail`) so the existing
    tests that look up by testid still find them. The
    middle section's `data-testid` stays
    `procedure-review-middle` (it's the notes+rail
    surface); the screenshots rail testid stays
    `procedure-review-screenshots-rail` (now positioned at
    the bottom, not the right).
  - Drop the `procedure-review-screenshots-rail`
    `<aside>` wrapper around the Screenshots card since
    it's no longer a rail — the card now sits in the
    page-level flow.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `ProcedureReview.test.tsx` → 13/13 still pass.
- `procedure-room-timer.test.tsx` → 20/20 still pass.
- Manual: open a finalized procedure → page renders as
  a single column: video + scrubber (top) → notes + Trim +
  Procedure metadata + Report CTA (middle) → screenshots
  (bottom, full width).

## Out of scope

- The order of items inside the notes panel (Notes → Trim
  → Procedure metadata → Report CTA — same order as before).
- The screenshot timeline's `layout` prop — still uses
  `layout="row"` (horizontal scroll) since the section is
  now full-width. No `max-h-[70vh]` scroll wrapper.
- Touch / keyboard shortcut overlays (out of scope; out of
  scope already in the previous design-enhance quick task).