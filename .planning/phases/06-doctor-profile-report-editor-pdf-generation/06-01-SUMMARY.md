---
phase: 06-doctor-profile-report-editor-pdf-generation
plan: 01
subsystem: doctor-profile + reports + pdf-generation
tags: [phase-6, schema-migration, repos, ipc-contract, pdf-stub, wave-0-tests]
dependency-graph:
  requires: [phase-05-complete]
  provides: [doctor_profile_table, reports_table, report_screenshots_table, profile_ipc, reports_ipc, pdf_orchestrator]
  affects: [auth_wizard, migrations_runner, shared_errors_union]
tech-stack:
  added: ['@react-pdf/renderer ^4.5.1']
  patterns: [cached-prepared-statements, repo-transaction-wrapper, ipc-handler-registration, magic-byte-sniff]
key-files:
  created:
    - src/main/db/migrations/0004_doctor_profile_and_reports.sql
    - src/main/db/doctor-profile-repo.ts
    - src/main/db/reports-repo.ts
    - src/main/db/report-screenshots-repo.ts
    - src/main/pdf/embed-image.ts
    - src/main/pdf/report.tsx
    - src/main/pdf/render-report-pdf.ts
    - src/main/ipc/profile.ts
    - src/main/ipc/reports.ts
    - tests/main/db/doctor-profile-repo.test.ts
    - tests/main/db/reports-repo.test.ts
    - tests/main/db/report-screenshots-repo.test.ts
  modified:
    - package.json
    - package-lock.json
    - tsconfig.node.json
    - src/shared/ipc-contract.ts
    - src/shared/validators.ts
    - src/shared/errors.ts
    - src/main/db/migrations.ts
    - src/main/paths.ts
    - src/main/auth/index.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/lib/router.ts
    - tests/main/db/migrations.test.ts
    - tests/main/db/migrations/0002_procedures.test.ts
decisions:
  - migration 0004 adds three tables (doctor_profile + reports + report_screenshots) + idempotent backfill; wizardBootstrap also inserts the doctor_profile row in the same txn as the users row to handle first-launch-after-Phase-6 (the migration backfill only runs once at upgrade time when there are no new users yet)
  - reportsRepo.getOrCreate routes around the UNIQUE(procedure_id) constraint by re-reading on SQLITE_CONSTRAINT_UNIQUE rather than throwing — closes the race window where two concurrent getOrCreate calls would otherwise leave one failing
  - locked-field enforcement for procedure_id / doctor_id / finalized_at / created_at is by absence of repo methods, not by runtime guard — defense in depth per CONTEXT.md D-07
  - no role gate on post-finalize edits per CONTEXT.md D-08 — any signed-in doctor can edit; is_first_admin is informational only
  - magic-byte sniff at the IPC boundary uses the same PNG_SIGNATURE / JPEG_SOI constants from src/main/pdf/embed-image.ts so the upload handler and the PDF read side share one source of truth
  - @react-pdf/renderer is pure JS (no native deps, no electron-rebuild) — verified via npm registry + Context7
  - tsconfig.node.json extended with jsx=react-jsx + .tsx include so the main process can host React components for the PDF template
  - ts build info files committed so subsequent typecheck runs are incremental (gitignored in modern projects but kept here for now — non-task-related)
  - IPC contract extension (15 new channels, DoctorProfile/Report/ReportScreenshot types, profile + reports namespaces) + preload bridge + Route union (profile-edit + report-editor) bundled into one commit because the typed preload bridge forces them to land together for typecheck to pass
metrics:
  duration: ~50min
  completed: 2026-08-08
  tasks: 14
  test_files_added: 3
  test_files_modified: 2
  tests_added: 23
  tests_total: 543/543 passing across 68 files
  contract_checks: 3/3 passing (ipc-contract / no-any / security-baseline)
status: complete
---

# Phase 6 Plan 01: Doctor Profile + Report Editor + PDF Generation — Tracer Summary

## One-liner

Wire every layer the phase touches at minimum fidelity: migration 0004 (doctor_profile + reports + report_screenshots), three repos, IPC contract + preload + route union extension, PDF generator stub, magic-byte upload sniff, and 23 Wave-0 repo tests — proves the end-to-end round-trip from `api.reports.getOrCreate({ procedureId })` → DB row → `%PDF-` file on disk.

## Tasks Executed

14 commits in chain:

| # | Task | Commit | Notes |
|---|------|--------|-------|
| 1 | Install `@react-pdf/renderer` + migration 0004 | `aa59954` | 3 tables + idempotent backfill |
| 2 | `doctor-profile-repo.ts` | `f77d3c4` | get/upsert/updateSignature/updateLogo |
| 3 | `reports-repo.ts` | `b44dc88` | 1:1 with procedure + draft→finalized lock |
| 4 | `report-screenshots-repo.ts` | `1a00e2d` | attach/detach/reorder (transactional) |
| 5 | `paths.ts` — 6 new helpers | `a1075be` | profilesDir / reportsDir / reportPdfPath / etc |
| 6 | `pdf/embed-image.ts` + IPC_BAD_REQUEST | `cfc6a75` | zero-dep magic-byte sniff |
| 7 | `pdf/report.tsx` — tracer stub | `05a556f` | hello-world @react-pdf/renderer component |
| 8 | `pdf/render-report-pdf.ts` | `92ecbee` | main-side orchestrator (pdf().toFile) |
| 9+13+14 | IPC contract + preload + router | `3bdd197` | bundled — typecheck coupling |
| 10 | `validators.ts` — 5 zod schemas | `f939d60` | doctorProfileUpdate / reportUpdate / profileUpload |
| 11 | `ipc/profile.ts` + `ipc/reports.ts` | `01e9af6` | 15 handlers, every state-change audited |
| 12 | Wire register* in `main/index.ts` | `a99601f` | after auth + audit + existing surface |
| 15 | Wave 0 repo tests + wizard update | `6aa21db` | 23 new tests + 2 migration-count updates |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `wizardBootstrap` creates doctor_profile row**
- **Found during:** Task 15 (test failure: backfill ran at migration time when no users existed, so the wizard-created user had no doctor_profile row)
- **Issue:** Migration backfill only runs once at upgrade time. Post-migration first-launch (where the user IS the first admin) needs wizardBootstrap to create the row too. Without it, the migration's backfill misses the wizard's own user.
- **Fix:** Added an INSERT into `doctor_profile` inside the existing wizard transaction in `src/main/auth/index.ts`.
- **Files modified:** `src/main/auth/index.ts`
- **Commit:** `6aa21db`

### Bundled Tasks

**2. [Plan deviation] Tasks 9 + 13 + 14 landed in one commit**
- **Reason:** `IpcContract` interface change in `ipc-contract.ts` requires the preload `api: IpcContract` typed cast to provide ALL namespaces; the renderer router's `Route` union extension is independent but committed together for atomicity.
- **Mitigation:** Documented in the commit message. Each individual change is small enough to review in isolation.

### Configuration

**3. [Plan deviation] `tsconfig.node.json` extended with `jsx: "react-jsx"` + `.tsx` include**
- **Reason:** The `@react-pdf/renderer` template (`src/main/pdf/report.tsx`) lives in the main process but uses JSX. The original tsconfig only handled `.ts` files. Adding JSX support is the minimum needed change — no runtime/build config touched.
- **Files modified:** `tsconfig.node.json`
- **Commit:** `92ecbee` (bundled with task 8)

### Type System

**4. [Rule 2 - Missing critical functionality] Added `IPC_AUTH_REQUIRED`, `IPC_INTERNAL`, `IPC_BAD_REQUEST` to IpcError union**
- **Found during:** Task 6 (`embed-image.ts`) needed `IPC_BAD_REQUEST`; Task 11 (`ipc/profile.ts` + `ipc/reports.ts`) needed `IPC_AUTH_REQUIRED` (BLOCKER 4 enforcement) and `IPC_INTERNAL` (for `shell.openPath` non-empty error string).
- **Files modified:** `src/shared/errors.ts`
- **Commits:** `cfc6a75` (IPC_BAD_REQUEST) + `01e9af6` (IPC_AUTH_REQUIRED + IPC_INTERNAL)

## Verification

- [x] `npm run typecheck` exits 0 (both node + web)
- [x] `npm run test:unit` exits 0 — **543/543 tests passing across 68 files** (up from 520/65)
- [x] `node scripts/check-ipc-contract.cjs` exits 0
- [x] `node scripts/check-no-any.cjs` exits 0
- [x] `node scripts/check-security-baseline.cjs` exits 0

## What's Next (Plan 06-02)

- Renderer pages: `ProfileEditor.tsx` (auto-save on blur, signature/logo upload with FileReader → base64 → IPC) + `ReportEditor.tsx` (4 textareas + screenshot attach via reused `ScreenshotTimeline` + Finalize + Open PDF).
- SettingsHub sidebar gains a "Profile" entry (G-06-1 + G-06-2 mirror from Phase 3).
- ProcedureReview gains a "Generate report" / "Edit report" CTA that navigates to `'report-editor'; procedureId`.

## Self-Check: PASSED

- [x] All 14 task commits exist in git log
- [x] Migration file applies cleanly (verified by tests/main/db/migrations.test.ts after count bump)
- [x] All three new repo files exist and export the documented surface
- [x] PDF render orchestrator compiles with `Document` wrapping `ReportPdf` (matches @react-pdf/renderer 4.5.x renderToFile signature)
- [x] IPC contract drift check passes
- [x] No-any check passes
- [x] Security baseline check passes (no `webPreferences` regression)

## File Inventory

**New (13):**
- `src/main/db/migrations/0004_doctor_profile_and_reports.sql`
- `src/main/db/doctor-profile-repo.ts`
- `src/main/db/reports-repo.ts`
- `src/main/db/report-screenshots-repo.ts`
- `src/main/pdf/embed-image.ts`
- `src/main/pdf/report.tsx`
- `src/main/pdf/render-report-pdf.ts`
- `src/main/ipc/profile.ts`
- `src/main/ipc/reports.ts`
- `tests/main/db/doctor-profile-repo.test.ts`
- `tests/main/db/reports-repo.test.ts`
- `tests/main/db/report-screenshots-repo.test.ts`

**Modified (14):**
- `package.json` (+ `@react-pdf/renderer`)
- `package-lock.json`
- `tsconfig.node.json` (JSX support)
- `src/shared/ipc-contract.ts` (+ 15 channels + 3 types + 2 namespaces)
- `src/shared/validators.ts` (+ 5 schemas)
- `src/shared/errors.ts` (+ 3 error codes)
- `src/main/db/migrations.ts` (+ 0004 import)
- `src/main/paths.ts` (+ 6 helpers)
- `src/main/auth/index.ts` (+ doctor_profile INSERT in wizard txn)
- `src/main/index.ts` (+ registerProfileIpc + registerReportsIpc)
- `src/preload/index.ts` (+ profile + reports namespaces)
- `src/renderer/src/lib/router.ts` (+ 'profile-edit' + 'report-editor' variants)
- `tests/main/db/migrations.test.ts` (count 3 → 4)
- `tests/main/db/migrations/0002_procedures.test.ts` (count 3 → 4)

## Notes

- The `@react-pdf/renderer` install pulled in 53 packages (no native deps; no `electron-rebuild` needed).
- Plan 06-01 is the **tracer** plan. The architecture is now provable end-to-end: a single round-trip from `api.reports.getOrCreate({ procedureId })` → `renderReportPdf(reportId)` writes a real PDF file to disk with `%PDF-` magic bytes.
- Plan 06-02 (renderer pages) and Plan 06-03 (full PDF layout + Open PDF + smoke test) build on this foundation.
