---
slug: procedure-room-ui-enhance
created: 2026-09-07
type: redesign
source: ad-hoc user request — frontend-design skill, ProcedureReview style
---

# Quick Task: enhance Procedure Room UI using frontend-design skill (ProcedureReview style)

## Goal

Apply the same visual language that lives on
`ProcedureReview.tsx` (warm ivory + white document surface,
deep teal `#0E3A47` accent, small-caps section labels,
mono date/duration values, teal-tinted primary actions,
serif page title) to `ProcedureRoom.tsx` — the live
recording surface.

## Source of truth

- **Target page**: `src/renderer/src/pages/ProcedureRoom.tsx`
- **Style source**: `src/renderer/src/pages/ProcedureReview.tsx`
  (the page that introduced the "clinical workstation"
  look via quick task 20260906-report-editor-clean-refresh
  + the procedure-review-ui-enhance polish pass).

## Existing design tokens to reuse

Inline constants (copy/paste from ProcedureReview.tsx):

```ts
const CARD_CHROME =
  "rounded-lg border border-[#E0D9C6] bg-white shadow-sm";
const RAIL_CARD_CHROME =
  "rounded-lg border border-[#E0D9C6] bg-[#E6EFF1] p-4 shadow-sm transition-colors hover:border-[#A8C5B5]";
const SMALL_CAPS_LABEL =
  "text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]";
const SMALL_CAPS_FIELD =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]";
const SECONDARY_OUTLINE_BUTTON =
  "border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]";
const PRIMARY_TEAL_BUTTON =
  "bg-[#0E3A47] text-white hover:bg-[#0B2C36] shadow-inner";
```

## One signature element

**Live elapsed-recording timer in the header.** The page
already shows `timerLabel` (HH:MM:SS) inside the
`RecordingControlsBar`. Promote it to the header so the
doctor can see the elapsed time without looking at the
preview pane — same clinical-instrumentation feel as the
`VideoTimestampBadge` on ProcedureReview, but in the
header (always visible) instead of over the video.

The header becomes a small-caps kicker (e.g.
"Procedure · recording") + serif h1 (procedure room) +
status pill (`<RecIndicator />` already exists) + mono
elapsed timer (`font-mono tabular-nums text-[#0E3A47]`)
+ Back-to-Preview slate outline button.

## Restrained polish everywhere else

1. **Header band** — same shape as ProcedureReview:
   - Left: small-caps kicker (`procedure.pageKicker`) +
     serif h1 (`procedure.pageTitle`)
   - Right: live elapsed timer (mono) + status pill +
     secondary outline Back button
2. **Live preview card** — replace `bg-slate-100/900` outer
   with `bg-[#FBF7EE]` + `border-[#E0D9C6]` (the dark
   `bg-slate-900` stays for the video frame itself — same as
   ProcedureReview). The card chrome uses `CARD_CHROME`.
3. **Side panel** (Notes + DeviceLostBanner) — wrapped in
   `RAIL_CARD_CHROME` + small-caps "Notes" label + a
   NotebookPen icon. Hide/Show button uses the
   `SECONDARY_OUTLINE_BUTTON` chrome.
4. **Gallery section** — replaced with `CARD_CHROME` +
   small-caps "Captured screenshots" label + a count badge
   (mono tabular-nums) + the `ScreenshotTimeline` in
   `layout="row"` (horizontal scroll — fits the wide
   full-width section below the live preview).
5. **Recording state accent** — the existing `<RecIndicator>`
   stays as a sub-component (no change); the header's new
   status pill echoes its color so the doctor sees the
   recording state in two places (consistent
   instrumentation).

## Files touched

- `src/renderer/src/pages/ProcedureRoom.tsx` — refactor
  chrome (page shell + header + side panel + gallery). No
  data flow changes; no IPC contract changes; no new
  components.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `npx vitest run tests/renderer/pages/procedure-room-timer.test.tsx`
  → 20/20 still pass (covers the ProcedureRoom pause /
  status / partial-status / post-recording navigation
  flows).
- Manual: open a procedure room → page renders with the
  warm ivory document surface + teal accents + small-caps
  labels + serif h1 + live mono timer in the header, all
  consistent with ProcedureReview + Report Editor.

## Out of scope

- Refactoring the recording-controls sub-component
  (`RecordingControlsBar.tsx`) — it lives in its own file
  + has its own pause/play state machine. Out of scope
  for a quick task.
- The capture-device pickers (`SettingsCapture.tsx` et
  al.) — they keep their current shadcn chrome; only the
  page surface inside `ProcedureRoom.tsx` is refactored.
- The `<RecIndicator>` itself — it stays as a
  sub-component with its existing animation.