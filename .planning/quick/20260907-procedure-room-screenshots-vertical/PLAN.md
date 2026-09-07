---
slug: procedure-room-screenshots-vertical
created: 2026-09-07
type: polish
source: ad-hoc user request — make screenshots vertical next to notes in ProcedureRoom
---

# Quick Task: ProcedureRoom — screenshots box vertical next to notes

## Issue

In `ProcedureRoom.tsx`, the screenshots gallery currently
lives BELOW the video + notes area as a full-width
section with a horizontal-scroll timeline
(`ScreenshotTimeline` with `layout="row"`). The doctor
wants the screenshots in a vertical column next to the
Notes panel — same shape as the ProcedureReview
"right-side screenshots column" (just on a different
page). Three columns now: video + RecordingControlsBar
(left), Notes aside (middle), Screenshots vertical column
(right).

## Scope

- `src/renderer/src/pages/ProcedureRoom.tsx`:
  - Restructure the section grid from
    `lg:grid-cols-[minmax(0,1fr)_20rem]` (video + 20rem
    notes aside) to
    `lg:grid-cols-[minmax(0,1fr)_20rem_20rem]` (video +
    20rem notes + 20rem screenshots).
  - Add a third `<aside>` next to the existing Notes
    aside. The new aside wraps the existing gallery
    `<section>` content (small-caps label + mono count +
    `ScreenshotTimeline`) in a `RAIL_CARD_CHROME` card.
  - Drop the full-width `<section
    data-testid="procedure-room-gallery-section">` from
    the bottom of the page (its content moves into the
    third column).
  - The screenshots card uses `layout="grid"` (2-column
    vertical grid) on the `ScreenshotTimeline` so the
    thumbnails stack vertically with overflow scrolling
    inside the card. `max-h-[60vh] overflow-y-auto` caps
    the card height so the page layout stays compact.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `procedure-room-timer.test.tsx` → 20/20 still pass.
- Manual: open the procedure room → page renders as
  three columns: live preview (left), Notes panel
  (middle, ~20rem), Screenshots vertical column
  (right, ~20rem). The screenshots scroll vertically
  inside the right column instead of flowing
  horizontally below the video.

## Out of scope

- ProcedureReview layout — not touched (the doctor
  clarified: don't touch ProcedureReview).
- Adding a screenshot capture flow inside the
  screenshots card (already wired: the timeline's
  `+Capture` button fires the same `handleScreenshotCapture`
  used by the `S` hotkey and the `RecordingControlsBar`
  capture button).
- The capture-device pickers / SettingsCapture chrome
  (kept as-is).