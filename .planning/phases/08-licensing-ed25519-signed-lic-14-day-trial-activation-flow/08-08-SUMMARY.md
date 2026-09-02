---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 08
subsystem: license
tags: [fix, cache-invalidation, gap-closure]
gap_closure: true
gap_ids: [G-08-2]
requires: [08-02]
provides: [post-wizard-cache-refresh]
status: complete
---

# Phase 8 Plan 8: Wizard cache invalidation + regression test (G-08-2 closure)

One-liner: After `wizardBootstrap` writes `settings.trial_started_at`, the memoized `getLicenseStatus()` cache now invalidates post-commit so the next IPC call returns `state: 'trial'` instead of the stale pre-wizard `'unactivated'` (which was wrongly firing the `LicenseGate` modal on fresh installs).

## Files Touched (3)

| File | Change |
|------|--------|
| `src/main/auth/index.ts` | Added `invalidateLicenseCache` import + post-commit call after `txn()` returns. Transaction boundary, audit row, settings row, doctor_profile row are **byte-identical** to pre-fix. |
| `tests/integration/license-cache-invalidation-on-wizard.test.ts` | **New** RUN_SMOKE=1-gated integration test. Mirrors the `license-trial-survives-reboot.test.ts` scaffold but warms `getLicenseStatus()` BEFORE `wizardBootstrap` so the cache-transition pathway is specifically exercised. |
| `package.json` | Appended `tests/integration/license-cache-invalidation-on-wizard.test.ts` to the `test:integration:smoke:phase8` script's file list. |

## Requirements Completed

- **LIC-01** — Fresh-install starts the 14-day trial. The cache-invalidation gap meant UAT Test 2 saw `state: 'unactivated'` post-wizard; with this fix, `state: 'trial'` reaches the renderer on the very next IPC.

## Gap Closed: G-08-2

Per `08-UAT-session.md` (line 124-128), the "missing" items for UAT Test 2 were:

1. ~~Next `getLicenseStatus()` after wizard returns fresh `state: 'trial'`~~ — **resolved** (this plan's `invalidateLicenseCache()` post-commit call).
2. ~~`LicenseGate` modal does NOT fire post-wizard~~ — **resolved transitively** because the modal keys off `state === 'unactivated'`; with fresh `state: 'trial'`, the `'Continue in trial'` / `'Activate now'` buttons no longer render.
3. ~~Regression test that warms the cache before the wizard~~ — **resolved** by `tests/integration/license-cache-invalidation-on-wizard.test.ts` (the existing reboot test only reads `getTrialState`, never `getLicenseStatus`, so it could not catch this).

## Verification Results

| Command | Result |
|---------|--------|
| `npm run typecheck:node` (filtered for `auth/index.ts`) | **no new errors** introduced by this change. (Pre-existing 7 errors in `src/main/db/reports-repo.ts`, `src/main/ipc/reports.ts`, `src/main/pdf/render-report-pdf.ts` from the untracked `20260812-redesign-report-procedure-type/` quick-plan work — out of scope per deviation rule §scope-boundary.) |
| `npm run test:unit -- --run tests/main/auth/wizard-bootstrap.test.ts` | **3/3 pass** (no regression to existing I18N-01 language-field tests) |
| `set RUN_SMOKE=1 && node scripts/run-vitest.cjs --run tests/integration/license-cache-invalidation-on-wizard.test.ts tests/integration/license-trial-survives-reboot.test.ts` | **5/5 pass** (2 new + 3 existing) |
| `grep -n "invalidateLicenseCache" src/main/auth/index.ts` | **2 hits**: line 13 (import) + line 135 (call site) — sanity check passed. |

### Negative-Control Evidence

Per `success_criteria` item #5 ("New test fails when Task 1's `invalidateLicenseCache()` call is removed — proves it's actually exercising the pathway"):

1. **Before comment-out:** new test 2/2 PASS, existing reboot test 3/3 PASS — total **5/5**.
2. **Commented out** `invalidateLicenseCache();` line in `src/main/auth/index.ts`:
   - **FAIL** in `tests/integration/license-cache-invalidation-on-wizard.test.ts`:
     - `cached state transitions from unactivated to trial after wizardBootstrap` — `AssertionError: expected 'unactivated' to be 'trial' // Object.is equality`
     - The sibling test (`license.trial_started audit row is written in the same transaction`) still PASSED (1 passed | 1 failed) — confirms the transaction contents are untouched.
   - **Total: 4/5 pass, 1 failed** — exact failure signature predicted by the plan.
3. **Restored** the line:
   - **PASS** again — **5/5** total.

This proves the test is NOT a tautology: it specifically detects the absence of the cache-invalidation call.

## Deviations from Plan

**None** — plan executed exactly as written.

Optional Task 2 action §3 in the plan's `<action>` block considered a "test the cached value BEFORE wizardBootstrap" assertion, then explicitly settled on the simpler observable-outcome approach (asserting post-wizard `getLicenseStatus()` returns `'trial'`). I took the simpler approach because the `cached` export is module-private (status.ts:25) and the observable-outcome assertion is sufficient — the negative-control proves this is the right granularity.

## Threat Model Coverage

| Threat ID | Disposition | This Plan's Mitigation |
|-----------|-------------|------------------------|
| T-08-08-T1 (Tampering, wizard cache invalidation) | mitigate | `invalidateLicenseCache()` called post-commit (matches `load-license.ts:119` precedent); integration test asserts post-wizard read returns fresh `state='trial'` not stale `'unactivated'` |
| T-08-08-T2 (Information Disclosure, stale state) | accept | UX-only bug, not a data leak; no PII / secret material exposed by staleness |
| T-08-08-T3 (Denial of Service, invalidation cost) | accept | `invalidateLicenseCache()` is a single `cached = null` assignment (status.ts:111); no IO, no async |

## Self-Check

- [x] `src/main/auth/index.ts` modified (verified via `grep`)
- [x] `tests/integration/license-cache-invalidation-on-wizard.test.ts` created (verified via `ls`)
- [x] `package.json` `test:integration:smoke:phase8` script updated
- [x] Commit `b8bedc2` exists in git log: `fix(08-08): invalidate license cache after wizard bootstrap (closes G-08-2)`
- [x] Commit `9b7ea0e` exists in git log: `test(08-08): cache-invalidation integration test + register in phase8 smoke`
- [x] Negative-control proves test exercises the cache pathway (FAIL when `invalidateLicenseCache()` commented out, PASS when restored)

## Self-Check: PASSED
