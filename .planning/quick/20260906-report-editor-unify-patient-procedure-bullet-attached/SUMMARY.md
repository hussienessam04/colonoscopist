---
slug: report-editor-unify-patient-procedure-bullet-attached
status: complete
---

# Quick Task Summary: report-editor-unify-patient-procedure-bullet-attached

## Outcome

Three polish fixes in `00c6416`:

1. **Patient row unified with Procedure.** Both now use the same
   meta-row treatment (small-caps label above, value below;
   MRN/DOB use `font-mono` for the data feel). The Patient
   section is now a 4-col grid (`grid-cols-2 md:grid-cols-4`)
   matching the Procedure 3-col meta row.
2. **Bullet button enhanced.** Was a small outline button with
   `• Bullet` text; now a 28×28 icon-only round button anchored
   in the textarea's bottom-right, using a `List` icon from
   lucide-react. Teal hover state matches the clinical palette.
   Tooltip on hover carries the hint copy (no inline hint line
   needed).
3. **Attached screenshot reads as "chosen".** Border changes
   from `border-blue-500` to the teal accent (`#0E3A47`);
   thumbnail gets a soft teal-tint background (`#E6EFF1/40`) +
   subtle shadow so it visually pops above the rail. A small
   uppercase "ATTACHED" badge sits at the top-right corner so
   the doctor can scan a long timeline and immediately see
   what's chosen. The bottom-left toggle button recolored to
   teal to match.

## Diff

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Patient section restructured to a 4-col grid with
    small-caps labels + values (mono for MRN/DOB).
  - Bullet button: small outline button → icon-only round
    button (`List` icon, lucide), teal hover, tooltip carries
    the hint copy.
  - `pb-7` → `pb-9` on textarea so the round button doesn't
    overlap the last line of text.
- `src/renderer/src/components/ScreenshotTimeline.tsx`:
  - Added `useTranslation` for the new "ATTACHED" badge label.
  - Attached state: border → teal, thumbnail gets soft teal
    tint background + subtle shadow.
  - Top-right "ATTACHED" badge (uppercase, tracking-wider,
    teal background, white text) surfaces when isAttached.
  - Toggle button recolored teal.
  - Move ‹ › buttons moved from top-right (which would overlap
    the badge) to bottom-right.

## Verification

- 25/25 tests pass (10 report-editor + 15 ScreenshotTimeline).
- `npm run typecheck` (both node + web) → exits 0.

## Notes

- The bullet button is now icon-only — the existing test still
  finds it via `data-testid="report-editor-bullet-{scope}"`.
  The hint copy lives in the `title` attr, so hover surfaces
  the explanation without inline noise.
- The "ATTACHED" badge sits at the top-right; the move buttons
  were moved to the bottom-right so the two don't overlap.
  The attached thumbnail is still reorderable via the ‹ ›
  buttons; the doctor never lost any affordance.
- The Patient row uses `font-mono` for the values that ARE
  codes / dates (MRN, DOB) — matches the Procedure row's
  treatment for Date + Duration. The Name + Gender fields use
  the default sans (they're free-form text).
