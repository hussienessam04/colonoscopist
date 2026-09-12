---
slug: procedure-room-ui-enhance
created: 2026-09-12
type: polish
source: ad-hoc user request (procedure room UI looks plain, doesn't match the rest of the app's clinical palette)
---

# Quick Task: procedure room UI enhancement

## Current state

The procedure room is the central work surface during a recording —
the most active, most "instrument-like" part of the app. Looking
at the rendered surfaces, it's the only screen in the app that
still uses `bg-slate-50` instead of the warm ivory (`#F7F1E6`)
palette every other page now wears. The live preview is a dark
slate-900 pane with a generic red `REC` badge in the corner and a
frosted controls bar at the bottom — functional, but it doesn't
feel like part of the same product as ProcedureReview,
ProcedurePreview, or the Patients list.

## Design plan (per the frontend-design skill)

The procedure room should feel like a **clinical instrument
console**: focused, with the live preview as the centerpiece, and
one distinctive signature element the doctor will remember.

### Token system (already established — inherit, don't redefine)

- Background: `#F7F1E6` (warm ivory) — match every other page
- Card surface: `#FBF7EE` (light ivory) + `#E0D9C6` hairline
- Accent: `#0E3A47` (deep teal) + `#E6EFF1` (light teal) +
  `#A8C5B5` (sage)
- Recording status: deep teal `#0E3A47` (NOT generic red — the
  rest of the app uses teal as the primary action color;
  reserving red for emergencies keeps the signal clear when it
  matters)

### Signature element: **console frame with corner brackets**

The live preview frame gets medical-imaging-style corner brackets
that animate teal when recording. They sit on the dark preview
pane (which is the only place this app uses pure black, since
Chromium native video controls need a dark backdrop), pulse
softly during recording, and vanish when idle. Distinctive enough
to be memorable; restrained enough to not distract from the
video itself.

### Other changes

1. **Background**: `bg-slate-50` → `bg-[#F7F1E6]` so the procedure
   room matches every other surface.
2. **Header polish**: instrument-style mono timer gets a thin
   teal underline when recording (replaces the plain mono span).
3. **REC indicator**: replace the floating red badge with an
   integrated status strip at the top of the preview pane —
   `STATUS · REC · DURATION` formatted like a medical instrument
   readout (small-caps, mono, teal accent). No more generic red.
4. **Recording controls bar**: subtle teal accent + ivory card
   instead of dark slate (the controls become readable on the
   dark video without competing with the instrument strip).
5. **Empty screenshots state**: a small `Camera` icon + a single
   sentence ("Screenshots will appear here during the procedure")
   instead of the current empty scrolling box.

## Files

- `src/renderer/src/pages/ProcedureRoom.tsx` — background
  switch, header timer polish, screenshots empty state,
  RecIndicator swap to instrument strip.
- `src/renderer/src/components/RecIndicator.tsx` — redesign
  into the top instrument strip (or remove if I inline it; see
  below).
- `src/renderer/src/components/RecordingControlsBar.tsx` —
  retint from slate to teal/ivory; the controls become part of
  the clinical design system rather than fighting it.
- `src/renderer/src/components/FramingGuide.tsx` — keep as is
  (subtle, already on-brand).

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `procedure-room.test.tsx` + `procedure-room-timer.test.tsx`
  → green.
- Manual: open the procedure room, start a recording, confirm:
    - Background is warm ivory, not slate
    - Corner brackets visible during recording, hidden when idle
    - Top strip reads `STATUS · REC · 00:00:23` in the clinical
      palette (no red)
    - Recording controls bar reads as part of the design
    - Empty screenshots rail shows the placeholder copy

## Out of scope

- Reskinning the device-lost banner (it's already on-brand).
- Major typography refresh (the serif h1 + small-caps kicker is
  already distinctive enough).
- Reworking the rail cards (Notes / Screenshots). They already
  use the ivory rail chrome; the rail itself is already on-brand.