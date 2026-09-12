---
slug: procedure-room-notes-collapsed-default
created: 2026-09-12
type: polish
source: ad-hoc user request (notes panel should sit on the left, be collapsible, and be collapsed by default to give the live preview more horizontal space)
---

# Quick Task: notes panel — left side, collapsible, default collapsed

## Current state

The notes panel sits as the middle column of the room's
3-column grid (`preview | notes | screenshots`), shows by
default, and only collapses alongside the screenshots rail
(`notesCollapsed === true` hides both). The doctor wants:

1. Notes on the **left** of the preview (currently in the middle).
2. Independently **collapsible** (currently tied to screenshots).
4. **Collapsed by default** so the preview takes the room.

## Approach

`src/renderer/src/pages/ProcedureRoom.tsx`:

- Default `notesCollapsed` to `true` (was `false`).
- Decouple screenshots from notes state — screenshots rail
  always renders now. The right column stays put regardless of
  whether notes is open or closed.
- Reorder the grid so notes is the FIRST column when expanded:
    - notes collapsed → `lg:grid-cols-[minmax(0,1fr)_20rem]`
      (preview + screenshots)
    - notes expanded  → `lg:grid-cols-[20rem_minmax(0,1fr)_20rem]`
      (notes | preview | screenshots)
- Add a toggle affordance so the doctor can flip between the two:
    - When **expanded**: a small `Hide notes` button in the
      notes panel header (already exists, just promoted).
    - When **collapsed**: a vertical floating "Notes" pill on
      the LEFT EDGE of the preview card. Vertical orientation
      so it reads as a "rail tab" rather than competing with the
      Back-to-Preview button in the header.
- Persistence is per-session (in-memory only); a future
  enhancement can localStorage it.

## Files

- `src/renderer/src/pages/ProcedureRoom.tsx`

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `procedure-room.test.tsx` + `procedure-room-timer.test.tsx`
  → all green (the screenshots test still scopes to the gallery
  container).
- Manual:
  - Procedure Room → notes panel is collapsed by default;
    preview is wider.
  - Click the vertical "Notes" pill → notes panel slides in
    from the left, preview narrows.
  - Click "Hide notes" in the notes panel header → notes
    collapse back, preview widens.

## Out of scope

- Persisting the collapsed state across sessions.
- Animating the collapse transition (a future polish — the
  layout shift is fast enough on its own).
- Re-organizing the screenshots rail.