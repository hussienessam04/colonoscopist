---
slug: report-editor-unify-patient-procedure-bullet-attached
created: 2026-09-06
type: polish
source: ad-hoc user report (3 issues)
---

# Quick Task: unify Patient/Procedure rows + enhance bullet button + attached screenshot treatment

## Issues

1. **Patient + Procedure rows look different.** Patient renders
   each field as inline text (`Name: ahmed  MRN: MRN-000001  …`).
   Procedure renders the meta-row with small-caps label + value
   pairs in a 3-column grid. Visually inconsistent — same
   "metadata" family, two different shapes.
2. **Bullet button inside the box looks weak.** Currently a small
   outline button at the bottom-right with text "• Bullet" on a
   white background. Make it more prominent — icon-only, anchored
   cleanly, with a stronger teal hover state.
3. **Attached screenshot doesn't look "chosen" enough.** Currently
   the attached state shows a 2px blue-500 border + a small blue
   toggle in the bottom-left. The thumbnail itself looks the
   same as an un-attached one. Make attached screenshots
   visually distinct: teal accent border (matching the clinical
   palette), soft teal-tinted background on the thumbnail, a
   small "✓" badge at the top-right corner so the doctor can
   scan a long timeline and immediately see what's attached.

## Scope

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Patient row → 4-column meta-row (`grid grid-cols-2
    gap-x-6 gap-y-2 md:grid-cols-4`) matching the Procedure
    meta-row treatment (small-caps label above, mono value
    below).
  - Bullet button → icon-only `List` icon from lucide-react,
    teal hover state, anchored inside the textarea's bottom-right.
- `src/renderer/src/components/ScreenshotTimeline.tsx`:
  - Attached state: border → teal (`#0E3A47`), thumbnail gets a
    soft teal tint background, top-right corner shows a small
    "✓" badge. Keep the existing bottom-left toggle button
    (the doctor still toggles from there) but recolor to teal
    when attached.

## Verification

- Existing tests should still pass (data-testids unchanged).
- Manual: attach 2 screenshots, verify the visual difference is
  immediately obvious in the timeline.

## Out of scope

- Reordering UI redesign (the move ‹ › buttons stay).
- Drag-to-reorder (out of scope per Phase 6 UAT G-06-8).
