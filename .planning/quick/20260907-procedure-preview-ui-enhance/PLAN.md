---
slug: procedure-preview-ui-enhance
created: 2026-09-07
type: redesign
source: ad-hoc user request — frontend-design skill, ProcedureReview + ProcedureRoom style
---

# Quick Task: enhance Procedure Preview UI using frontend-design skill

## Goal

Apply the same visual language that lives on
`ProcedureReview.tsx` + `ProcedureRoom.tsx` (warm ivory +
white document surface, deep teal `#0E3A47` accent,
small-caps section labels, mono date/duration values,
teal-tinted primary actions, serif page title) to
`ProcedurePreview.tsx` — the device-pick + frame-the-shot
preview page that the doctor lands on before recording.

## Source of truth

- **Target page**: `src/renderer/src/pages/ProcedurePreview.tsx`
- **Style source**: `src/renderer/src/pages/ProcedureReview.tsx`
  + `src/renderer/src/pages/ProcedureRoom.tsx` (both
  share the clinical-workstation chrome via the quick
  task series).

## Existing design tokens to reuse

Inline constants (copy/paste from ProcedureReview / Room):

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

**Live preview status pill** — replaces the current
"Streaming live feed" / "Idle" string in the side panel
with a small status pill that shows:
- Small teal pulsing dot when `isRunning` is true +
  `Capture device` label
- Empty dot + "Idle" when not streaming
- Mono current-time / duration timestamp overlay on
  the video frame (mirrors ProcedureReview's
`VideoTimestampBadge` — clinical-instrumentation feel)

The pill sits next to the "Capture device" small-caps
label so the doctor sees live state at a glance without
reading the text.

## Restrained polish everywhere else

1. **Header band** — small-caps "Preview" kicker + serif
   h1 ("Preview & setup") + secondary outline Back-to-
   patients button. Same shape as ProcedureReview +
   ProcedureRoom.
2. **Live preview card** — `CARD_CHROME` (warm ivory
   border + bg-white). The dark `bg-slate-900` stays for
   the video frame (Chromium native controls).
3. **Side panel** — `RAIL_CARD_CHROME` + small-caps
   section labels + Camera + Video + ArrowRight Lucide
   icons.
4. **Continue-to-recording button** — `PRIMARY_TEAL_BUTTON`
   (replaces the shadcn default variant). Bigger size for
   emphasis — this is the primary CTA on the page.
5. **"Pick a device" placeholder** — current shadcn
   `Select` keeps its existing chrome; just gets the
   `w-full` + warm-ivory placeholder styling tweaks.

## Files touched

- `src/renderer/src/pages/ProcedurePreview.tsx` —
  refactor chrome (page shell + header + live preview +
  side panel + button styles). No data flow changes; no
  IPC contract changes; no new components.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `npm test` for any ProcedurePreview tests (currently
  none — the page is exercised through manual smoke
  tests). No existing tests break.
- Manual: pick a capture device on the preview page →
  page renders with the warm ivory document surface + teal
  accents + small-caps " Preview" kicker + serif "Preview &
  setup" h1 + status pill next to "Capture device" + teal
  primary Continue-to-recording button + mono timestamp
  badge on the video frame.

## Out of scope

- Adding a streaming protocol indicator (RTMP / RTSP /
  WebRTC) — out of scope for a quick task.
- Refactoring the `useVideoPreview` hook internals — the
  preview hook handles its own start/stop lifecycle; no
  changes needed.
- Device picker `Select` component internals — the shadcn
  `Select` keeps its default chrome; only the wrapper +
  label get the new tokens.
- The "Continue to recording" disabled state when the
  doctor hasn't picked a device — already wired; just
  inherit the new button chrome.