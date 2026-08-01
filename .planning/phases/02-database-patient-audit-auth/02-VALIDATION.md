---
phase: 2
slug: database-patient-audit-auth
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-01
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.x (already installed) |
| **Config file** | `vitest.config.ts` (Wave 0 — may exist as stub from Phase 1) |
| **Quick run command** | `npm run test:unit -- --run --reporter=basic` |
| **Full suite command** | `npm test` + `node scripts/run-full-smoke.cjs` |
| **Estimated runtime** | ~30s for unit suite; ~60s for full suite |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- --run`
- **After every plan wave:** Run full suite + smoke script
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD by planner | 02-01 | 1 | AUTH-01 | T-02-AUTH-01 | Login with correct PIN succeeds; wrong PIN rejects | unit (main) | `vitest run tests/main/auth/login.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-01 | 1 | AUTH-01 | T-02-AUTH-01 | User list shows all non-deleted users | unit (main) | `vitest run tests/main/auth/users-list.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-01 | 1 | AUTH-02 | T-02-AUTH-02 | 5 failures → 1s, 2s, 4s, 8s, 16s backoff; 10 failures → locked | unit (main) | `vitest run tests/main/auth/rate-limit.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-01 | 1 | AUTH-02 | T-02-AUTH-02 | Locked user gets `IPC_LOCKED` even with correct PIN | unit (main) | (same file as above) | ❌ W0 | ⬜ pending |
| TBD by planner | 02-01 | 1 | AUTH-03 | T-02-AUDIT-01 | Every login attempt (success + failure) writes an `audit_log` row | unit (main) | `vitest run tests/main/audit/log-on-login.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-01 | 1 | AUTH-04 | T-02-AUTH-04 | `session.currentUserId` is `null` after `app.whenReady()` | unit (main) | `vitest run tests/main/session.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-02 | 1 | PAT-01 | — | Create patient with all 6 fields persists; missing required field rejected | unit (main) | `vitest run tests/main/patients/create.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-02 | 1 | PAT-02 | — | Search by name substring (case-insensitive) returns matches; MRN exact match returns single row | unit (main) | `vitest run tests/main/patients/search.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-02 | 1 | PAT-03 | T-02-PAT-03 | Get / update / soft-delete a patient; soft-deleted patient invisible in default list | unit (main) | `vitest run tests/main/patients/crud.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-02 | 1 | PAT-04 | T-02-PAT-04 | Soft-delete sets `deleted_at`; no hard delete possible; restore is admin-only | unit (main) | (same file as above) | ❌ W0 | ⬜ pending |
| TBD by planner | 02-01 | 1 | AUDIT-01 | T-02-AUDIT-01 | Every mutation writes an `audit_log` row in the same transaction | unit (main) | `vitest run tests/main/audit/every-mutation.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-01 | 1 | AUDIT-02 | T-02-AUDIT-02 | `UPDATE audit_log SET ...` raises ABORT; `DELETE FROM audit_log WHERE ...` raises ABORT | unit (main) | `vitest run tests/main/audit/append-only.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-01 | 1 | D-01 | — | Wizard commits admin user + clinic_name atomically | unit (main) | `vitest run tests/main/auth/wizard.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-01 | 1 | D-02 | T-02-AUTH-04 | Only the first user has `is_first_admin = 1`; second user via `users:create` has `0` | unit (main) | (same file as above) | ❌ W0 | ⬜ pending |
| TBD by planner | 02-03 | 2 | Login UX | — | Renders user list; tapping a row shows PIN entry; back arrow returns; "Forgot admin PIN?" link present | component | `vitest run tests/renderer/pages/login.test.tsx` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-03 | 2 | Patient List UX | — | Renders rows; search input filters; "Show deleted" toggle reveals soft-deleted with badge; "+ New patient" opens form | component | `vitest run tests/renderer/pages/patients.test.tsx` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-03 | 2 | Settings → Users | T-02-V4 | Lists users; "Add user" opens dialog; "Reset PIN" requires admin; "Remove" soft-confirms | component | `vitest run tests/renderer/pages/settings-users.test.tsx` | ❌ W0 | ⬜ pending |
| TBD by planner | 02-03 | 2 | Smoke | — | Cold start with empty DB → wizard → restart → login → patient list | e2e (manual) | `node scripts/run-full-smoke.cjs` (extended) | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — Vitest config with `tests/main/**/*.test.ts` (node env) and `tests/renderer/**/*.test.{ts,tsx}` (happy-dom env)
- [ ] `tests/main/setup.ts` — temp `dataDir()` + auto-cleanup before/after each test
- [ ] `tests/main/auth/login.test.ts`
- [ ] `tests/main/auth/rate-limit.test.ts`
- [ ] `tests/main/auth/users-list.test.ts`
- [ ] `tests/main/auth/wizard.test.ts`
- [ ] `tests/main/session.test.ts`
- [ ] `tests/main/patients/create.test.ts`
- [ ] `tests/main/patients/search.test.ts`
- [ ] `tests/main/patients/crud.test.ts`
- [ ] `tests/main/audit/log-on-login.test.ts`
- [ ] `tests/main/audit/every-mutation.test.ts`
- [ ] `tests/main/audit/append-only.test.ts`
- [ ] `tests/renderer/setup.ts` — happy-dom + `@testing-library/react` cleanup
- [ ] `tests/renderer/pages/login.test.tsx`
- [ ] `tests/renderer/pages/patients.test.tsx`
- [ ] `tests/renderer/pages/settings-users.test.tsx`
- [ ] Update `scripts/run-full-smoke.cjs` to also exercise the cold-start-with-empty-DB → wizard → restart → login flow

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wizard copy + field order | D-01 | Cosmetic / UX polish | Run app on empty DB; verify name + clinic name + PIN + confirm field order reads naturally |
| Avatar color cycling | D-06 | Visual | Confirm multiple users get visually distinct colored circles |
| Last-login relative time | Discretion | Visual | "last seen 2h ago" / "yesterday" / "never" render correctly |
| "Forgot admin PIN?" mailto: handoff | D-04 | Browser + email | Click link on login screen; verify mailto opens with machine fingerprint in subject/body |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
