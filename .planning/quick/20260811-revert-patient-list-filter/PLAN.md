---
slug: revert-patient-list-filter
created: 2026-08-11
type: refactor
source: ad-hoc user request
---

# Quick Task: Revert Patient List Filter Sidebar + Move Procedures to Separate UI

## What

Roll back Phase 7 plan 07-02's PatientList filter sidebar AND its accordion expansion. Move patient procedures into a separate page accessed via a "View Procedures" item in the existing patient actions DropdownMenu.

## Scope (smallest working diff)

1. **PatientsList.tsx** — revert to the Phase 3 layout (table only, search/MRN keep debounce-refetch, no doctor/date/status filters, no Apply/Clear buttons, no filter Card in left rail).
2. **PatientRow.tsx** — remove accordion expansion entirely:
   - Drop props: `expanded`, `onToggleExpand`, `procedures`, `reportsByProcedure`, `onOpenProcedure`, `onOpenReport`.
   - Drop the toggle button (left chevron column).
   - Drop the expansion `<tr>` with the procedure/report list.
   - Add a new DropdownMenuItem "View Procedures" that navigates to `{ name: 'patient-procedures', patientId: patient.id }`.
3. **router.ts** — add `{ name: 'patient-procedures', patientId: string }` Route variant.
4. **App.tsx** — handle `case 'patient-procedures'` → render `<PatientProcedures patientId={route.patientId} />`.
5. **New file `src/renderer/src/pages/PatientProcedures.tsx`** — page that:
   - Calls `window.api.patients.get({id})` for the patient header (name + MRN + DOB + gender).
   - Calls `window.api.procedures.list({ patientId, pageSize: 200 })` for the procedures list (use existing API).
   - For each procedure, calls `window.api.reports.getByProcedure({procedureId})` (existing from plan 07-02).
   - Renders each procedure row with: started date, status badge, duration, and "Open procedure" button (navigates to `procedure-review`) + report status chip + "Open PDF" button (calls `window.api.reports.openPdf`).
   - Back button → navigate({name:'patients'}).
6. **patients-list.test.tsx** — drop test cases that exercise filter sidebar / Apply / Clear / accordion expansion. Keep tests for: search by name, search by MRN, pagination, delete confirm, restore.
7. **settings-sidebar.test.tsx** — keep as-is (Phase 7 sidebar Audit + Backup entries are not affected by this revert).

## Non-scope (do NOT touch)

- Main-side `patientRepo.list` filter extensions (dateFrom/dateTo/doctorId/procedureStatus) — leave in place; renderer just doesn't call them from PatientsList. They may be reused in Phase 8+.
- SettingsSidebar Audit + Backup & Restore entries (Phase 7 plan 07-02 Task 2) — keep, they're independent of this revert.
- Phase 6 doctor profile, reports, Audit page, BackupRestore page, i18n, AR PDF — none of these are affected.

## Acceptance

- `npm run typecheck` passes
- `npm run test:unit -- tests/renderer/pages/patients-list.test.tsx` passes
- `npm run test:unit -- tests/renderer/pages/PatientProcedures.test.tsx` passes (new file, ≥3 cases)
- PatientsList renders as a single Card with table + pagination (Phase 3 layout)
- PatientRow dropdown has "Open Procedure Preview", "View Procedures", "Edit", "Delete/Restore" items
- PatientProcedures page lists the patient's procedures with navigation + report controls

## Reference files

- `src/renderer/src/pages/PatientsList.tsx` (current — has filter sidebar)
- `src/renderer/src/components/PatientRow.tsx` (current — has accordion expansion + dropdown)
- `src/renderer/src/lib/router.ts` (Route union)
- `src/renderer/src/App.tsx` (route handling)
- `src/renderer/src/lib/format.ts` (existing `formatProcedureDate`)
- `tests/renderer/pages/patients-list.test.tsx` (drop filter/accordion cases)
- `tests/renderer/setup.ts` (MockApi — ensure patient-procedures mocks are wired)

## Style

Ponytail mode — smallest working diff, stdlib first, no new abstractions. Reuse existing patterns:
- DropdownMenu item pattern from Phase 3 PatientRow
- Procedure row layout mirrors the old accordion expansion layout (clean, 1 row per procedure + report sub-row)
- Page-level fetch via the existing `useProcedures` SWR-style hook (from Phase 5) OR plain `useEffect` if no hook fits