---
status: complete
task: change MRN in patients to auto serial num
date: 2026-08-12
commits:
  - c7534fe: feat(patients): auto-generate MRN as serial number
  - 95bdeec: feat(patients-ui): remove MRN input from PatientForm, display as read-only
  - fbe7563: fix(patients): supply MRN in raw-SQL test inserts + drop duplicate-MRN assertion
  - 37ab93a: docs(quick): complete auto-MRN task 26060812 — SUMMARY + STATE row
  - 8439092: fix(migrations): drop 12-step table rebuild — FK constraint on existing DBs
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
  - tests/main/db/migrations.test.ts (migration count 5 -> 6)
  - tests/main/db/migrations/0002_procedures.test.ts (migration count 5 -> 6)
  - tests/main/db/migrations/0003_screenshots_and_trim.test.ts (raw-SQL patient insert now supplies MRN)
  - tests/main/db/migrations/0008_auto_mrn.test.ts (NEW; uses pre-migration fixture file so the NULL-row backfill path is exercised)
  - tests/main/db/patients.test.ts (3 new contract-guard cases; insertPatient helper now supplies MRN)
  - tests/main/db/procedures-repo.test.ts (raw-SQL patient insert now supplies MRN)
  - tests/main/db/report-screenshots-repo.test.ts (raw-SQL patient insert now supplies MRN)
  - tests/main/db/reports-repo.test.ts (raw-SQL patient insert now supplies MRN)
  - tests/main/db/screenshots-repo.test.ts (raw-SQL patient insert now supplies MRN)
  - tests/main/ipc/procedure-notes.test.ts (raw-SQL patient insert now supplies MRN)
  - tests/main/ipc/procedures.test.ts (6 raw-SQL patient inserts now supply MRN)
  - tests/main/ipc/reports.test.ts (raw-SQL patient insert now supplies MRN)
  - tests/main/ipc/screenshots.test.ts (raw-SQL patient insert now supplies MRN)
  - tests/main/patients/create.test.ts (drop duplicate-MRN test; assert `^MRN-\d{6}$` instead of literal)
  - tests/main/patients/search.test.ts (MRN filter test reads the auto-generated MRN back via getPatient before searching)
  - tests/main/recorder/segments.test.ts (raw-SQL patient insert now supplies MRN)
  - tests/main/recorder/trim.test.ts (2 raw-SQL patient inserts now supply MRN)
  - tests/renderer/pages/patient-form.test.tsx (rewrite around the removed MRN input; add the read-only MRN label contract)
  - tests/main/db/migrations/0008_auto_mrn.test.ts (FK regression guard: assert the migration SQL contains no DROP TABLE patients statement, comment-stripped)
tests_added: 5 (3 contract-guard cases in patients.test.ts + 1 backfill test in 0008_auto_mrn.test.ts + 1 FK regression guard in 0008_auto_mrn.test.ts)
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
- `npm run test:unit` → **712/715 pass**; the 3 remaining failures are pre-existing and unrelated to this task:
  - `tests/renderer/rtl/*` (8 files) — Playwright config issue (the RTL files use `test()` from `@playwright/test` but are being run by vitest, which is documented in STATE.md / Phase 7 / Plan 7 as out-of-scope until `npm run dev` is running).
  - `tests/integration/pdf-smoke.test.ts` (3 cases) — `RUN_SMOKE=1`-gated PDF smoke that requires an active Electron render path; out-of-scope in this sandbox per Phase 7 / Plan 6 THRESHOLD DEVIATION note.

## Bug fixes landed in `fbe7563` after the initial commits

Three real bugs surfaced during the post-commit test run — all fixed in `fbe7563`:

1. **`0008_auto_mrn.sql` SQLite UPDATE-with-CTE column reference** — SQLite's `UPDATE … SET col = cte.col` errors with `no such column: cte.col`. Switched to a correlated subquery: `SET mrn = (SELECT 'MRN-' || printf('%06d', seq) FROM numbered WHERE numbered.id = patients.id)`. Without this fix, `runMigrations(db)` aborts and every test that opens the DB fails with `SqliteError: no such column: numbered.seq`.

2. **`0008_auto_mrn.test.ts` wrong DB path + wrong seed timing** — the original test used `path.join(tmpDir, 'app.db')`, but `dbPath()` resolves to `<userData>/data/app.db`. The fixture file ended up at the wrong location, so `getDb()` opened a fresh empty DB and the seeded NULL row never reached the migration's backfill. Fixed by `mkdirSync(path.join(tmpDir, 'data'), { recursive: true })` + writing the DB to `<tmpDir>/data/app.db`. Also added a `seedPreMigrationFixtures()` helper that runs the migration 0001 SQL verbatim + inserts the NULL/non-null fixtures BEFORE `getDb()` runs the migration chain, so 0008's backfill is exercised on a real NULL row.

3. **17 raw-SQL `INSERT INTO patients` calls bypassed `patientRepo.create()`** — these are FK-seed helpers in repo / IPC tests (`tests/main/db/procedures-repo.test.ts`, `tests/main/ipc/procedures.test.ts`, etc.). After migration 0008, `mrn` is NOT NULL at the schema layer, so every raw SQL insert without an `mrn` column fails. Fixed by:
   - adding `mrn` to the INSERT column list + parameter placeholders
   - supplying `MRN-T-${id.slice(-8)}` in each `.run(…)` call so the per-test fresh DB never collides on the unique index
   - also updating `migrations.test.ts` and `0002_procedures.test.ts` to expect 6 migrations (was 5)
   - rewriting `create.test.ts` to drop the now-unreachable duplicate-MRN test + assert `^MRN-\d{6}$` instead of a literal
   - rewriting `patient-form.test.tsx` to drop the now-removed MRN input + add the read-only MRN label contract

The pre-existing `better-sqlite3` ABI mismatch (Node 24 = ABI 137, prebuilt binding compiled against Electron 32 = ABI 128) was resolved by `npx electron-rebuild` rebuilding the binding for Electron's ABI — `npm run test:unit` runs vitest under `electron --node-mode` via `scripts/run-vitest.cjs`, so the Electron-ABI binding is what loads.

## Manual smoke (next time the binding is rebuilt)

- Open the app, create a new patient — the MRN column reads `MRN-000001` (or whatever the counter has been advanced to).
- The PatientForm has no MRN input on either mode; the Edit form shows MRN as a read-only label.
- Patient list filter by exact MRN (`MRN-000001`) returns the matching row.
- Open a finalized report PDF — the MRN line is populated (no `—` fallback).