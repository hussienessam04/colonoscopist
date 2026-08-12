---
status: complete
task: change MRN in patients to auto serial num
date: 2026-08-12
commits:
  - c7534fe: feat(patients): auto-generate MRN as serial number
  - 95bdeec: feat(patients-ui): remove MRN input from PatientForm, display as read-only
files_modified:
  - src/main/db/migrations.ts
  - src/main/db/migrations/0008_auto_mrn.sql (NEW)
  - src/main/db/patients.ts
  - src/main/ipc/patients.ts
  - src/shared/validators.ts
  - src/shared/ipc-contract.ts
  - src/renderer/src/pages/PatientForm.tsx
  - src/renderer/src/components/PatientRow.tsx
  - src/renderer/src/pages/PatientProcedures.tsx
  - src/renderer/src/pages/ReportEditor.tsx
  - tests/main/db/patients.test.ts
  - tests/main/db/migrations/0008_auto_mrn.test.ts (NEW)
tests_added: 4 (3 contract-guard cases + 1 migration test, all gated by a fresh per-test mkdtempSync)
---

# Quick task 260812-kza: change MRN in patients to auto serial num

## What changed

MRN is now an auto-generated serial number (`MRN-000001`, `MRN-000002`, …) assigned at insert time. The renderer no longer offers an MRN input field on either Create or Edit; the Edit form surfaces the existing MRN as a read-only label.

## Two atomic commits

1. **`c7534fe feat(patients): auto-generate MRN as serial number`** — backend (DB + repo + validators + IPC + types).
2. **`95bdeec feat(patients-ui): remove MRN input from PatientForm, display as read-only`** — frontend (form + display surfaces + new tests).

## Task 1: Backend details

- **`src/main/db/migrations/0008_auto_mrn.sql` (NEW)** — backfills NULL mrn rows (`ROW_NUMBER() OVER (ORDER BY created_at, id)` formatted as `MRN-NNNNNN`), creates the `patient_mrn_counter` one-row counter table seeded above the max existing numeric suffix, drops the partial unique index, recreates it as a full unique index, and enforces `NOT NULL` via the SQLite 12-step table-rebuild recipe (SQLite 3.45 still lacks `ALTER COLUMN … SET NOT NULL`). `mrn GLOB 'MRN-[0-9]*'` keeps pre-existing non-numeric fixtures (`MRN-001` / `MRN-ABC`) preserved verbatim.
- **`src/main/db/patients.ts`** — adds the `nextMrn()` helper (read-then-bump of `patient_mrn_counter`, must run inside the caller's `db.transaction()`); drops `mrn` from `PatientCreateInput` / `PatientPatchInput`; removes the `SQLITE_CONSTRAINT_UNIQUE → IPC_VALIDATION { field: 'mrn' }` translation (no more user-supplied MRN, no more dup-key collisions); `update()` ignores any `mrn` in the patch via the `merged` object's `...current` spread.
- **`src/shared/validators.ts`** — `patientInput.mrn` and `patientPatchInput.mrn` removed; `patientListQueryInput.mrn` kept (search-by-exact-MRN still works); `patientPatchInput`'s `.strict()` rejects any stray `mrn` with a 422.
- **`src/shared/ipc-contract.ts`** — `Patient.mrn: string` (dropped `| null`); `IpcContract.patients.create` is now `Omit<Patient, 'id' | 'mrn' | 'createdAt' | 'updatedAt' | 'deletedAt'>`; `update` is now `Partial<Pick<Patient, 'fullName' | 'dob' | 'gender' | 'phone' | 'notes'>>`.
- **`src/main/ipc/patients.ts`** — `normalizeCreate()` drops `mrn`; `createPatient` calls `patientRepo.create()` inside its existing `db.transaction()` so `nextMrn()` runs transactionally.

## Task 2: Frontend + tests details

- **`src/renderer/src/pages/PatientForm.tsx`** — `mrnError` state + the `IPC_VALIDATION { field: 'mrn' }` branch deleted from both Create and Edit; `<Field label="MRN">` removed from both forms; Create's submit payload no longer sends `mrn`; Edit shows a read-only MRN display (auto-fetched on mount, `data-testid="patient-mrn-readonly"`).
- **`PatientRow.tsx`, `PatientProcedures.tsx`, `ReportEditor.tsx`** — `patient.mrn ?? '—'` → `patient.mrn` (mrn is now non-null, never falls back).
- **`tests/main/db/patients.test.ts`** — added a `describe('patientRepo — auto-MRN contract guards')` block with three regression tests: `mrn` matches `^MRN-\d{6}$`, two consecutive creates produce strictly increasing MRNs, `update()` ignores any `mrn` in the patch.
- **`tests/main/db/migrations/0008_auto_mrn.test.ts` (NEW)** — seeds one NULL-mrn + one `MRN-001` + one `MRN-ABC` row, deletes the 0008 marker row from `_migrations`, re-runs `runMigrations`, then asserts: all three rows are non-null mrn; `MRN-001` / `MRN-ABC` preserved verbatim; the backfilled NULL row matches `^MRN-\d{6}$`; counter table exists with `next >= 2`; inserting NULL mrn fails the NOT NULL constraint; inserting a duplicate `MRN-001` fails the unique index. Also a second case asserting the migration set is idempotent (6 migrations applied on first open, still 6 on second open).

## Verification

- `npx tsc -p tsconfig.node.json --noEmit` → clean.
- `npx tsc -p tsconfig.web.json --noEmit` → clean.
- `npx vitest run tests/main/db/patients.test.ts tests/main/db/migrations/0008_auto_mrn.test.ts tests/main/db/migrations/0002_procedures.test.ts` → 12/12 fail with **NODE_MODULE_VERSION 137 vs 128** ABI mismatch on `better-sqlite3` (existing prebuilt binding was compiled against Electron 32 / Node 20; this sandbox runs Node 24). Rebuilding requires Visual Studio Build Tools ("Desktop development with C++" workload), which is not available in this sandbox — `npm rebuild better-sqlite3` fails at `node-gyp` configure with `Could not find any Visual Studio installation`. Per STATE.md (Phase 03-07 P-Plan note) this kind of pre-existing environmental rebuild is out-of-scope for task verification.

## Manual smoke (next time the binding is rebuilt)

- Open the app, create a new patient — the MRN column reads `MRN-000001` (or whatever the counter has been advanced to).
- The PatientForm has no MRN input on either mode; the Edit form shows MRN as a read-only label.
- Patient list filter by exact MRN (`MRN-000001`) returns the matching row.
- Open a finalized report PDF — the MRN line is populated (no `—` fallback).