---
slug: patients-list-polish
created: 2026-08-11
type: ui-polish
source: ad-hoc user request
---

# Quick Task: PatientsList — UI Polish

## What

Polish the PatientsList page (`src/renderer/src/pages/PatientsList.tsx`) — refined visual density, sticky table header, skeleton loading, active filter chips, refined empty state with "Add your first patient" CTA, better pagination footer.

The page is functional (search by name + MRN exact + show-deleted toggle + pagination + soft-delete + restore) but the layout is dated — wide header with both buttons stacked, separate search Card + results Card, no hover states, no filter chips, plain "Loading..." text.

## Scope (smallest working diff)

### 1. `src/renderer/src/pages/PatientsList.tsx` — UI polish

**Header restructure:**
- Add a small "Patients" kicker above the title (`text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground`)
- Title → `text-2xl font-semibold` (already there); subtitle → total count + active filter summary ("Showing N patients" or "No patients match")
- Right side: Settings as `variant="ghost"` + icon-only (just the gear, no text — saves horizontal space); New Patient as prominent `variant="default"` + `size="lg"` with Plus icon

**Search Card collapse:**
- Remove the outer Card wrapper. The search/mrn/show-deleted inputs become a single horizontal flex row above the table.
- New `<div className="flex items-center gap-3">` with:
  - Search input (with Search icon prefix, `className="pl-8"`)
  - MRN input
  - Show-deleted checkbox
- This matches Phase 7 RESEARCH.md Pattern 1 (single-row filter surface)

**Active filter chips:**
- Below the search row, when `search !== ''` or `mrn !== ''` is true, render removable chips: `[Search: "John" ×] [MRN: "12345" ×]`
- Clicking the × clears that filter (replaces search setSearch('') or setMrn(''))
- `data-testid="filter-chip-search"` + `data-testid="filter-chip-mrn"` for tests
- Empty state when no filters: render nothing (chips area is conditionally rendered)

**Results Card:**
- Sticky `<thead>` inside `max-h-[60vh] overflow-y-auto` container (matches PatientProcedures + Audit polish from prior quick tasks)
- `hover:bg-slate-50` on rows
- Skeleton loading: 3 grey `<tr>` rows with `animate-pulse` (no shadcn Skeleton install needed)
- Refined empty state when `rows.length === 0`:
  - Differentiate "no patients yet" vs "no patients match filters"
  - When `search === '' && mrn === '' && !includeDeleted`: render "No patients yet — click + New Patient to add your first." with a primary CTA button → navigate({name:'patient-new'})
  - When filters are non-empty: render "No patients match these filters. Try clearing them." (use existing i18n key if present)

**Pagination footer:**
- Replace "Page X of Y" with "Showing {start}-{end} of {total}" (range math: start = (page-1)*pageSize + 1, end = min(page*pageSize, total))
- Right side: Previous / Next buttons stay
- Refined spacing + total count visible
- `data-testid="pagination-range"` for tests

**PatientRow hover:**
- Already has hover via Phase 7-05's actions menu. Make sure it persists with the sticky thead.

### 2. `src/renderer/src/i18n/{en,ar}/translation.json`

Add new keys under `patient`:
- `pageKicker` — "Patients"
- `emptyFirst` — "No patients yet"
- `emptyFirstHint` — "Click + New Patient to add your first patient."
- `emptyFirstCta` — "Add your first patient"
- `emptyFilteredHint` — "Try clearing your filters or check the show-archived toggle."
- `filterChipRemove` — "Remove filter"
- `paginationRange` — "Showing {{start}}-{{end}} of {{total}}"
- `paginationRangeOne` — "Showing 1 of 1" (when total=1)

Reuse existing keys:
- `patient.pageTitle`, `patient.searchByName`, `patient.mrnExact`, `patient.showDeleted`, `patient.resultsEmpty`, `patient.total`, `patient.newPatient`, `patient.filtersResults`

AR mirrors per D-24 parity.

### 3. `tests/renderer/pages/patients-list.test.tsx` — add new cases

Existing test file (no recent changes since the 07-02 revert). Add 6 new cases:

1. **Header kicker renders** — assert the "PATIENTS" kicker text is present.
2. **Active filter chip appears for search** — type "John" → assert chip with `data-testid="filter-chip-search"` mounts containing "John"; click the chip → assert search cleared.
3. **Active filter chip appears for MRN** — type "12345" → assert chip with `data-testid="filter-chip-mrn"` mounts.
4. **Empty state first patient CTA** — mock `patients.list.mockResolvedValue({rows: [], total: 0})` → assert "No patients yet" + "Add your first patient" button render; click button → assert navigate({name: 'patient-new'}).
5. **Empty state filtered message** — type "John" → mock returns empty → assert "Try clearing your filters" message renders.
6. **Pagination range format** — mock with `{rows: [P1, P2], total: 50, page: 1, pageSize: 25}` → assert "Showing 1-25 of 50" renders.
7. **Sticky thead** — render with 100 rows (mock) → assert the thead has `sticky top-0 bg-card` class. (Skip if too brittle; the visual is the actual deliverable.)

### 4. No main-side changes

- `src/main/db/patients.ts` — no changes
- IPC contract — no changes
- `PatientRow.tsx` — no changes (already updated in previous quick tasks)

## Non-scope (do NOT touch)

- The patientRepo filter extensions (dateFrom/dateTo/doctorId/procedureStatus) added in Phase 7 plan 07-01 — kept in DB layer, not exposed on this page.
- SettingsSidebar on this page — PatientsList is NOT a settings page; no sidebar.
- The `patientRepo.list` call shape — no changes.
- Sort by column header (not in scope; would need IPC contract changes).
- Density toggle (compact/comfortable) — Phase 8 hardening candidate.

## Acceptance

- `npm run typecheck` clean (node + web)
- `npm run test:unit -- tests/renderer/pages/patients-list.test.tsx tests/renderer/i18n/parity.test.ts` passes
- `npm run test:unit` — full suite green (no new failures beyond the 9 pre-existing baseline)
- D-24 parity test passes

## Style

Ponytail — reuse existing patterns:
- Sticky thead: same `max-h-[60vh] overflow-y-auto` + `sticky top-0 bg-card` pattern as PatientProcedures + Audit pages
- Skeleton: 3 grey `<tr>` with `animate-pulse` divs inside each cell (no shadcn Skeleton install)
- Filter chips: shadcn `<Badge variant="secondary">` with a `<button>` inside for the × icon (no new component)
- Search icon: lucide `Search` already imported
- Empty state: `lucide-react` `UserPlus` icon next to "Add your first patient" CTA (no new dep)