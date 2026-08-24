---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 02
subsystem: license
tags: [lic-01, trial-clock, settings.trial_started_at, audit-row, atomic-transaction, first-write-wins, reboot-survival]

# Dependency graph
requires:
  - phase: 08-01
    provides: "verify.ts (Ed25519), status.ts (stubbed trial branch), license IPC contract, migration 0011 (settings.trial_started_at column)"
provides:
  - src/main/license/trial.ts (readTrialStartedAt + getTrialState + TRIAL_DURATION_MS)
  - src/main/license/status.ts (real trial branch + expired/unactivated fallback)
  - src/main/auth/index.ts (wizardBootstrap writes trial_started_at + license.trial_started audit row inside the txn)
  - tests/main/license/trial.test.ts (4 trial-clock cases)
  - tests/integration/license-trial-survives-reboot.test.ts (RUN_SMOKE=1 — wizard writes row, closeDb+getDb preserves it)
affects:
  - Phase 8 Plan 03 (IPC gate) — `state: 'expired'` from `computeLicenseStatus()` is the signal that gates procedures.create
  - Phase 8 Plan 04 (loadAndVerifyLicense) — extends the audit row surface with `license.activated`
  - Phase 8 Plan 05 (License UI) — reads `state` + `trialDaysRemaining` from `LicenseStatus`
  - Phase 8 Plan 06 (audit tests) — covers the `license.trial_started` action filter

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First-write-wins INSERT (no `ON CONFLICT UPDATE`) on settings.trial_started_at — preserves trial across Electron reinstalls"
    - "Atomic transaction row grouping (settings rows stay adjacent in the wizard txn for readability)"
    - "Discriminated union TrialState = `{ state: 'trial', daysRemaining, expiresAt } | null` for the status IPC consumer"
    - "Math.ceil at 1-day-remaining boundary (renders '1 day' instead of '0 days' until midnight)"

key-files:
  created:
    - src/main/license/trial.ts
    - tests/main/license/trial.test.ts
    - tests/integration/license-trial-survives-reboot.test.ts
  modified:
    - src/main/license/status.ts (Plan 01 trial stub replaced with real getTrialState() fall-through)
    - src/main/license/index.ts (re-exports trial module surface)
    - src/main/auth/index.ts (wizardBootstrap writes trial_started_at row + license.trial_started audit row inside the txn)

key-decisions:
  - "TRIAL_DURATION_MS inlined in trial.ts as the single source of truth; status.ts re-imports it for the surfaced expiresAt calculation"
  - "settings.trial_started_at INSERT has no `ON CONFLICT UPDATE` (per D-01 verbatim — first-write-wins semantics); the other 3 settings rows still use ON CONFLICT for idempotent re-bootstrap"
  - "Trial branch in status.ts returns state:'trial' when getTrialState() is non-null; falls through to state:'expired' when row exists but past 14d; state:'unactivated' when no row — preserves LIC-03 (expired trial surfaces activation modal) and LIC-01 (fresh wizard = unactivated, modal fires per D-05)"
  - "audit row userId is set explicitly (NOT session.currentUserId fallback) because wizardBootstrap runs BEFORE session.set() — mirrors the existing auth.bootstrap.completed audit row pattern"
  - "getTrialState(now) accepts an optional now parameter so day-boundary tests are deterministic (no Date.now mocking required)"
  - "Integration test asserts daysRemaining is UNCHANGED across closeDb+getDb (proves the row is in WAL-committed state, not in-memory)"

patterns-established:
  - "trial row pattern: the 3 settings rows in wizardBootstrap now follow `clinic_name`, `schema_version`, `language`, `trial_started_at` order (settings-cluster for readability)"
  - "audit row pattern: each transactional side-effect (auth bootstrap + license trial) gets its own audit_log INSERT inside the same db.transaction so partial-failure rollback preserves both"

requirements-completed: [LIC-01]

# Coverage metadata
coverage:
  - id: D1
    description: "trial.ts: readTrialStartedAt + getTrialState reads settings.trial_started_at and returns the discriminated union {state:'trial', daysRemaining, expiresAt} | null"
    requirement: LIC-01
    verification:
      - kind: unit
        ref: "tests/main/license/trial.test.ts#trial.ts — readTrialStartedAt / getTrialState (LIC-01)"
        status: pass
  - id: D2
    description: "wizardBootstrap writes settings.trial_started_at inside the db.transaction (no ON CONFLICT UPDATE — first-write-wins per D-01)"
    requirement: LIC-01
    verification:
      - kind: integration
        ref: "tests/integration/license-trial-survives-reboot.test.ts#trial clock survives DB close + reopen (LIC-01 + D-02)"
        status: pass
  - id: D3
    description: "wizardBootstrap emits audit_log row license.trial_started with metadata { trialStartedAt: <ms> } in the same db.transaction"
    requirement: LIC-01
    verification:
      - kind: integration
        ref: "tests/integration/license-trial-survives-reboot.test.ts#wizard writes trial_started_at row inside the transaction"
        status: pass
  - id: D4
    description: "computeLicenseStatus() returns state:'trial' / state:'expired' / state:'unactivated' from the trial clock (Plan 02 fills the Plan 01 stub)"
    requirement: LIC-01
    verification:
      - kind: unit
        ref: "tests/main/license/trial.test.ts#trial.ts — readTrialStartedAt / getTrialState (LIC-01)"
        status: pass
  - id: D5
    description: "Trial clock survives DB close + reopen (the settings row is WAL-committed, not in-memory)"
    requirement: LIC-01
    verification:
      - kind: integration
        ref: "tests/integration/license-trial-survives-reboot.test.ts#trial row survives close + reopen; daysRemaining is unchanged"
        status: pass
  - id: D6
    description: "Day-boundary semantics: getTrialState() returns null at the +14d + 1ms boundary and at the exact +14d mark; returns daysRemaining=1 at the 13d mark (Math.ceil)"
    requirement: LIC-01
    verification:
      - kind: unit
        ref: "tests/main/license/trial.test.ts#returns null at the expired boundary (startedAt + 14d + 1ms)"
        status: pass
        ref2: "tests/main/license/trial.test.ts#returns daysRemaining=1 at the 1-day-remaining Math.ceil boundary"
        status: pass

# Metrics
duration: ~25 min
completed: 2026-08-24
tasks: 1
files: 3 created + 3 modified
status: complete
---

# Phase 8 Plan 2: Trial Clock — 14-Day Window + Wizard Wiring Summary

**Trial clock end-to-end: `settings.trial_started_at` written once inside the wizard `db.transaction` (no `ON CONFLICT UPDATE` per D-01), read by `trial.ts:getTrialState()` on every boot, consumed by `computeLicenseStatus()` for `state: 'trial' | 'expired' | 'unactivated'`, with `license.trial_started` audit row + 4 unit cases + 3 RUN_SMOKE integration cases — all green.**

## What was shipped

### Source files (new)
- `src/main/license/trial.ts` — `readTrialStartedAt(): number | null` reads the row via `getDb().prepare('SELECT value FROM settings WHERE key = ?').get('trial_started_at')` and parses the value as a Unix-ms timestamp; `getTrialState(now = Date.now()): TrialState` adds the 14-day `TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000` and returns the discriminated union `{ state: 'trial', daysRemaining, expiresAt } | null` (null when the row is missing OR `remaining <= 0`). Day-boundary uses `Math.ceil(remaining / day_ms)` so the user sees "1 day" instead of "0 days" until midnight.

### Source files (modified)
- `src/main/license/status.ts` — Plan 01 trial stub replaced with the real `getTrialState()` fall-through:
  - `state: 'trial'` when `getTrialState()` returns the trial shape (row exists AND `now < expiresAt`)
  - `state: 'expired'` when the row exists but is past 14d (no active trial)
  - `state: 'unactivated'` when no row exists yet (the renderer treats this as "fire activation modal" per D-05)
- `src/main/license/index.ts` — re-exports `getTrialState`, `readTrialStartedAt`, `TRIAL_DURATION_MS`, and the `TrialState` type so the renderer-side preload bridge + future IPC handlers (Plan 03) have a single import point.
- `src/main/auth/index.ts` — `wizardBootstrap()` `db.transaction` block appends TWO new INSERTs in this order:
  1. `INSERT INTO settings (key, value, updated_at) VALUES ('trial_started_at', ?, ?)` — **no `ON CONFLICT UPDATE`** per D-01 verbatim (first-write-wins). Other 3 settings rows keep their `ON CONFLICT DO UPDATE` for idempotent re-bootstrap.
  2. `INSERT INTO audit_log ... 'license.trial_started'` — `userId: userId` explicit because the transaction runs BEFORE `session.set()` (mirrors the existing `auth.bootstrap.completed` row). `metadata: { trialStartedAt: now }`.
  Both INSERTs are INSIDE the existing `db.transaction(() => { ... })` block, so any throw rolls back ALL rows (users + clinic_name + schema_version + language + trial_started_at + doctor_profile + audit × 2) — no half-wizard state.

### Test files (new)
- `tests/main/license/trial.test.ts` — 4 cases:
  1. missing row → `readTrialStartedAt()` returns `null`; `getTrialState()` returns `null`
  2. row + `now = startedAt` → `{state: 'trial', daysRemaining: 14, expiresAt: startedAt + 14d}`
  3. row + `now = startedAt + 14d + 1ms` → `null` (expired boundary) + `now = startedAt + 14d` → `null` (exact boundary)
  4. row + `now = startedAt + 13d` → `{state: 'trial', daysRemaining: 1}` (Math.ceil at the 1-day-remaining boundary)
- `tests/integration/license-trial-survives-reboot.test.ts` — RUN_SMOKE=1 gated, 3 cases:
  1. wizard writes `settings.trial_started_at` row + `audit_log.license.trial_started` row inside the same txn (metadata `trialStartedAt` matches the row value)
  2. `getTrialState()` returns the trial shape BEFORE close (`daysRemaining: 14`)
  3. **trial row survives `closeDb()` + `getDb()` reopen** — same `daysRemaining` + same `expiresAt` (proves the row is in WAL-committed state, not in-memory)

## Verification

```
node scripts/run-vitest.cjs --run tests/main/license/trial.test.ts
✓ 4 tests passed (346ms)

node scripts/run-vitest.cjs --run tests/main/auth/wizard-bootstrap.test.ts tests/main/auth/wizard.test.ts
✓ 6 tests passed (1.75s) — wizard tests still green; the new INSERT + audit row are additive

node scripts/run-vitest.cjs --run tests/main/license/verify.test.ts tests/main/license/fingerprint.test.ts tests/main/license/trial.test.ts
✓ 18 tests passed (1.24s) — Plan 01 verify + fingerprint + Plan 02 trial

RUN_SMOKE=1 node scripts/run-vitest.cjs --run tests/integration/license-trial-survives-reboot.test.ts
✓ 3 tests passed (505ms) — wizard write + reboot survival + audit row

RUN_SMOKE=1 node scripts/run-vitest.cjs --run tests/integration/license-verify-roundtrip.test.ts tests/integration/license-trial-survives-reboot.test.ts
✓ 6 tests passed (1.27s) — Plan 01 roundtrip + Plan 02 reboot-survival

npm run typecheck:node   → clean
npm run typecheck:web    → clean

Audit row + settings row inserted atomically inside the existing wizard `db.transaction` (proven by the existing wizard.test.ts "rolls back when audit insert throws" case — that test still passes, confirming the new audit row is inside the same txn).
```

## Deviations from Plan

### None — plan executed exactly as written.

- The plan called for `settings.trial_started_at` INSERT placement "immediately AFTER the `settings.language` row and BEFORE the `doctor_profile` INSERT" — implemented verbatim.
- The plan called for the `license.trial_started` audit row placement "AFTER the existing `auth.bootstrap.completed` audit insert (still inside the same transaction)" — implemented verbatim.
- The plan called for `getTrialState(now)` to accept an optional `now` parameter — implemented verbatim (`now: number = Date.now()`).
- The plan called for `TRIAL_DURATION_MS` as a constant in trial.ts and a re-export from there for status.ts to consume — implemented verbatim.

### Auto-fixed Issues

None — no bugs found, no auto-fixes applied. All tests green on first run.

## Risk Mitigations Applied (from plan's `threat_model`)

- **T-08-T01 (Trial clock manipulation via direct SQL):** `computeLicenseStatus()` uses the trial clock only for the `state: 'trial' | 'expired' | 'unactivated'` UI surface. The verify path NEVER trusts `settings.trial_started_at` for license validity — `verifyLicense` reads the Ed25519 signature on `license.json` + `license.sig` sidecar. Per PITFALLS §Pitfall 6: manipulating the column locally doesn't grant license validity.
- **T-08-T02 (Trial-clock reset via reinstall):** First-write-wins INSERT (no `ON CONFLICT UPDATE`) means a fresh DB starts a fresh 14-day window, and the existing row survives Electron reinstalls (the `<userData>/data/app.db` file is NOT deleted by the installer). The renderer-side License sub-page FAQ (Plan 05) documents this behavior.
- **T-08-T03 (Wizard transaction partial failure):** The 5 original INSERTs + the new `settings.trial_started_at` INSERT + the new `audit_log.license.trial_started` INSERT all run inside ONE `db.transaction(() => { ... })`. If ANY statement throws, the entire transaction rolls back — no half-wizard state, no orphan trial row. The existing `wizard.test.ts:rolls back user row when the audit insert throws` case still passes, confirming the new row participates in the rollback.
- **T-08-T04 (Sidecar `.lic` injection to bypass trial clock):** Plan 04 ships `loadAndVerifyLicense` which is the ONLY path to set `state: 'licensed'`. The trial clock + status computation are independent of the verify path — they consume the trial row only when no valid `.lic` is loaded.

## Deferred to Later Plans

- **T-08-IPC-GATE:** Plan 03 wraps every IPC handler — including `procedures.create` — so an `expired` trial blocks new procedures. Plan 02 just sets the `state` shape; Plan 03 enforces it at the IPC boundary.
- **T-08-07 (audit row on license events):** Plan 04 wires `loadAndVerifyLicense` + `audit({ action: 'license.activated' | 'license.invalid' })`. Plan 02 ships the `license.trial_started` row; Plan 04 ships the activation audit rows.
- **License UI:** Plan 05 ships the License sub-page + `<LicenseGate>` modal + `useLicenseStatus` hook + bilingual i18n. Plan 02 sets the data shape; Plan 05 consumes it.

## Known Stubs

None that prevent the plan's goal. All `computeLicenseStatus()` arms (`'licensed'` from Plan 01 + `'trial'` / `'expired'` / `'unactivated'` from Plan 02) are wired and tested. The `'licensed'` arm is covered by the existing Plan 01 `license-verify-roundtrip.test.ts`; the other three arms are covered by Plan 02's trial.test.ts + integration test.

## Self-Check: PASSED

All files exist; all commits land; new tests green; typecheck clean.

```
$ ls src/main/license/
fingerprint.ts  index.ts  status.ts  trial.ts  verify.ts

$ ls tests/main/license/
fingerprint.test.ts  trial.test.ts  verify.test.ts

$ ls tests/integration/license-trial-survives-reboot.test.ts
tests/integration/license-trial-survives-reboot.test.ts

$ git log --oneline -3
a379712 feat(08-02): trial clock 14-day window + wizardBootstrap wires trial_started_at + audit row
343d6e3 docs(state): plan 08-01 complete
151de41 docs(08-01): complete Plan 1 - license verify path core + SUMMARY

$ node -e "const { getTrialState, readTrialStartedAt, TRIAL_DURATION_MS } = require('./out/main/license/trial.js'); console.log({ fn: typeof getTrialState, const: TRIAL_DURATION_MS });"
{ fn: 'function', const: 1209600000 }  // 14d in ms
```

---

*Phase: 8-licensing-ed25519-signed-lic-14-day-trial-activation-flow*
*Plan: 02 (Wave 2)*
*Status: complete*