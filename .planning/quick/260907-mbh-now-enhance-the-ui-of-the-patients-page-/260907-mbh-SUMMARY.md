---
task: patients-pages-clinical-palette
status: complete
date: 2026-09-07
commit: d8ec130
files_modified:
  - src/renderer/src/pages/PatientsList.tsx
  - src/renderer/src/pages/PatientProcedures.tsx
  - src/renderer/src/components/PatientRow.tsx
  - src/renderer/src/components/EmptyStateCard.tsx
  - src/renderer/src/components/PageSizeSelector.tsx
key_decisions:
  - Reused the Settings palette (warm ivory #F7F1E6 main / #FBF7EE card /
    #E0D9C6 hairline / #0E3A47 teal CTA) verbatim from quick task 260907-l00 —
    no new design tokens introduced.
  - Field treatment unified across both pages: Input / SelectTrigger / native
    date inputs all use the ivory bg + sage hover + teal focus ring pattern
    from ReportEditor FIELD_CLASS (lines 75-76).
  - Kept semantic badge colors (emerald/amber/blue/red for procedure status,
    bg-destructive for the 'Deleted' patient badge, emerald finalized / slate
    draft for report status) — color encodes domain meaning, not brand.
  - Removed `rounded-md` from the inner scrollable table container; parent
    Card already rounds the corner and adding `border border-[#E0D9C6]` gives
    the scroll region a visible frame.
  - Updated the file-header comments in PatientsList.tsx and
    PatientProcedures.tsx to reference the new `hover:bg-[#E6EFF1]` so the
    header still describes what the code actually does.
---

# Phase quick-260907-mbh: Patients pages clinical palette — Summary

## What changed

Five files received the clinical-workstation palette treatment: warm ivory
main background (#F7F1E6), ivory card surfaces (#FBF7EE) with hairline
borders (#E0D9C6) and the soft clinical shadow, deep-teal primary CTAs
(#0E3A47 → #0B2C36 on hover), and a unified input treatment (ivory bg, sage
hover border #A8C5B5, teal focus ring) that matches the ReportEditor's
FIELD_CLASS. Table thead now matches its parent Card surface so the sticky
row reads as a single ivory panel; hover rows shifted from slate-50 to a
light teal (#E6EFF1); skeleton rows from slate-200 to a faint hairline
(#E0D9C6/60). Status badges (procedure status, report status, deleted
patient) keep their semantic colors — the palette change is chrome-only.

## Test verification

- `npm run typecheck` — clean (both `tsc --noEmit -p tsconfig.node.json` and
  `tsc --noEmit -p tsconfig.web.json` exit 0).
- `npm run test:unit -- --run tests/renderer/pages/patients-list.test.tsx
  tests/renderer/pages/PatientProcedures.test.tsx
  tests/renderer/components/patient-row.test.tsx` — 30/30 pass
  (patient-row 2/2, PatientProcedures 13/13, PatientsList 15/15).
- `findstr "text-muted-foreground"` across all 5 modified files — 0 matches.
- `findstr "bg-slate-50 bg-slate-200"` across PatientsList.tsx + PatientRow.tsx
  — 0 matches.
- `findstr "bg-slate-50 bg-slate-200 bg-primary/10 bg-background"` across
  PatientProcedures.tsx — 0 matches.
- All `data-testid` attributes preserved verbatim — verified by spot-reads of
  both pages and the three components.

## Deviations from Plan

None — the plan executed exactly as written. No functional changes, no
testid additions/removals, no i18n changes, no backend changes, no new
files. Only the file-header comments were updated to match the new
`hover:bg-[#E6EFF1]` token (the plan's "Range span → text-[#5C6770]" etc.
swaps are present; the comment-vs-code consistency is a lazy senior-dev
touch-up, not a deviation).