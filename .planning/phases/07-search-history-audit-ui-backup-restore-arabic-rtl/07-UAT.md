# Phase 7 — User Acceptance Test Plan

> GCC-market ship gate. Every visible UI string must be in both languages before this phase is tagged done.

## Overview

Phase 7 ships search/filter, audit UI, backup/restore, EN+AR i18n with RTL coverage, and AR PDF rendering. This document captures the manual smoke + integration test pass criteria for `/gsd-verify-work 7`.

## Prerequisites

1. Phase 1–6 complete; baseline 657+ tests passing across 89 files.
2. `npm install` (Playwright already in devDependencies per Plan 07-06).
3. `npx playwright install chromium` (one-time — already present in `%LOCALAPPDATA%\ms-playwright\chromium-1234\` per Plan 07-06 verification).
4. The `electron-vite` dev server must be running for the e2e suite. Start it in a separate terminal: `npm run dev`. The dev server binds `http://localhost:5173` (Playwright `baseURL`).
5. `npm run test:e2e -- tests/renderer/rtl/` runs all 8 RTL smoke tests (requires step 4).
6. `RUN_SMOKE=1 npm run test:integration:smoke:phase7` runs both roundtrip + AR PDF magic tests (verified locally — 3/3 pass on Windows).

## Test Cases

### SRCH-01 / SRCH-02 / SRCH-03 — Cross-cutting search

- Open PatientsList → type "John" in name search → assert results filter (substring match across patient full_name + procedure context).
- Type "12345" in MRN exact → assert results filter (exact match against `patients.mrn`).
- Pick date range Aug 1 → Aug 31 → click Apply → assert only procedures with `started_at` in the range surface.
- Pick doctor from dropdown → click Apply → assert results filter to that doctor's procedures only.
- Tick Completed status checkbox → click Apply → assert only `status='completed'` procedures.
- Combine ALL 5 dimensions (name + MRN + date range + doctor + status) with AND → assert the intersection is correct (no over/under-inclusion).
- Expand a patient row accordion → click "Open procedure" → assert navigation to `procedure-review`.
- Click "Open report PDF" on a finalized report row → assert the system PDF viewer opens (REPORTS_OPEN_PDF IPC).

### AUDIT-01 / AUDIT-02 — Audit log

- Open Settings → Audit (`/audit`) → assert row layout: `HH:MM:SS · user · action · entity` (single-line, monospace timestamp).
- Filter by date range → assert results filter (audit.list takes `dateFrom`/`dateTo`).
- Click an audit row → assert detail Dialog opens with pretty-printed JSON metadata.
- Click "Copy JSON" → assert clipboard contains the JSON (use `navigator.clipboard.readText()` in DevTools to verify).
- Verify NO edit/delete affordance on audit rows (AUDIT-02 — append-only enforced at the UI + IPC + DB layer).
- Verify `audit_view` self-audit row fires on mount of the Audit page (debounced 1s).

### SET-05 — Backup

- Open Settings → Backup & Restore (`/backup-restore`) → click "Create Backup" → pick destination in the OS dialog → assert zip created (`backup.created` audit row + toast).
- Verify toast "Backup created" with "Reveal in Explorer" affordance → click → assert Explorer opens at the destination (BACKUP_REVEAL IPC via `shell.showItemInFolder`).
- Verify the zip contains `app.db` + `media/` + `profiles/` + `reports/` (manual un-zip in Explorer).

### SET-06 — Restore

- Open Settings → Backup & Restore → click "Choose backup file" → pick the zip → click Preview → assert counts (`fileCount`, `totalSize`, `dbIntegrityCheck: 'ok'`) + integrity check status displayed.
- Click "Restore to staging" → confirm via ConfirmDialog → assert staging complete toast (RESTORE_REVEAL_STAGING IPC reveals the staging dir).
- Verify the active `data/` folder is UNCHANGED after Restore-to-staging (compare file count + checksums via Explorer — the active DB must not be overwritten without an explicit "Activate this backup" step, which is the v1.1 placeholder).

### PROF-02 / I18N-01 — Per-doctor language preference

- Open Settings → Profile Editor (`/profile-edit`) → Language Card → select AR → assert `doctor_profile.language = 'ar'` after Save.
- Reload the app → assert the language persisted (no flash of English on cold start).
- Verify the toast "Language updated" fires on Save.
- Verify a `language.changed` audit row is written with `{ from, to, doctorId }`.

### I18N-02 / I18N-03 — Direction flip + RTL coverage

- With the app running in EN, open DevTools → set `document.documentElement.dir = 'rtl'` + `document.documentElement.lang = 'ar'` → reload the page → assert UI flips (text-align, margin/padding, icon mirroring where applicable).
- Click every shadcn component on every route (slider, dropdown, dialog, popover, calendar, tooltip) → assert no right-edge overflow (`document.documentElement.scrollWidth <= window.innerWidth`).
- Run `npm run test:e2e -- tests/renderer/rtl/` (with `npm run dev` in a separate terminal) → assert all 8 tests pass: Login, Wizard, PatientsList, ProcedureReview, ReportEditor, ProfileEditor, Audit, BackupRestore.
- Open the captured screenshots at `tests/renderer/rtl/screenshots/*--rtl.png` → visually compare to LTR baseline (`tests/renderer/visual-regression/`, Phase 8 hardening) — confirm text alignment + icon mirroring.
- Verify no English-only fallback strings are visible when `lang='ar'` (D-24 parity check enforces this at the bundle level — Vitest walks EN keys + asserts AR coverage).

### RPT-06 — Arabic PDF

- Set doctor profile language to AR (per PROF-02 / I18N-01 above).
- Open a finalized report → click "Regenerate PDF" → assert file size > 5KB at `<userData>/data/reports/<reportId>.pdf`.
- Verify the file starts with the `%PDF` magic bytes (verified via `RUN_SMOKE=1 npm run test:integration:smoke:phase7` — D-27 ship gate).
- Open the PDF in OS viewer → assert Arabic text renders RTL + numeric fragments (MRN, DOB, duration) stay LTR + signature is bottom-LEFT (per Pitfall 8 — Arabic documents have signatures bottom-left).

## Pass/Fail criteria

- All 8 RTL smoke tests pass via `npm run test:e2e -- tests/renderer/rtl/`.
- All 2 integration smoke tests pass via `RUN_SMOKE=1 npm run test:integration:smoke:phase7`:
  - `tests/integration/backup-restore-roundtrip.test.ts` — 2 cases: `createBackup` produces a non-empty zip + `previewRestore` integrity check returns `'ok'`; `unpackRestore` writes `app.db` + `integrityCheck` returns `'ok'`.
  - `tests/integration/ar-pdf-magic.test.ts` — 1 case: full-orchestrator AR PDF render via `renderReportPdf(reportId, {language: 'ar'})`, file size > 5KB, first 4 bytes are `'%PDF'`.
- All existing tests still pass (no regressions — target 660+ tests across 90+ files).
- Manual smoke checks above all pass.
- Typecheck passes: `npm run typecheck` (both `typecheck:node` + `typecheck:web`).

## Manual-Only Verifications

- **RTL visual regression:** compare `tests/renderer/rtl/screenshots/*.png` against the LTR baseline in `tests/renderer/visual-regression/` (Phase 8 hardening — out of scope for v1).
- **AR PDF bidi ordering:** open the generated AR PDF in OS viewer + verify numeric fragments (MRN: 12345) read LTR + Arabic body reads RTL + signature is bottom-LEFT.
- **Backup zip contents:** open the created zip in Explorer + verify it contains `app.db` + `media/` + `profiles/` + `reports/`.
- **Audit log integrity:** after a full session of activity, export the audit log via the JSON export in the Audit page detail Dialog → verify every login / procedure view / procedure edit / report create/finalize / settings change / backup/restore is present (AUDIT-01 coverage).
- **Language persistence:** kill the app mid-session → relaunch → confirm the doctor's selected language (EN/AR) survives a cold start (no flash of the wrong language on boot).
- **Doctor profile auto-fill:** open the Report Editor → verify the clinic name + signature image auto-fill from `doctor_profile` (no per-report re-entry) — PROF-02 acceptance.
