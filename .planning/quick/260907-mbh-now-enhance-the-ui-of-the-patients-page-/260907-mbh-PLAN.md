---
task: patients-pages-clinical-palette
task_count: 2
mode: quick
type: execute
files_modified:
  - src/renderer/src/pages/PatientsList.tsx
  - src/renderer/src/pages/PatientProcedures.tsx
  - src/renderer/src/components/PatientRow.tsx
  - src/renderer/src/components/EmptyStateCard.tsx
  - src/renderer/src/components/PageSizeSelector.tsx
autonomous: true
---

<objective>
Apply the clinical-workstation palette (warm ivory + teal accents from the ReportEditor) to the Patients List page and Patient Procedures page so the entire app reads as one product. Same palette we just applied to the Settings pages in quick task 260907-l00 — only the page chrome and table/card surfaces change. No functional changes, no testid breaks.

Output: PatientsList + PatientProcedures sit on warm ivory `#F7F1E6`, use ivory card surfaces `#FBF7EE` with `#E0D9C6` hairline borders, teal `#0E3A47` primary CTAs, sage `#A8C5B5` hover on inputs, and small-caps `#8C8478` page kicker. Mirrors the SettingsLayout pattern.
</objective>

<context>
@.planning/PROJECT.md
@AGENTS.md
@src/renderer/src/pages/ReportEditor.tsx (canonical palette reference — FIELD_CLASS on line 75-76)
@src/renderer/src/components/SettingsLayout.tsx (just-applied palette — see main bg + header kicker pattern)
@src/renderer/src/components/SettingsSidebar.tsx (active teal treatment)
@src/renderer/src/pages/PatientsList.tsx (currently bg-slate-50 main + bg-card table thead + bg-slate-50 hover rows)
@src/renderer/src/pages/PatientProcedures.tsx (currently bg-slate-50 main + bg-card thead + bg-primary/10 avatar)
@src/renderer/src/components/PatientRow.tsx
@src/renderer/src/components/EmptyStateCard.tsx
@src/renderer/src/components/PageSizeSelector.tsx
@tests/renderer/pages/patients-list.test.tsx (must still pass — including the "Showing 1-25 of 50" footer test)
@tests/renderer/pages/PatientProcedures.test.tsx (must still pass)
@tests/renderer/components/patient-row.test.tsx (must still pass)
</context>

<design_tokens>
Reuse the tokens from quick task 260907-l00 (settings palette) verbatim:

- bg-clinic `#F7F1E6`, bg-panel `#FBF7EE`, bg-panel-strong `#EFEAE0`
- ink-primary `#13202E`, ink-secondary `#5C6770`, ink-muted `#8C8478`
- border-hairline `#E0D9C6`, border-hover-sage `#A8C5B5`
- accent-teal `#0E3A47`, accent-teal-dark `#0B2C36`
- bg-hover-teal `#E6EFF1`
- soft shadow `0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)`

Field treatment (matches FIELD_CLASS from ReportEditor.tsx:75-76):
`bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30`

Page kicker (matches SettingsLayout header):
`text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C8478]`

Card surface (matches SettingsLayout card):
`border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]`

Primary CTA:
`bg-[#0E3A47] text-white hover:bg-[#0B2C36] disabled:bg-[#E0D9C6] disabled:text-[#8C8478]`

Outline button on ivory surface (matches ReportEditor buttons):
`border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]`
</design_tokens>

<must_haves>
- Both pages sit on `<main className="min-h-screen bg-[#F7F1E6] p-6 font-sans text-[#13202E]">`.
- Page header kicker uses small-caps treatment (uppercase, tracking, `#8C8478`); h1 is `text-2xl font-medium tracking-tight text-[#13202E]`; header sits above a `border-b border-[#E0D9C6]` rule.
- Primary CTAs (`+ New Patient`, `+ New Procedure`) use deep teal.
- All `<Card>` surfaces get the ivory treatment (`border-[#E0D9C6] bg-[#FBF7EE]` + soft shadow).
- Table thead `bg-card` → `bg-[#FBF7EE]` so sticky thead matches parent Card surface.
- `hover:bg-slate-50` rows → `hover:bg-[#E6EFF1]` (light teal).
- Skeleton `bg-slate-200` → `bg-[#E0D9C6]/60`.
- All `<Input>` and `<SelectTrigger>` get the FIELD_CLASS treatment (ivory bg, sage hover, teal focus).
- `text-muted-foreground` on these pages → `text-[#5C6770]`.
- Filter chip × button hover `hover:bg-slate-200/60` → `hover:bg-[#E0D9C6]/60`.
- Outline buttons (Previous/Next/Back/Clear/Open PDF) use the teal hover treatment.
- Avatar in PatientProcedures header: `bg-primary/10 text-primary` → `bg-[#E6EFF1] text-[#0E3A47]` (matches signature teal accent).
- Status badges keep their semantic colors: `bg-emerald-100`, `bg-amber-100`, `bg-blue-100`, `bg-red-100`, `bg-slate-100` — color encodes procedure/report status, not brand.
- Deleted patient badge keeps `bg-destructive` — semantic.
- All existing data-testids preserved (no additions, no removals).
- No new files. No i18n key changes. No backend changes.
- Typecheck + lint + 3 affected test suites (patients-list, PatientProcedures, patient-row) all pass.
</must_haves>

<tasks>

<task type="auto">
  <name>Task 1: PatientsList page + PatientRow + EmptyStateCard + PageSizeSelector</name>

<files>
- src/renderer/src/pages/PatientsList.tsx
- src/renderer/src/components/PatientRow.tsx
- src/renderer/src/components/EmptyStateCard.tsx
- src/renderer/src/components/PageSizeSelector.tsx
</files>

<action>

### PatientsList.tsx

Apply the palette in place, merging (not replacing) every className.

1. `<main>` wrapper (line 155):
   ```tsx
   <main className="min-h-screen bg-[#F7F1E6] p-6 font-sans text-[#13202E]">
   ```

2. Header (line 156-191):
   - Wrap with `className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E0D9C6] pb-4"`.
   - Kicker: `text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground` -> `text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C8478]`.
   - h1: `text-2xl font-semibold` -> `text-2xl font-medium tracking-tight text-[#13202E]`.
   - Subtitle line: `text-sm text-muted-foreground` -> `text-sm text-[#5C6770]`.

3. Primary CTA (`+ New Patient`, line 184): add `className="bg-[#0E3A47] text-white hover:bg-[#0B2C36]"`.

4. Ghost Settings icon (line 173-182): no change.

5. Filter row Inputs (line 202-228):
   - Search input (`filter-search`): add `className="pl-8 bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"`.
   - MRN input (`filter-mrn`): same className minus `pl-8`.

6. Show-deleted checkbox label (line 241): `text-sm whitespace-nowrap` -> `text-sm whitespace-nowrap text-[#13202E]`.

7. Filter chips (line 257-294): Badge stays (shadcn secondary). The × button hover: `hover:bg-slate-200/60` -> `hover:bg-[#E0D9C6]/60`.

8. Patients Card (line 299-375):
   - `<Card>` -> `<Card className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">`.
   - Sticky thead bg `bg-card` (line 303) -> `bg-[#FBF7EE]`.
   - Each `<th className="px-3 py-2 bg-card">` -> `<th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">`.
   - Skeleton row `bg-slate-200` -> `bg-[#E0D9C6]/60`.
   - Empty state cell `text-sm text-muted-foreground` -> `text-sm text-[#5C6770]`.
   - Empty-state CTA button (line 346-354): add `className="bg-[#0E3A47] text-white hover:bg-[#0B2C36]"`.
   - Scrollable table container `rounded-md` -> drop `rounded-md` (parent Card already rounds). Add `border border-[#E0D9C6]` so the scroll region has a visible frame.

9. Pagination footer (line 377-408):
   - Range span `text-muted-foreground` -> `text-[#5C6770]`.
   - Previous/Next buttons: add `className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"` to each.

### PatientRow.tsx

1. Secondary text (DOB / Gender / MRN / Phone cells, lines 57-60): `text-muted-foreground` -> `text-[#5C6770]`.
2. Row separator (line 44): `border-b last:border-b-0` -> `border-b border-[#E0D9C6] last:border-b-0`.
3. Row hover (line 43-46): add `hover:bg-[#E6EFF1]` to the `<tr>`.
4. Deleted badge (line 51-53): keep `bg-destructive text-destructive-foreground`.
5. DropdownMenu items (lines 73-110): leave default.

### EmptyStateCard.tsx

1. Description text (line 22-23): `text-muted-foreground` -> `text-[#5C6770]`.
2. Open License settings button (line 25-32): add `className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"`.

### PageSizeSelector.tsx

1. SelectTrigger (line 20): add `className="w-32 bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"`. Existing `w-32` stays.

Commit all 4 files atomically as ONE commit. No new files. No testid changes. No i18n changes.
</action>

<verify>
- `grep -n "bg-slate-50\|bg-slate-200" src/renderer/src/pages/PatientsList.tsx src/renderer/src/components/PatientRow.tsx` returns 0 matches.
- `grep -n "text-muted-foreground" src/renderer/src/pages/PatientsList.tsx src/renderer/src/components/PatientRow.tsx src/renderer/src/components/EmptyStateCard.tsx src/renderer/src/components/PageSizeSelector.tsx` returns 0 matches.
- All data-testids preserved.
- `npm run lint --quiet` exits 0.
- `npm run typecheck` (node + web) exits 0.
- `tests/renderer/pages/patients-list.test.tsx` 15/15 pass.
- `tests/renderer/components/patient-row.test.tsx` all tests pass.
</verify>

<done>
- PatientsList + helpers sit on the clinical-workstation palette.
</done>
</task>

<task type="auto">
  <name>Task 2: PatientProcedures page</name>

<files>
- src/renderer/src/pages/PatientProcedures.tsx
</files>

<action>

### PatientProcedures.tsx

1. `<main>` wrapper (line 251):
   ```tsx
   <main className="min-h-screen bg-[#F7F1E6] p-6 font-sans text-[#13202E]">
   ```

2. Header (line 252-281):
   - Wrap with `className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E0D9C6] pb-4"`.
   - Kicker -> `text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C8478]`.
   - h1 -> `text-2xl font-medium tracking-tight text-[#13202E]`.
   - Back button (line 261-268): add outline teal className.
   - New Procedure button (line 269-279): add primary teal className.

3. Patient header Card (line 287-322):
   - `<Card data-testid="patient-procedures-header">` -> merge className (preserve the data-testid).
   - Avatar (line 289-295): `bg-primary/10 text-primary` -> `bg-[#E6EFF1] text-[#0E3A47]`.
   - Patient meta line: `text-muted-foreground` -> `text-[#5C6770]`. `<span font-medium text-foreground>` stays.

4. Filter Card (line 324-411):
   - `<Card>` -> merge className.
   - Search input: add FIELD_CLASS with `pl-8`.
   - Date inputs: ivory + teal focus treatment.
   - Status Popover trigger: ivory outline teal hover.
   - Clear button: outline teal hover.
   - Apply button: primary teal.

5. Procedures Card (line 413-546):
   - `<Card>` -> merge className.
   - Sticky thead `bg-card` -> `bg-[#FBF7EE]`.
   - Each `<th>` -> add `bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]`.
   - Skeleton `bg-slate-200` -> `bg-[#E0D9C6]/60`.
   - Empty state cell `text-muted-foreground` -> `text-[#5C6770]`.
   - Hover rows: `hover:bg-slate-50` -> `hover:bg-[#E6EFF1]`. Row border -> `border-[#E0D9C6]`.
   - Status badges: KEEP semantic colors via `statusBadgeClass()`.
   - Duration / no-report secondary text -> `text-[#5C6770]`.
   - Report status badge: KEEP semantic colors (emerald finalized / slate draft).
   - Open Procedure / Open PDF ghost buttons: outline teal hover treatment.

6. Pagination footer (added in 260907-lk4):
   - Range span -> `text-[#5C6770]`.
   - Previous/Next buttons: outline teal hover.

Commit atomically with Task 1 in ONE commit.
</action>

<verify>
- `grep -n "bg-slate-50\|bg-slate-200\|bg-primary/10\|bg-background" src/renderer/src/pages/PatientProcedures.tsx` returns 0 matches.
- `grep -n "text-muted-foreground" src/renderer/src/pages/PatientProcedures.tsx` returns 0 matches.
- All data-testids preserved.
- `npm run lint --quiet` exits 0.
- `npm run typecheck` (node + web) exits 0.
- `tests/renderer/pages/PatientProcedures.test.tsx` 13/13 pass.
</verify>

<done>
- PatientProcedures reads as a clinical chart on the warm ivory desk.
</done>
</task>

</tasks>
