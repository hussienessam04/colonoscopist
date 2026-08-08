---
phase: 6
slug: doctor-profile-report-editor-pdf-generation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-08
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x |
| **Config file** | `vitest.config.ts` (existing, Phase 1) |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm run test:unit` (single command — no separate integration tier; trim-smoke test is opt-in via `RUN_SMOKE=1`) |
| **Estimated runtime** | ~60 seconds (current Phase 5 baseline: 520/520 tests across 65 files) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit`
- **After every plan wave:** Run `npm run test:unit`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | PROF-01, PROF-02 | T-06-01 | Doctor profile row readable only by session owner; signature/logo paths userData-relative to prevent absolute-path leakage in audit metadata | unit | `npm run test:unit -- tests/main/db/doctor-profile-repo.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | RPT-01, RPT-04 | T-06-02 | UNIQUE on reports.procedure_id enforced at DB level; finalize lock denies UPDATE on `procedure_id`/`doctor_id`/`finalized_at`/`created_at` post-finalize | unit | `npm run test:unit -- tests/main/db/reports-repo.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | RPT-03 | T-06-03 | report_screenshots sort_order validated to be within range; FK ON DELETE CASCADE verified | unit | `npm run test:unit -- tests/main/db/report-screenshots-repo.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | RPT-01, RPT-04 | T-06-04 | Renderer auto-save-on-blur is debounced; IPC contract rejects direct doctor_id in payload (Phase 2 BLOCKER 4) | unit | `npm run test:unit -- tests/renderer/pages/report-editor.test.tsx` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | PROF-01 | T-06-05 | Profile editor validates PNG/JPEG magic bytes at IPC boundary before writing to disk (no `mime-types` dep) | unit | `npm run test:unit -- tests/main/ipc/profile-upload.test.ts` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 3 | RPT-05, RPT-07 | T-06-06 | PDF written under `<userData>/data/reports/<reportId>.pdf`; `electron.shell.openPath` called via IPC handler not direct renderer access | unit | `npm run test:unit -- tests/main/pdf/report.test.tsx` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 3 | RPT-06 | T-06-07 | PDF smoke test renders EN sample; numeric fragments (MRN) preserved in correct order; logo top-left + signature top-right at fixed pixel dimensions | integration (opt-in) | `RUN_SMOKE=1 npm run test:integration:smoke` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/main/db/doctor-profile-repo.test.ts` — stubs for REQ-{PROF-01, PROF-02}
- [ ] `tests/main/db/reports-repo.test.ts` — stubs for REQ-{RPT-01, RPT-04}
- [ ] `tests/main/db/report-screenshots-repo.test.ts` — stubs for REQ-RPT-03
- [ ] `tests/renderer/pages/report-editor.test.tsx` — stubs for REQ-{RPT-01, RPT-04}
- [ ] `tests/main/ipc/profile-upload.test.ts` — stubs for REQ-PROF-01
- [ ] `tests/main/pdf/report.test.tsx` — stubs for REQ-{RPT-05, RPT-07}
- [ ] `tests/integration/pdf-smoke.test.ts` — opt-in smoke test for REQ-RPT-06

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PDF Arabic RTL bidi (numeric fragments + signature position) | RPT-06 | Out of scope per D-10 (deferred to Phase 7 i18n); Phase 6 PDF is EN-only | n/a — Phase 7 owns this verification |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
