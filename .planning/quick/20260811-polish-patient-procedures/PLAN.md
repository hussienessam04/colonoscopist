---
slug: polish-patient-procedures
created: 2026-08-11
type: ui-polish
source: ad-hoc user request
---

# Quick Task: Polish PatientProcedures UI + Add Filters + New Procedure Button

## What

Three improvements to `src/renderer/src/pages/PatientProcedures.tsx`:
1. **UI polish** — better visual density, sticky table header, hover-row highlight, refined spacing, action buttons styled as ghost+icon, status badges with semantic color tokens, patient header gets avatar/initials, refined empty/loading states.
2. **Filtration system** — date range (From/To), procedure status multi-select (Completed/Partial/Recording/Crashed), text search input. Apply + Clear buttons. Mirrors the Patient List filter UX but kept compact (single-row layout).
3. **New Procedure button** — in the header next to the Back button. Navigates to `{ name: 'procedure-preview', patientId }` — uses the existing `Open Procedure Preview` route from Phase 3-05.

## Scope (smallest working diff)

### 1. `src/renderer/src/pages/PatientProcedures.tsx` (rewrite)

Layout:
```
┌────────────────────────────────────────────────────────────────────────────┐
│ PROCEDURES                                          [Back] [+ New Procedure] │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Patient Card ─────────────────────────────────────────────────────────┐ │
│ │  [AB]  John Doe                          MRN: 12345  DOB: 1980-01-01  M │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ ┌─ Filter Card (collapsible on scroll) ───────────────────────────────────┐ │
│ │ [🔍 Search...] [From ▾] [To ▾] [Status ▾] [Clear] [Apply]               │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ ┌─ Procedures Table ──────────────────────────────────────────────────────┐ │
│ │  Date         Status       Duration  Report         Actions             │ │
│ │  ─────────────────────────────────────────────────────────────────────  │ │
│ │  2026-08-10   ● Completed  5 min     ● Finalized   [Open] [PDF]         │ │
│ │  2026-08-09   ● Partial    3 min     ○ Draft       [Open] [PDF]         │ │
│ │  ...                                                                    │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Polish details:
- **Patient header Card**: avatar circle with initials (first letter of first + last name), name in text-lg font-semibold, MRN/DOB/gender as muted small text with labels.
- **Filter Card**: shadcn Input for search, two `<input type="date">` for From/To (native, no library), status as a shadcn `<Select multiple>` (or 3 stacked `<Checkbox>` if Select multi is awkward). Apply + Clear buttons aligned right.
- **Table**: sticky `thead`, hover:bg-slate-50 on rows, status badge color tokens (completed=green/default, partial=yellow/secondary, recording=blue, crashed=red/destructive), action buttons as `variant="ghost"` with icons.
- **Empty state**: differentiated copy for "no procedures yet" vs "no procedures match filters".
- **Loading state**: skeleton rows (3 greyed-out rows) instead of plain text.
- **Sticky table header** within a scrollable container capped at `max-h-[60vh]`.

Filter logic:
- `search` filters by `procedure.id` substring OR `formatProcedureDate(procedure.startedAt)` substring (date string match).
- `dateFrom`/`dateTo` filters by `procedure.startedAt` >= fromMs AND <= toMs+86_400_000 (inclusive end per Phase 7 D-02 pattern).
- `status` array — multi-select across `['completed', 'partial', 'recording', 'crashed']`. Empty array = no constraint.
- Filters are LOCAL state — no IPC, no main-side extension. The 200-row fetch is enough to filter client-side.
- Apply button commits pending → applied. Clear button resets to defaults + refilters.
- Match the Phase 7 PatientList filter UX: Apply button is the commit; typing alone does NOT filter (avoid mid-type flicker).

### 2. `src/renderer/src/i18n/{en,ar}/translation.json`

Add new keys under `patientProcedures`:
- `newProcedure` — "+ New Procedure"
- `newProcedureTooltip` — "Start a new procedure for this patient"
- `searchPlaceholder` — "Search procedures..."
- `clearFilters` — "Clear" (short button label)
- `applyFilters` — "Apply"
- `noMatchFilters` — "No procedures match these filters."
- `clearFiltersHint` — "Try clearing filters or adjusting the date range."
- `avatarInitials` (computed, no translation needed)
- `statusAll` — "All statuses"

Reuse existing keys:
- `patientProcedures.columnStarted` / `columnStatus` / `columnDuration` / `columnReport` / `columnActions` (already exist)
- `patientProcedures.openProcedure` / `openPdf` (already exist)
- `patientProcedures.loadingProcedures` / `proceduresEmpty` (already exist)
- `patientProcedures.pageKicker` / `pageTitle` / `backToList` (already exist)
- `patientProcedures.minutesShort` (already exists — used for duration formatting)
- `patientProcedures.noReport` (already exists)
- `patient.reportStatusFinalized` / `reportStatusDraft` (already exist)

AR bundle must mirror every new key per D-24 parity.

### 3. `tests/renderer/pages/PatientProcedures.test.tsx` (extend)

Add cases:
1. **Filters: text search** — type "2026" in search → only matching procedures show
2. **Filters: status multi-select** — pick "Completed" → only completed procedures show
3. **Filters: Apply commits + Clear resets** — change filter → click Apply → refiltered; click Clear → all back
4. **New Procedure button** — click → navigates to `{ name: 'procedure-preview', patientId }`
5. **Empty state for filtered-out** — apply filter that matches nothing → "no procedures match these filters" empty state
6. **Date range filter** — set From/To → only procedures in range show

Existing 3 tests (header, navigate procedure, open PDF) stay green.

### 4. `tests/renderer/setup.ts` (no changes expected)

The MockApi already has `procedures.list` + `patients.get` + `reports.getByProcedure` wired.

## Non-scope (do NOT touch)

- The main-side `proceduresRepo.list` filters — keep as-is. Client-side filtering only.
- `src/renderer/src/components/PatientRow.tsx` — no changes. The dropdown already has "Open Procedure Preview" + "View procedures" (added in previous quick task).
- Router — `procedure-preview` route already exists (Phase 3-05).
- `src/renderer/src/pages/PatientsList.tsx` — no changes.

## Acceptance

- `npm run typecheck` clean
- `npm run test:unit -- tests/renderer/pages/PatientProcedures.test.tsx` passes (≥9 cases total — 3 existing + 6 new)
- All 18+ existing PatientProcedures tests still pass (after the additions)
- No regressions in patients-list / BackupRestore / Audit tests
- `D-24 parity` test passes — every new EN key has a matching AR key

## Style

Ponytail — reuse existing patterns:
- shadcn `<Input>`, `<Select>`, `<Button>` from existing components/ui/* (no new installs)
- Native `<input type="date">` for date range (per Phase 7 RESEARCH Pattern 1)
- Status colors via Tailwind utility classes (`bg-emerald-100 text-emerald-800` for completed, etc.) — NO new color tokens
- Avatar initials: derive `name.slice(0,2).toUpperCase()` (no avatar library)
- Skeleton: 3 grey `div` rows with `animate-pulse` Tailwind class (no shadcn Skeleton install needed)