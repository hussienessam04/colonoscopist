---
phase: 7
slug: search-history-audit-ui-backup-restore-arabic-rtl
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-10
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 (unit + integration) |
| **Renderer DOM** | happy-dom 20.11.1 (Vitest jsdom env) — confirmed via `tests/setup.ts` |
| **Test config** | `scripts/run-vitest.cjs` — `npm run test:unit` |
| **Integration smoke** | `npm run test:integration:smoke` — gated by `RUN_SMOKE=1` |
| **E2E smoke** | Playwright (Wave 0 install if absent) — `npm run test:e2e -- tests/renderer/rtl/` |
| **Quick run command** | `npm run test:unit -- <single test file>` |
| **Full suite command** | `npm run typecheck && npm run test:unit && npm run test:integration:smoke` |
| **Estimated runtime** | ~60 seconds (unit), ~120 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- <new test file>` — runs only the new test(s) for fast feedback (~3-5s).
- **After every plan wave:** Run `npm run typecheck && npm run test:unit` — full type-check + unit suite (current Phase 6 baseline: 559 tests across 72 files).
- **Before `/gsd-verify-work`:** Full suite must be green; `RUN_SMOKE=1 npm run test:integration:smoke` for AR PDF + backup/restore round-trip.
- **Max feedback latency:** ~5 seconds per task, ~60 seconds per wave.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | I18N-01 | T-07-01 | `users.language` + `doctor_profile.language` columns added | unit | `npm run test:unit -- tests/main/db/migrations.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | I18N-01 | T-07-01 | `auth.wizard` accepts `language` arg | unit | `npm run test:unit -- tests/main/auth/wizard-bootstrap.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | SET-05 | T-07-08 | `PRAGMA wal_checkpoint(TRUNCATE)` + `db.backup()` shape | unit | `npm run test:unit -- tests/main/backup/snapshot.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | SET-05 | T-07-08 | `archiver` zip stream order | unit | `npm run test:unit -- tests/main/backup/index.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-05 | 01 | 1 | SET-06 | T-07-02 | yauzl entry path filter rejects `..` + absolute | unit | `npm run test:unit -- tests/main/backup/restore.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-06 | 01 | 1 | SET-06 | T-07-08 | `PRAGMA integrity_check` on staged DB | unit | `npm run test:unit -- tests/main/backup/restore.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-07 | 01 | 1 | AUDIT-01 | T-07-04 | `audit()` helper exists; no bypass paths | unit | `npm run test:unit -- tests/main/db/audit.test.ts` | ✅ | ⬜ pending |
| 07-02-01 | 02 | 2 | SRCH-01 | T-07-05 | `patientRepo.list` accepts `dateRange`/`doctorId`/`procedureStatus` | unit | `npm run test:unit -- tests/main/db/patients.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 2 | SRCH-01 | T-07-05 | `proceduresRepo.list` accepts filters | unit | `npm run test:unit -- tests/main/db/procedures-repo.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-03 | 02 | 2 | SRCH-02 | T-07-05 | Patient row expansion shows procedure + report context | unit | `npm run test:unit -- tests/renderer/pages/PatientsList.test.tsx` | ❌ W0 | ⬜ pending |
| 07-02-04 | 02 | 2 | SRCH-03 | T-07-05 | Procedure row click navigates to `'procedure-review'; procedureId` | unit | `npm run test:unit -- tests/renderer/pages/PatientsList.test.tsx` | ❌ W0 | ⬜ pending |
| 07-03-01 | 03 | 3 | AUDIT-01 | T-07-04 | `audit_view` row written on Audit page mount | unit | `npm run test:unit -- tests/renderer/pages/Audit.test.tsx` | ❌ W0 | ⬜ pending |
| 07-03-02 | 03 | 3 | AUDIT-02 | T-07-04 | No write/delete IPC for audit_log; triggers reject UPDATE/DELETE | unit | `npm run test:unit -- tests/main/db/audit.test.ts` | ✅ | ⬜ pending |
| 07-03-03 | 03 | 3 | I18N-01 | T-07-01 | `profile.update` with `language` updates `doctor_profile.language` | unit | `npm run test:unit -- tests/main/ipc/profile.test.ts` | ❌ W0 | ⬜ pending |
| 07-04-01 | 04 | 4 | SET-05 | T-07-08 | Backup zip contains `app.db` + media subtree + profiles + reports | unit | `npm run test:unit -- tests/main/backup/index.test.ts` | ❌ W0 | ⬜ pending |
| 07-04-02 | 04 | 4 | SET-06 | T-07-02 | `restore.preview` parses staged DB + returns counts + integrity result | unit | `npm run test:unit -- tests/main/backup/restore.test.ts` | ❌ W0 | ⬜ pending |
| 07-04-03 | 04 | 4 | SET-06 | T-07-02 | `restore.unpack` writes to `<userData>/data-restore-<ts>/` only | unit | `npm run test:unit -- tests/main/backup/restore.test.ts` | ❌ W0 | ⬜ pending |
| 07-05-01 | 05 | 5 | I18N-01 | T-07-01 | i18n bundle loads; EN + AR parity | unit | `npm run test:unit -- tests/renderer/i18n/parity.test.ts` | ❌ W0 | ⬜ pending |
| 07-05-02 | 05 | 5 | I18N-02 | T-07-03 | `useLanguage()` flips `<html dir>` on language change | unit | `npm run test:unit -- tests/renderer/hooks/useLanguage.test.ts` | ❌ W0 | ⬜ pending |
| 07-05-03 | 05 | 5 | I18N-02 | T-07-03 | `useAudit` SWR-style hook contract | unit | `npm run test:unit -- tests/renderer/hooks/useAudit.test.ts` | ❌ W0 | ⬜ pending |
| 07-05-04 | 05 | 5 | I18N-03 | T-07-07 | RTL smoke: every route boots with `dir='rtl'` + no overflow | smoke (Playwright) | `npm run test:e2e -- tests/renderer/rtl/` | ❌ W0 | ⬜ pending |
| 07-06-01 | 06 | 6 | RPT-06 | T-07-06 | AR PDF renders with `Font.register('NotoSansArabic')` + file > 50KB + PDF magic bytes | integration smoke | `RUN_SMOKE=1 npm run test:integration:smoke` | ❌ W0 | ⬜ pending |
| 07-06-02 | 06 | 6 | SET-05 | T-07-08 | Backup → restore round-trip; integrity check passes | integration smoke | `RUN_SMOKE=1 npm run test:integration:smoke` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/main/db/patients.test.ts` — extend with `dateRange`/`doctorId`/`procedureStatus` filter coverage.
- [ ] `tests/main/db/procedures-repo.test.ts` — extend with `dateRange`/`doctorId` filter coverage.
- [ ] `tests/main/db/migrations.test.ts` — add 0007 case (run all migrations on empty DB + assert new columns exist).
- [ ] `tests/main/backup/snapshot.test.ts` (new) — assert `PRAGMA wal_checkpoint(TRUNCATE)` + `db.backup()` shape.
- [ ] `tests/main/backup/index.test.ts` (new) — mock `archiver` + assert stream order + zip contents.
- [ ] `tests/main/backup/restore.test.ts` (new) — mock `yauzl` + assert path safety filter + integrity check.
- [ ] `tests/main/db/audit.test.ts` — verify existing `audit()` helper + immutability triggers.
- [ ] `tests/main/ipc/profile.test.ts` — extend with `language` field coverage.
- [ ] `tests/main/auth/wizard-bootstrap.test.ts` — extend with `language` arg coverage.
- [ ] `tests/renderer/hooks/useLanguage.test.ts` (new) — assert `<html dir>` flip on language change.
- [ ] `tests/renderer/hooks/useAudit.test.ts` (new) — SWR-style hook contract.
- [ ] `tests/renderer/pages/Audit.test.tsx` (new) — assert 100/page + filter combo + audit_view emit on mount.
- [ ] `tests/renderer/pages/BackupRestore.test.tsx` (new) — assert backup flow + restore preview + staging dir copy.
- [ ] `tests/renderer/pages/PatientsList.test.tsx` — extend with filter sidebar coverage.
- [ ] `tests/renderer/i18n/parity.test.ts` (new) — D-24 walks EN keys + asserts AR coverage.
- [ ] `tests/renderer/i18n/useLanguage-flow.test.tsx` (new) — boot renderer + toggle language + assert `<html dir>` flips.
- [ ] `tests/integration/backup-restore-roundtrip.test.ts` (new) — `RUN_SMOKE=1` gated; creates backup, unpacks to staging, asserts integrity + counts.
- [ ] `tests/integration/ar-pdf-smoke.test.ts` (new) — `RUN_SMOKE=1` gated; renders AR report, asserts > 50KB + PDF magic bytes.
- [ ] `tests/renderer/rtl/<route>.test.ts` (new per D-22) — Playwright smoke per route.
- [ ] **Playwright infrastructure** — install `@playwright/test` + `playwright` if not already present; verify via `npm ls @playwright/test`.
- [ ] Framework install: `npm install -D @playwright/test` + `npx playwright install chromium` (if Playwright is not already in the test stack — verify with `ls tests/integration` or grep package.json).

*Existing infrastructure covers:* main-side unit tests (Phase 1–6), renderer-side jsdom unit tests (Phase 1–6), happy-dom setup (Phase 3+), integration smoke test runner gated by `RUN_SMOKE=1` (Phase 4 trim smoke).

---

## Manual-Only Verifications

These are automatable but gated on Windows hardware or manual visual review:

- [ ] **SPEC §Pitfall 7 RTL smoke (visual regression)** — Capture Playwright screenshots per route in RTL, diff against baseline. Manual review of any diff.
- [ ] **RPT-06 AR PDF visual inspection** — Open generated AR PDF in OS viewer; verify bidi ordering, numeric fragments stay LTR, signature bottom-right.
- [ ] **SET-05 backup visual** — Open created zip in Explorer; verify contains all expected files.
- [ ] **SET-06 restore preview UI** — Manual click-through of restore flow on Windows.

---

## Security Validation

> `workflow.security_enforcement = true` in `.planning/config.json`. ASVS Level 1, block on `high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| **V1 Architecture** | yes | Electron security baseline preserved: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — no Phase 7 renderer changes affect these. |
| **V4 Access Control** | yes (audit) | Audit page emits `audit_view` for compliance; no admin-only audit surface per D-05. |
| **V5 Input Validation** | yes (search + backup + restore) | All new IPC inputs validated via zod at the boundary (Phase 2 Fix 5). |
| **V7 Error Handling & Logging** | yes (audit) | All new events flow through `audit()` helper; no bypass paths. |
| **V8 Data Protection** | yes (backup zip) | D-15 path-traversal filter + D-16 integrity check. Backup zip is plaintext per D-09 (deferred: zip encryption v1.1). |
| **V10 Malicious Code** | yes (zip parsing) | D-15 + D-16 — yauzl entries rejected if unsafe; integrity check gates activate. |

### Threat Model Surface

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Zip-slip / path traversal in restore | Tampering | D-15: `safeEntryPath` rejects absolute/`..`/outside-staging-dir paths BEFORE write (Phase 5 P04 + ALLOWED_SUBDIRS pattern). |
| Partial-DB restore (silent corruption) | Tampering | D-16: `PRAGMA integrity_check` gates "Activate" button; backup uses `PRAGMA wal_checkpoint(TRUNCATE)` + `db.backup()`. |
| Renderer XSS via translated strings | Tampering | React escapes by default; i18next passes through React rendering. |
| Audit log bypass | Repudiation | Phase 2 Fix 6: one `audit()` helper; no other write paths. Phase 7 adds IPC channels that route through it. |
| Backup zip with crafted UTF-8 filenames | Information Disclosure | yauzl handles UTF-8 correctly; `fileName` decoded per zip spec. |

---

## Sampling Notes

- **Bilingual parity** (D-24): Vitest walks every EN key in `src/renderer/src/i18n/en/translation.json` and asserts key exists in `ar/translation.json`. **MUST** run before any UI plan merges.
- **Round-trip smoke** (D-27 + D-16): backup → restore → integrity check gates activate button. **MUST** run on Windows hardware before seal.
- **AR PDF smoke** (D-27): file size > 50KB + PDF magic bytes. **MUST** run before any Phase 7 plan with PDF changes merges.

---

*Validation strategy drafted 2026-08-10 from Phase 7 RESEARCH.md §Validation Architecture. Targets: 600+ tests across ~80 files; current baseline 559/72.*
