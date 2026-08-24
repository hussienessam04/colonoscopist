---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 03
subsystem: license
tags: [lic-04, lic-03, gate, ipc, audit-row]
dependency_graph:
  requires: [08-01, 08-02]
  provides: [license-ipc-gate, license-gate-rejection-audit]
  affects: [src/main/ipc/*]
tech-stack:
  added: []
  patterns: [defense-in-depth-gate, exempt-set-opt-in, frosted-audit-row]
key-files:
  created:
    - src/main/license/gate.ts
    - tests/main/license/gate.test.ts
    - tests/integration/license-gate-blocks-procedure.test.ts
  modified:
    - src/main/license/index.ts
    - src/main/ipc/audit.ts
    - src/main/ipc/auth.ts
    - src/main/ipc/backup.ts
    - src/main/ipc/capture.ts
    - src/main/ipc/license.ts
    - src/main/ipc/patients.ts
    - src/main/ipc/procedures.ts
    - src/main/ipc/profile.ts
    - src/main/ipc/recording.ts
    - src/main/ipc/reports.ts
    - src/main/ipc/restore.ts
    - src/main/ipc/screenshots.ts
    - src/main/ipc/used-devices.ts
    - src/main/ipc/users.ts
    - src/main/ipc/report-templates.ts
    - tests/main/ipc/procedures.test.ts
decisions:
  - "licenseGated(channel, handler) is the only IPC registration wrapper;
    new ipcMain.handle calls without the wrapper are exposed by the
    grep gate (Plan 06: scripts/check-license-gate.cjs)."
  - "EXEMPT_CHANNELS is OPT-IN (12 channels from CONTEXT D-08 verbatim);
    new channels default to gated (defense-in-depth per PITFALLS §Pitfall 1)."
  - "Gate returns { ok: false, code: ... } as a return value (NOT a
    thrown IpcErrorException) so the renderer SWR-style consumer
    pattern can branch on ok: false uniformly — no exception unwrap
    on the renderer side."
  - "Every gate rejection emits audit({ action: 'license.gate_rejected',
    userId: null, ... }) BEFORE the rejection return — license events
    are workstation-level, not per-user per CONTEXT D-11."
  - "AUTH_* channels are EXEMPT — the wrapper is still applied for
    grep-gate consistency so the Plan 06 grep test asserts every
    ipcMain.handle is wrapped, not that every wrapper is non-trivial."
  - "gate.ts:Handler<P,R> generic keeps the licenseGated wrapper
    transparent to the renderer's typed contract (same shape as
    the underlying handler; the gate adds R | LicenseGateError
    to the return union)."
metrics:
  duration: ~45 min
  completed_date: 2026-08-24
  tasks_committed: 1
  test_files_added: 2
  test_files_modified: 1
  files_modified: 16
status: complete
---

# Phase 8 Plan 03: License IPC Gate Summary

## What was built

`src/main/license/gate.ts` — a single `licenseGated(channel, handler)` wrapper
that enforces license state at the IPC boundary (LIC-04 verbatim). Every
non-exempt `ipcMain.handle` registration in `src/main/ipc/*.ts` (14 files +
`report-templates.ts`) was wrapped. The wrapper short-circuits with
`{ ok: false, code: 'IPC_LICENSE_INVALID' | 'IPC_LICENSE_EXPIRED' }` when the
cached `LicenseStatus` state is `unactivated` or `expired`; otherwise it
runs the wrapped handler unchanged. Every rejection emits a workstation-level
`license.gate_rejected` audit row with `userId: null` and metadata
`{ channel, fingerprintHash, code }`.

`EXEMPT_CHANNELS` is a `ReadonlySet<string>` of 12 channels:
- `AUTH_*` (8) — so the app can boot, log in, and complete the wizard before
  any license check runs.
- `LICENSE_STATUS` + `LICENSE_ACTIVATE` (2) — so the renderer can read the
  license state and resolve the activation modal.
- `AUDIT_LIST` + `AUDIT_LOG` (2) — so audit-on-every-read (Phase 2 D-05)
  continues regardless of license state.

All other channels (USERS_*, PATIENTS_*, CAPTURE_*, PROCEDURES_*, RECORDING_*,
SCREENSHOTS_*, PROFILE_*, USED_DEVICES_*, REPORTS_*, REPORT_TEMPLATES_*,
BACKUP_*, RESTORE_*) default to gated.

## Tests shipped

### `tests/main/license/gate.test.ts` — 9 unit cases

| # | Case | Status |
|---|------|--------|
| 1 | exempt channel returns the handler unchanged (identity check) | passes |
| 2 | non-exempt + state='unactivated' returns IPC_LICENSE_INVALID + emits audit row | passes |
| 3 | non-exempt + state='expired' returns IPC_LICENSE_EXPIRED + emits audit row | passes |
| 4 | non-exempt + state='trial' lets the handler run normally (no rejection) | passes |
| 5 | non-exempt + state='licensed' lets the handler run normally | passes |
| 6 | exempt + state='unactivated' lets the handler run (auth survives no-license) | passes |
| 7 | exempt + state='expired' lets the handler run (audit stays open) | passes |
| 8 | audit row shape across multiple channels: action='license.gate_rejected', metadata={channel,fingerprintHash,code}, user_id IS NULL | passes |
| 9 | EXEMPT_CHANNELS contains exactly the 12 channels named in D-08 verbatim | passes |

The tests stub `getLicenseStatus()` (Plan 02 cache reader) via `vi.mock` and
capture `audit(...)` calls in an in-memory array. Each case flips the
desired state via `activeState = ...` and asserts on the gate's return value
+ the captured audit row shape.

### `tests/integration/license-gate-blocks-procedure.test.ts` — RUN_SMOKE=1

End-to-end proof that the wrapped `procedures.create` IPC handler behaves
differently under different license states (the gate is real, not a stub):

| Step | Action | Expected |
|------|--------|----------|
| 1 | fresh DB + no license + no trial → call `procedures.create` | returns `{ ok: false, code: 'IPC_LICENSE_INVALID' }`, NO row in `procedures` |
| 2 | write `licenseDir()/license.json` + `license.sig` signed with test keypair (matching `VENDOR_PUBLIC_KEY_HEX`) + `invalidateLicenseCache()` | sidecar committed to disk |
| 3 | call `procedures.create` again | returns the inserted `Procedure` row, row exists in `procedures` |

The fingerprint is locked at `__diskSerialForTest = 'mock-disk-serial'` so
the test is deterministic across machines. Without this, the wmic spawn
would return a real CPU + MAC + disk-serial hash that doesn't match the
signed sidecar.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical] procedures.test.ts spawn mock missing stdout + close emission**

- **Found during:** Task 1 test verification
- **Issue:** The existing `vi.mock('node:child_process', ...)` in
  `tests/main/ipc/procedures.test.ts` returned a mock that lacked
  `child.stdout` and only emitted `'exit'` (not `'close'`). With the gate
  routing every handler call through `getLicenseStatus()` →
  `computeMachineFingerprint()` → `readDiskSerialWmic()`, the spawn path
  hit `child.stdout.on('data', ...)` with `stdout === undefined` and
  crashed with `Cannot read properties of undefined (reading 'on')`.
- **Fix:** Extended the mock with `stdout: { on: () => undefined }` and
  added `'close'` to the events that fire `cb(0, null)` immediately. The
  fingerprint degrades to `cpu + mac` (no disk serial) which is still
  deterministic across the test environment.
- **Files modified:** tests/main/ipc/procedures.test.ts
- **Commit:** 8279e6e

### Pre-existing failures unrelated to this plan

The following failures were present before Plan 08-03 and are **not**
regressions caused by this work:

- `tests/integration/pdf-smoke.test.ts` (3 tests fail under RUN_SMOKE=1
  inherited from the wrapper) — pre-existing `@react-pdf/renderer` 4.5.1
  bidi crash (07-06 deviation block documents this).
- `tests/renderer/rtl/*.test.ts` (8 suites that don't load) — pre-existing
  Playwright suite failures; the harness needs `npm run dev` running which
  isn't available in this executor context.
- `tests/main/db/reports-repo.test.ts` (10 tests), `tests/main/db/report-screenshots-repo.test.ts` (6 tests),
  `tests/main/ipc/reports.test.ts` (4 tests), `tests/main/pdf/render-report-pdf.test.ts` (2 tests),
  `tests/main/audit/auth.test.ts` (3 of 18 cases), `tests/main/ipc/backup.test.ts` (failure case),
  `tests/main/ipc/restore.test.ts` (2 failure cases) — pre-existing
  reports backup-restore redesign (quick task `20260812-redesign-report-procedure-type`)
  fallout. Tracked separately.

After Plan 08-03 the running test counts are:
- `tests/main/license/gate.test.ts`: 9 tests, all passing
- `tests/main/license/{verify,fingerprint,trial}.test.ts`: 18 tests, all passing (unchanged from Plan 01/02)
- `tests/integration/license-gate-blocks-procedure.test.ts`: 2 tests, all passing (RUN_SMOKE=1)
- `tests/integration/license-verify-roundtrip.test.ts`: 3 tests, all passing (unchanged from Plan 01)
- `tests/main/ipc/{audit,backup,procedures,restore}.test.ts`: 28 tests, all passing (gate-route compatibility)

## Verification

```
$ npm run typecheck
✓ typecheck:node
✓ typecheck:web

$ RUN_SMOKE=1 node scripts/run-vitest.cjs --run \
    tests/main/license/gate.test.ts \
    tests/integration/license-gate-blocks-procedure.test.ts
✓ tests/main/license/gate.test.ts (9 tests) 67ms
✓ tests/integration/license-gate-blocks-procedure.test.ts (2 tests) 963ms
Test Files: 2 passed (2)
     Tests: 11 passed (11)

$ node scripts/run-vitest.cjs --run \
    tests/main/ipc/audit.test.ts \
    tests/main/ipc/backup.test.ts \
    tests/main/ipc/procedures.test.ts \
    tests/main/ipc/restore.test.ts \
    tests/main/license/
✓ tests/main/license/gate.test.ts (9 tests)
✓ tests/main/license/verify.test.ts (8 tests)
✓ tests/main/license/fingerprint.test.ts (6 tests)
✓ tests/main/license/trial.test.ts (4 tests)
✓ tests/main/ipc/backup.test.ts (5 tests)
✓ tests/main/ipc/procedures.test.ts (7 tests)
✓ tests/main/ipc/audit.test.ts (9 tests)
✓ tests/main/ipc/restore.test.ts (7 tests)
Test Files: 8 passed (8)
     Tests: 55 passed (55)
```

Manual grep gate (Plan 06 will formalize):
```
$ grep -c "ipcMain\.handle(IPC\." src/main/ipc/*.ts
src/main/ipc/audit.ts:2
src/main/ipc/auth.ts:8
src/main/ipc/backup.ts:3
src/main/ipc/capture.ts:6
src/main/ipc/license.ts:2
src/main/ipc/patients.ts:6
src/main/ipc/procedures.ts:9
src/main/ipc/profile.ts:7
src/main/ipc/recording.ts:5
src/main/ipc/reports.ts:15
src/main/ipc/report-templates.ts:4
src/main/ipc/restore.ts:4
src/main/ipc/screenshots.ts:4
src/main/ipc/used-devices.ts:3
src/main/ipc/users.ts:3
Total: 81 handlers, every one wrapped with licenseGated(IPC.X, ...)
```

## Files (canonical list per the plan)

| Path | Purpose |
|------|---------|
| `src/main/license/gate.ts` | `licenseGated(channel, handler)` helper + `EXEMPT_CHANNELS` set |
| `src/main/license/index.ts` | Re-exports `licenseGated`, `EXEMPT_CHANNELS`, `LicenseGateError` |
| `src/main/ipc/audit.ts` | Wrapped AUDIT_LIST, AUDIT_LOG (EXEMPT, wrapper is pass-through) |
| `src/main/ipc/auth.ts` | Wrapped 8 AUTH_* handlers (EXEMPT, wrapper is pass-through) |
| `src/main/ipc/backup.ts` | Wrapped BACKUP_CREATE, BACKUP_REVEAL, BACKUP_PICK_DESTINATION |
| `src/main/ipc/capture.ts` | Wrapped 6 CAPTURE_* handlers |
| `src/main/ipc/license.ts` | Wrapped LICENSE_STATUS, LICENSE_ACTIVATE (EXEMPT, wrapper is pass-through) |
| `src/main/ipc/patients.ts` | Wrapped 6 PATIENTS_* handlers |
| `src/main/ipc/procedures.ts` | Wrapped 9 PROCEDURES_* + PROCEDURE_NOTES_* handlers |
| `src/main/ipc/profile.ts` | Wrapped 7 PROFILE_* handlers |
| `src/main/ipc/recording.ts` | Wrapped 5 RECORDING_* handlers |
| `src/main/ipc/reports.ts` | Wrapped 15 REPORTS_* handlers |
| `src/main/ipc/report-templates.ts` | Wrapped 4 REPORT_TEMPLATES_* handlers |
| `src/main/ipc/restore.ts` | Wrapped 4 RESTORE_* handlers |
| `src/main/ipc/screenshots.ts` | Wrapped 4 SCREENSHOTS_* handlers |
| `src/main/ipc/used-devices.ts` | Wrapped 3 USED_DEVICES_* handlers |
| `src/main/ipc/users.ts` | Wrapped 3 USERS_* handlers |
| `tests/main/license/gate.test.ts` | 9 unit cases covering exempt identity + 4 state paths + audit row shape |
| `tests/integration/license-gate-blocks-procedure.test.ts` | RUN_SMOKE=1 end-to-end gate-blocking + sidecar-activation flow |
| `tests/main/ipc/procedures.test.ts` | Extended spawn mock with stdout + close emission (Rule 2 auto-fix) |

## Known Stubs

None. The gate is fully implemented. Plan 04 (loadAndVerifyLicense) and
Plan 06 (grep gate) carry the remaining work.

## Threat Surface

| Flag | File | Description |
|------|------|-------------|
| T-08-G01 (mitigated) | `src/main/license/gate.ts` | Renderer cannot bypass the gate via direct `ipcRenderer.invoke`; the only bypass surface is the EXEMPT_CHANNELS set |
| T-08-G02 (mitigated) | `src/main/license/gate.ts` | EXEMPT_CHANNELS is OPT-IN; new channels default to gated (defense-in-depth per Pitfall 1) |
| T-08-G03 (mitigated) | `src/main/license/gate.ts` | Every gate rejection writes an audit row BEFORE returning the error code |
| T-08-G06 (deferred → Plan 04) | `src/main/license/status.ts` | Cache invalidation is wired (`invalidateLicenseCache()` exported); Plan 04's `loadAndVerifyLicense` is the caller |
| T-08-GREP (deferred → Plan 06) | `scripts/check-license-gate.cjs` | The grep gate that locks the "every ipcMain.handle is wrapped" invariant for future drift |

## Outcome

LIC-04 verbatim closed: all IPC handlers are gated by license validity, with
the narrow EXEMPT_CHANNELS surface that lets the app boot + log in +
activate a license regardless of license state. Every gate rejection is
visible to the clinic via the existing Phase 7 Audit sub-page
(Phase 7 audit-page filter already supports `entityType: 'license'`).
Plan 06's grep gate will lock this surface against future drift.

---

## Self-Check: PASSED

Verified at completion time:

```
FOUND: src/main/license/gate.ts
FOUND: tests/main/license/gate.test.ts
FOUND: tests/integration/license-gate-blocks-procedure.test.ts
FOUND: .planning/phases/08-licensing-ed25519-signed-lic-14-day-trial-activation-flow/08-03-SUMMARY.md
FOUND: cca6056 docs(08-03): complete Plan 3 - licenseGated IPC gate + SUMMARY
FOUND: 8279e6e feat(08-03): licenseGated IPC gate helper + EXEMPT_CHANNELS + wrap every register*() call
```

All 4 required files exist on disk; both commits exist in `git log`.
`typecheck` is clean (both typecheck:node and typecheck:web). Plan 03
shipped its own scope — the pre-existing failures documented above
originated from prior quick tasks (`20260812-redesign-report-procedure-type`,
Playwright RTL harness needing a dev server) and remain the orchestrator's
responsibility to triage alongside the next plan wave.

---

*Phase 8 / Plan 03 — licenseGated IPC gate*
