---
phase: 2
plan: 02-02
title: Patient CRUD + search IPC + audit-on-every-mutation-and-read
subsystem: data-layer + patients
tags: [sqlite, better-sqlite3, patients, audit, search, soft-delete, vitest, zod, ipc]
dependency_graph:
  requires:
    - src/main/db/{index,users,audit}.ts (Plan 02-01 — singleton + migrations + repos)
    - src/main/auth/{index,session}.ts (Plan 02-01 — wizard + admin gate + session)
    - src/shared/{ipc-contract,errors,validators}.ts (Plan 02-01 — Patient type + IpcError + zod)
    - src/main/db/migrations/0001_init.sql (Plan 02-01 — patients table + idx_patients_mrn)
    - src/main/ipc/{auth,users,audit}.ts (Plan 02-01 — IPC handler registration)
  provides:
    - src/main/db/patients.ts (7-method repo with cached prepared statements)
    - src/main/ipc/patients.ts (6 IPC channels + service helpers with audit-on-everything)
    - src/shared/validators.ts (patientInput + patientPatchInput + idInput + patientListQueryInput)
    - src/main/index.ts (patients-ipc-registered boot log entry)
    - tests/main/patients/*.test.ts (5 files, 21 cases)
  affects:
    - src/main/index.ts (registerPatientsIpc wired after audit IPC)
tech-stack:
  added: []
  patterns:
    - Repository with 14 cached prepared statements (insert + 6 list variants + update + soft-delete + restore + get + getIncludingDeleted)
    - SQLITE_CONSTRAINT_UNIQUE -> IPC_VALIDATION { field: 'mrn' } translation at the repo boundary
    - db.transaction(() => { mutate; audit(...) }) wrapper for atomic mutation+audit
    - Session gating + admin gate (is_first_admin === 1) checked BEFORE the transaction (no audit row on auth-failed restore)
    - zod parse re-validated at the service helper layer so tests get IpcErrorException, not raw ZodError
    - PII guard: patient_update metadata.fields = column names only; patient_list metadata = filter echoed (never patient data)
    - getPatient returns null on missing row but still emits patient_view audit (per Fix 6 audit-on-every-read)
key-files:
  created:
    - src/main/db/patients.ts
    - src/main/ipc/patients.ts
    - tests/main/patients/create.test.ts
    - tests/main/patients/search.test.ts
    - tests/main/patients/crud.test.ts
    - tests/main/patients/soft-delete.test.ts
    - tests/main/patients/audit-trace.test.ts
  modified:
    - src/main/index.ts (registerPatientsIpc + logStartup('patients-ipc-registered'))
    - src/shared/validators.ts (patientInput + patientPatchInput + idInput + patientListQueryInput)
decisions:
  - "Service helpers re-validate via zod via safeParse() wrapper that converts ZodError to IpcErrorException — lets tests call service helpers directly and assert IPC_VALIDATION shape without going through IPC handlers."
  - "Restore admin-gate checked BEFORE the db.transaction so a denied non-admin never writes a patient_restore audit row (matches the existing createUser admin-gate pattern)."
  - "getPatient returns null on missing row but still emits a patient_view audit row with entity_id (Fix 6 — every read attempt is auditable)."
  - "patientRepo.list builds parametrized WHERE for { mrn exact } XOR { search substring LIKE COLLATE NOCASE } XOR { none } each with deleted_at IS NULL unless includeDeleted=true — 14 cached prepared statements instead of dynamic SQL string concat."
  - "patientRepo.update merges patch into current row, throws IPC_NOT_FOUND if missing or soft-deleted — single SQL UPDATE where deleted_at IS NULL prevents resurrection."
  - "MRN uniqueness index `idx_patients_mrn WHERE mrn IS NOT NULL AND deleted_at IS NULL` enforced at DB layer; repo + service helper translate SQLITE_CONSTRAINT_UNIQUE -> IPC_VALIDATION { field: 'mrn' }."
  - "getIncludingDeleted reserved for restore + future admin audit review (per T-02-PAT-01); default get() filters deleted_at IS NULL."
  - "patientPatchInput uses .strict() so unknown fields in the patch throw IPC_VALIDATION (defensive against renderer typos)."
  - "patientListQueryInput uses .strict() and max 200 pageSize + positive page guard at the validator layer; repo caps pageSize at 200 defensively."
  - "Audit-trace test asserts exactly 7 rows in this order: auth.bootstrap.completed, patient_create, patient_list, patient_view, patient_update, patient_delete, patient_restore. The plan mentioned '8 rows' but only listed 7 actions; the extra `patient_view` would only fire if the soft-delete verify branch ran an extra get, which we deliberately skipped for a clean trace. The forbidden-substring grep on every metadata column confirms zero field values leak."
metrics:
  duration: ~13 min (incl. typecheck fix + safeParse helper + non-admin restore import fix)
  completed_date: 2026-08-01
  tasks: 2
  test_files: 5
  test_cases: 21
status: complete
---

# Phase 2 Plan 02 Summary

Patients repo + 6 IPC channels + audit-on-every-mutation-and-read + 21-test coverage with PII-safe audit metadata.

## Task 1 — Patient repo + create/list/get IPC + audit-on-create + first test (commit `988d354`)

Bootstrapped the patient CRUD end-to-end. `src/main/db/patients.ts` exports `patientRepo` with 7 methods (`create`/`get`/`getIncludingDeleted`/`list`/`update`/`softDelete`/`restore`) backed by 14 cached prepared statements; the `list` filter matrix is `{mrn, search, includeDeleted}` x `{active, all}` yielding 6 permutations each for `list` and `count`. The MRN uniqueness index `idx_patients_mrn WHERE mrn IS NOT NULL AND deleted_at IS NULL` (already in 0001_init.sql) is caught at the repo boundary and translated to `IPC_VALIDATION { field: 'mrn' }`. `src/main/ipc/patients.ts` registers 6 IPC channels and exposes 6 service helpers; each mutation helper wraps `repo.method() + audit({...})` in `db.transaction(() => {...})` so a trigger abort rolls back the patient row too. `restorePatient` checks the admin gate BEFORE the transaction so non-admins never write a `patient_restore` audit row. `listPatients` and `getPatient` always write a `patient_list`/`patient_view` audit row (per Fix 6 + ROADMAP Phase 2 success criterion 5) — `getPatient` even writes one when the row is missing. `src/shared/validators.ts` gains `patientInput`/`patientPatchInput`/`idInput`/`patientListQueryInput` (all `.strict()` for defensive shape checking); `src/main/index.ts` wires `registerPatientsIpc()` after the audit IPC and logs `patients-ipc-registered`. The 4-case `create.test.ts` covers happy path + audit row in same transaction, duplicate MRN, missing fullName, and unauthenticated gating.

## Task 2 — Search + CRUD + soft-delete + audit-trace tests (commit `481918e`)

Four more test files land: `search.test.ts` (5 cases) verifies default `list()` returns 25 alphabetical rows from 50 with `total=50` + 1 `patient_list` audit row, substring search matches case-insensitively, exact MRN matches single row, `includeDeleted:false` excludes soft-deleted, and `page=2 + pageSize=10` returns rows 11-20 alphabetically. `crud.test.ts` (5 cases) walks get + update + get and asserts 2 `patient_view` + 1 `patient_update` audit rows with `metadata.fields = ['phone','notes']`; updates against a missing id throw `IPC_NOT_FOUND` and write no audit row; every successful update writes a `patient_update` row; 3 list calls = 3 audit rows; 5 get calls = 5 audit rows. `soft-delete.test.ts` (6 cases) verifies default list excludes the soft-deleted row, `get()` returns null, the row still exists with `deleted_at` populated, `includeDeleted:true` surfaces it with `deletedAt`, non-admin cannot restore (throws `IPC_VALIDATION` per D-02), admin can restore (`deleted_at` returns to NULL), restore on non-deleted throws `IPC_NOT_FOUND`, and every soft-delete + restore writes a `patient_delete` / `patient_restore` audit row. `audit-trace.test.ts` (1 case) runs the full `bootstrap -> create -> list -> view -> update -> delete -> restore` lifecycle and asserts exactly 7 chronological rows in order with a forbidden-substring grep over every metadata column proving zero MRN / phone / notes VALUES leaked into `audit_log.metadata`.

## Verification

- `npm run typecheck:node` -> exit 0
- `npm run test:unit -- --run tests/main/patients` -> **5 test files passed, 21 tests passed, 0 failed**
- `npm run test:unit -- --run` (full suite) -> **13 test files passed, 50 tests passed, 0 failed** (29 pre-existing + 21 new)
- `findstr /R /C:"DELETE FROM patients" src\main\**\*.ts | findstr /V "ponytail"` -> no matches (PAT-04: no hard-delete path)
- `git grep -nE "audit:update|audit:delete" src` -> no matches (AUDIT-02: no audit mutation IPC)
- All Fix 8 markers (`per D-02`, `per PAT-01/02/03/04`, `per AUDIT-01`, `per Fix 6`) are present in `src/main/db/patients.ts` and `src/main/ipc/patients.ts`.
- audit-trace.test.ts asserts `auth.bootstrap.completed -> patient_create -> patient_list -> patient_view -> patient_update -> patient_delete -> patient_restore` (7 rows in order); forbidden substrings `TRACE-001`, `555-7777`, `555-8888`, `severe headache` grep clean across all metadata.

## Deviations from Plan

1. **`safeParse()` helper added to `src/main/ipc/patients.ts` (unlisted in the plan)** — needed because the existing pattern (zod parse only at the IPC handler boundary, service helpers trust their input) means tests calling service helpers directly saw raw `ZodError` instead of `IpcErrorException`. The plan's test for "missing fullName -> `IPC_VALIDATION { field: 'fullName' }`" requires the error shape to be the IPC one. `safeParse()` wraps `schema.parse()` and converts the first issue's path[0] into `IpcErrorException({ code: 'IPC_VALIDATION', field })`. Service helper signatures switched from typed inputs (`z.infer<...>`) to `unknown` so the same defense-in-depth applies at both boundaries.
2. **`src/main/startup-log.ts` NOT modified** — the plan listed it as a file to extend for the `patients-ipc-registered` log, but the existing `logStartup(event: string)` function already handles arbitrary event names by appending to `logs/startup.log`. The "extension" is purely the call from `src/main/index.ts`. No code change to startup-log.ts was needed.
3. **Audit-trace test asserts 7 rows, not 8** — the plan said "exactly 8 rows ... (plus one extra `patient_view` from the soft-delete verify if applicable)". My lifecycle does NOT include a soft-delete verify, so the trace has 7 rows. The plan's wording acknowledges the extra view is optional ("if applicable"), and my test correctly asserts the 7 baseline rows in chronological order.
4. **`updatePatient` accepts `patch: unknown` and re-parses internally** — the typed signature `patch: z.infer<typeof patientPatchInput>` was incompatible with the IPC handler passing `raw.patch` (typed as `unknown`). Swapped to `unknown` + internal `safeParse(patientPatchInput, patch)` to keep the IPC layer's defensive parse. Same for `createPatient` and `listPatients`.
5. **`patientPatchInput` / `patientListQueryInput` use `.strict()`** — undeclared fields in the patch throw `IPC_VALIDATION`. The plan didn't explicitly require this but it matches the existing pattern and prevents renderer typos from silently being ignored.
6. **`getPatient` audit on missing row uses `outcome: 'ok'`** — the lookup happened, the row just wasn't found; semantically still a successful "view attempt" event. The plan didn't specify, but per Fix 6 audit-on-every-read the audit row is what matters.

## Files created / modified

- 7 created (src/main/db/patients.ts + src/main/ipc/patients.ts + 5 test files)
- 2 modified (src/main/index.ts + src/shared/validators.ts)
- Total: 9 files; +1,552 LOC

## Status

- All 21 new patient tests pass.
- All 50 total tests pass (no regressions).
- `02-02-SUMMARY.md` written.
- No renderer surface touched (Plan 02-03 scope).
- No DB migration added (table + indexes shipped in Plan 02-01's `0001_init.sql`).
- Ready for `02-03-PLAN.md` (renderer wiring) to consume `patients.*` IPC via `window.api.patients.{list,get,create,update,softDelete,restore}`.

## Self-Check: PASSED

- `.planning/phases/02-database-patient-audit-auth/02-02-SUMMARY.md` exists (11,957 bytes).
- Commit `988d354` (feat Task 1) exists in `git log`.
- Commit `481918e` (test Task 2) exists in `git log`.
- `src/main/db/patients.ts` exists (7-method repo).
- `src/main/ipc/patients.ts` exists (6 IPC channels + service helpers).
- `tests/main/patients/{create,search,crud,soft-delete,audit-trace}.test.ts` exist (5 files).
- `src/shared/validators.ts` exports `idInput`, `patientInput`, `patientPatchInput`, `patientListQueryInput`.
- `src/main/index.ts` calls `registerPatientsIpc()` after `registerAuditIpc()`.
- `npm run typecheck:node` -> exit 0.
- `npm run test:unit -- --run tests/main/patients` -> 5 files / 21 cases / 0 failed.
- No actual `DELETE FROM patients` SQL statement in `src/main` (only one `ponytail:` comment that mentions the phrase).