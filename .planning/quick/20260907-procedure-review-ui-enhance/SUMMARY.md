---
slug: procedure-review-ui-enhance
created: 2026-09-07
type: redesign
status: complete
---

# Summary: Procedure Review UI enhanced to match Report Editor style

## Outcome

`ProcedureReview.tsx` page chrome refactored to mirror the
Report Editor's "clinical workstation" palette + typography
+ control treatment:

- Outer `bg-slate-50` page + inner `bg-white` document card
  with `border-[#E0D9C6]` rule (matches the editor's outer
  card).
- Header band: small-caps kicker + serif h1 (Georgia stack)
  + patient name + mono tabular-nums date/duration +
  StatusBadge + Back-to-Patient slate outline button.
- Video card: rounded `bg-white` + hairline ivory border; the
  player frame keeps its `bg-slate-900` (Chromium native
  controls need the dark backdrop).
- Scrubber + ScreenshotTimeline grouped under a small-caps
  "Timeline" label inside the same left card (was separate
  cards before).
- Right rail: Notes + Trim wrapped in tinted teal cards
  `bg-[#E6EFF1]` + ivory border + small-caps teal section
  labels.
- Metadata card: mono tabular-nums for date / duration /
  patient values; small-caps field labels in sand `#8C8478`.
- Report CTA: primary teal button (`#0E3A47` bg + `#0B2C36`
  hover + `shadow-inner`) replaces the shadcn default.

No data flow changes, no IPC contract changes, no new
components — only the surrounding chrome + the button +
section-label tokens were refreshed. All `data-testid`
values unchanged.

## What changed

**`src/renderer/src/pages/ProcedureReview.tsx`**:

- File header comment updated to call out the chrome-only
  refactor.
- Inline design-token constants added at the top:
  - `CARD_CHROME` — `rounded-lg border border-[#E0D9C6] bg-white shadow-sm`
  - `RAIL_CARD_CHROME` — `rounded-lg border border-[#E0D9C6] bg-[#E6EFF1] p-4 shadow-sm`
  - `SMALL_CAPS_LABEL` — `text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]`
  - `SMALL_CAPS_FIELD` — `text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]`
  - `SECONDARY_OUTLINE_BUTTON` — slate border + bg-white +
    hover teal
  - `PRIMARY_TEAL_BUTTON` — `#0E3A47` bg + `#0B2C36` hover +
    `shadow-inner`
- Missing-procedure-id block: `bg-slate-100` → `bg-slate-50`.
- Header band: restructured into kicker + serif h1 (with
  patient name appended) + mono date/duration/status row +
  Back button on the right; bottom border `border-[#E0D9C6]`.
- Left column: wrapped in `CARD_CHROME` + `p-4`. Scrubber +
  ScreenshotTimeline grouped under a small-caps "Timeline"
  label.
- Video container: `rounded-md border border-[#E0D9C6] bg-slate-900`
  (was: `rounded-lg bg-slate-900`).
- Right rail: Notes + Trim wrapped in `RAIL_CARD_CHROME`
  cards with small-caps section labels ("Notes", "Trim").
- Metadata card: replaced the shadcn `Card` with a plain div
  using `CARD_CHROME`. Body is now a `grid grid-cols-1 gap-2`
  of small-caps field labels + mono tabular-nums values
  (Patient / Started / Ended / Duration).
- Report CTA card: replaced the shadcn `Card` + `variant=
  "default"` Button. Now `PRIMARY_TEAL_BUTTON` + small-caps
  label + mono PDF filename.

## Diff stat

```
src/renderer/src/pages/ProcedureReview.tsx | 320 +++++++++-----------
  (1 file changed, +194/-130)
```

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- `npx vitest run tests/renderer/pages/ProcedureReview.test.tsx`
  → 13/13 pass.
- `npx vitest run tests/renderer/pages/procedure-room-timer.test.tsx`
  → 20/20 pass (covers the ProcedureReview partial-status
  Alert + post-recording navigation tests).
- Manual: open a procedure with a finalized video → page
  renders with the warm ivory document surface + teal
  accents + small-caps labels + serif h1, all consistent
  with the Report Editor.

## Files

- `src/renderer/src/pages/ProcedureReview.tsx` — chrome
  refactor.
- `.planning/quick/20260907-procedure-review-ui-enhance/PLAN.md`
  — plan.
- `.planning/quick/20260907-procedure-review-ui-enhance/SUMMARY.md`
  — this file.

## Commit

`ffe2b11 feat(procedure-review): enhance UI to match Report Editor clinical-workstation style`