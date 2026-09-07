---
slug: procedure-review-design-enhance
created: 2026-09-07
type: polish
source: frontend-design skill audit after procedure-review-3-columns + screenshots-grid-vertical
---

# Quick Task: Procedure Review — frontend-design polish pass

## Audit (skill lens)

Pulling up the current page after the last 4 quick tasks:

- 3-column structure (video + scrubber | Notes + Trim + Metadata + Report CTA | Screenshots grid)
- Warm ivory + teal accent palette
- Small-caps labels + serif h1 + mono tabular-nums values

The page reads as a clinical workstation, but per the
frontend-design skill ("Spend your boldness in one place",
"keep everything around it quiet and disciplined"), it
needs one signature element + restrained polish elsewhere.

## One signature element

**Video player timestamp overlay.** The video is currently
a black box with native browser controls. Add a discreet
top-LEFT mono timestamp badge (e.g. `00:01:23 / 00:14:32`)
that updates as the video plays. This:

- Reads as **clinical instrumentation** (think: medical
  monitor showing procedure elapsed time). Reinforces the
  clinical-workstation language without being gimmicky.
- Hides when the video is not ready (no src / not loaded /
  no duration).
- Sits on top-LEFT so it doesn't fight native browser
  controls on the bottom.

## Restrained polish elsewhere

1. **Rail card hover states.** Subtle hover transition
   (border darkens slightly to `#A8C5B5` teal-tint on
   hover). Adds tactile feedback without being noisy.
2. **Empty states.** When the page mounts without screenshots
   OR notes, show a small clinical empty-state line
   ("No notes captured for this procedure yet") with a
   subtle icon (Lucide). Currently the cards just render
   empty.
3. **Metadata card icon accents.** Tiny Lucide icons
   (`User`, `Calendar`, `Clock`, `CalendarClock`) next to
   each small-caps field label in the metadata card. Adds
   rhythm without adding color or weight.
4. **Trim card icon.** Small Lucide `Scissors` icon next
   to the "Trim" label.
5. **Notes card icon.** Small Lucide `NotebookPen` icon
   next to the "Notes" label.

## Scope

- `src/renderer/src/pages/ProcedureReview.tsx`:
  - Add `VideoTimestampOverlay` component (inline helper,
    tracks `videoRef.currentTime` via a small `useState`
    + `useEffect` that subscribes to the video's
    `timeupdate` event; renders the mono badge in the
    top-LEFT of the video frame, hidden when the video
    isn't ready).
  - Add hover state to `RAIL_CARD_CHROME` (CSS-only via
    `hover:border-[#A8C5B5] transition-colors`).
  - Empty states for the Notes card + Screenshots card
    when their respective data is empty.
  - Lucide icons + tailwind spacing on the section
    labels (Notes / Trim / Procedure metadata) + metadata
    field rows.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `ProcedureReview.test.tsx` → 13/13 still pass.
- `procedure-room-timer.test.tsx` → 20/20 still pass.
- Manual: open a finalized procedure → see:
  - Video player shows a small mono timestamp badge in
    the top-LEFT that updates as the video plays.
  - Rail cards have a subtle teal hover state on hover.
  - Empty Notes card shows a clinical empty-state
    message with a notebook icon.
  - Empty Screenshots card shows a clinical empty-state
    message with a camera icon.
  - Metadata card has small icons next to each field.

## Out of scope

- Reworking the video player chrome beyond the timestamp
  overlay (native controls stay — Chromium handles pause /
  play / volume / seek well).
- A custom waveform / pulse-line animation (out of scope
  for a quick task; would be a signature on its own if the
  doctor wanted it).
- Touch / keyboard shortcut overlays (out of scope; the
  page already has the `S` hotkey for capture in
  ProcedureRoom).