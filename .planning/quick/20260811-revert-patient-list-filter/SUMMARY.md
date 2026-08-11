---
status: complete
task: 20260811-revert-patient-list-filter
created: 2026-08-11
completed: 2026-08-11
commits:
  - <commit hash TBD>
---

# Quick Task Summary — Revert Patient List Filter + New Patient Procedures Page

## What shipped

- **PatientsList reverted to Phase 3 layout** — table + search/MRN debounce + pagination only. Filter sidebar (5-dim AND-combined: date range, doctor, status + Apply/Clear) removed per user request.
- **PatientRow accordion removed** — the `expanded/onToggleExpand/procedures/reportsByProcedure/onOpenProcedure/onOpenReport` props dropped, the toggle chevron column dropped, the expansion `<tr>` dropped.
- **New DropdownMenu item "View procedures"** added to PatientRow's actions menu — navigates to `{ name: 'patient-procedures', patientId }`.
- **New page `src/renderer/src/pages/PatientProcedures.tsx`** — patient header (name + MRN + DOB + gender via `window.api.patients.get`) + procedures table (date + status badge + duration + Open procedure button + report status chip + Open PDF button per row). One-shot `useEffect` fetch — parallel `reports.getByProcedure` per procedure. Back button → PatientsList. i18n-wired.
- **Router** — new Route variant `{ name: 'patient-procedures', patientId: string }`.
- **App.tsx** — `case 'patient-procedures'` wires to the new page.
- **i18n** — new keys `patientProcedures.*` + `patient.minutesShort` + `patient.reportStatusFinalized`/`Draft` added to en + ar bundles.
- **tests** — `patients-list.test.tsx` filter/accordion test cases removed (search-by-name, search-by-MRN, pagination, delete confirm, restore retained). New `tests/renderer/pages/PatientProcedures.test.tsx` with ≥3 cases (renders patient header + procedures; navigates to procedure-review on click; invokes `reports.openPdf` on click).
- **`.gitignore`** — fixed malformed quoted patterns; added `data-restore-*/` + `full-test-output.txt`; untracked `tsconfig.{node,web}.tsbuildinfo` (they were tracked from earlier phases but are TypeScript incremental build cache, not source).

## Stats

- Files: 10 modified + 2 new + `.gitignore` repaired
- Net diff: +163 / -487 (significantly smaller after revert)
- Tests: 13/13 patients-list + PatientProcedures pass; 661/664 total (3 pre-existing PDF smoke failures from Phase 6 plan 06-03, unrelated to this task)
- Typecheck: node + web both clean

## Non-changes (deliberate scope)

- Main-side `patientRepo.list` + `proceduresRepo.list` filter extensions (dateFrom/dateTo/doctorId/procedureStatus) — kept in DB layer; renderer just stops calling them from PatientsList. May be reused in Phase 8+ for advanced search.
- SettingsSidebar Audit + Backup & Restore entries (Phase 7 plan 07-02 Task 2) — independent of this revert; kept.
- Audit page, BackupRestore page, ProfileEditor, ReportEditor, ProcedureRoom, ProcedureReview, i18n bundles, AR PDF — none affected.

## Deviations / Notes

- `.gitignore` had malformed quoted patterns (`"tsconfig.node.tsbuildinfo"` literal) that didn't actually match the root-level files. Fixed by removing quotes + untracking the previously-committed cache files. Existing AGENTS.md did not flag this; the .gitignore pattern style was inherited from Phase 1 scaffolding.
- `data-restore-1786439913614/` was a leftover staging dir from the BackupRestore test suite running with CWD = repo root. Cleanup happened in `tests/renderer/setup.ts` but a crash left one behind. Added `data-restore-*/` to .gitignore as defense-in-depth.
- `full-test-output.txt` was an agent debug artifact. Added to .gitignore.
- PatientProcedures page uses plain `useState + useEffect` instead of an SWR-style hook — no shared state between pages; one-shot fetch is the right shape here. Mirrors the useReport / useDoctorProfile one-shot pattern.