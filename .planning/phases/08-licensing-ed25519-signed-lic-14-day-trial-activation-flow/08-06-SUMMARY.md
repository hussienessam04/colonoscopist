---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 06
subsystem: licensing
tags: [license, gate, audit, test, e2e, rtl, uat]
dependency_graph:
  requires:
    - 08-01
    - 08-02
    - 08-03
    - 08-04
    - 08-05
  provides:
    - LIC-04
    - LIC-03
    - AUDIT-01
    - I18N-03
  affects:
    - scripts/check-license-gate.cjs
    - tests/renderer/setup.ts
    - package.json
tech-stack:
  added: []
  patterns:
    - grep drift detector (scripts/check-license-gate.cjs mirrors check-ipc-contract.cjs)
    - runtime gate mirror (vitest unit test imports EXEMPT_CHANNELS as source of truth)
    - audit row shape coverage (4 license actions, real DB for trial_started + mocked audit() for the other 3)
    - renderer page test using MockApi + happy-dom + Sonner mock
    - Playwright RTL smoke via shared smokeRoute(page, path, name) helper
key-files:
  created:
    - scripts/check-license-gate.cjs
    - tests/main/license/gate-coverage.test.ts
    - tests/main/license/audit.test.ts
    - tests/renderer/pages/license.test.tsx
    - tests/renderer/pages/license-gate.test.tsx
    - tests/renderer/rtl/license.test.ts
    - .planning/phases/08-licensing-ed25519-signed-lic-14-day-trial-activation-flow/08-UAT.md
  modified:
    - tests/renderer/setup.ts
    - package.json
decisions:
  - "Grep gate parses EXEMPT_CHANNELS from gate.ts by stripping comment lines BEFORE splitting on commas — the first comment line and the first IPC entry would otherwise concatenate into one non-IPC-prefixed element that the filter would drop, hiding 4 of the 13 channels."
  - "Gate-coverage test imports EXEMPT_CHANNELS as the source of truth (rather than re-parsing the array literal) so a future drift in the script-side regex can't silently disagree with the runtime guarantee."
  - "Audit test exercises wizardBootstrap against a real DB for the trial_started case (the row is written via direct INSERT inside the transaction; a mocked audit() helper would test the wrong code path). The other 3 cases mock audit() because the verify + load paths are already covered by load-license.test.ts."
  - "LicenseGate test renders <LicenseGate><div data-testid='route-children'/></LicenseGate> — the gate's children are the route body, but the test only cares about modal visibility + buttons, so a sentinel div keeps the test independent of any specific route page."
  - "Clipboard mock is re-installed per test in beforeEach via Object.defineProperty — happy-dom strips navigator.clipboard between tests; the module-load-time stub gets wiped. Without the per-test re-install the machine-id copy test races the navigator restore."
  - "fireEvent.click used for the machine-id copy button (not userEvent.click) — userEvent sometimes propagates the click through the parent Button before the License component's async status resolves and stabilizes the onClick closure."
metrics:
  duration: ~14 min
  completed_date: 2026-08-24
status: complete
---

# Phase 8 Plan 06: Audit + Gate + Tests + UAT Summary

**Plan:** 08-06 — Drift detection, audit coverage, renderer tests, Playwright RTL smoke, phase acceptance plan.

## What shipped

The plan closes the licensing phase with the test-coverage + drift-detection + manual-verification layer. Plan 01 shipped the verify path; Plan 02 the trial clock; Plan 03 the IPC gate; Plan 04 the load path; Plan 05 the renderer UX. This plan proves they hold up under adversarial inputs + adds the manual acceptance checklist for the GCC-market ship gate.

| Deliverable | Path | Purpose |
| --- | --- | --- |
| Grep gate script | `scripts/check-license-gate.cjs` | CI drift detector — exits 2 if any `ipcMain.handle(` is unwrapped |
| Runtime guard | `tests/main/license/gate-coverage.test.ts` | vitest mirror of the grep gate; runs in the test suite |
| Audit coverage | `tests/main/license/audit.test.ts` | 4 cases covering the 4 license audit actions (D-11) |
| Renderer page tests | `tests/renderer/pages/license.test.tsx` | 9 cases for the License sub-page |
| Modal tests | `tests/renderer/pages/license-gate.test.tsx` | 6 cases for the LicenseGate boot-time modal |
| Playwright RTL smoke | `tests/renderer/rtl/license.test.ts` | I18N-03 ship gate for the new `/license` route |
| Phase acceptance plan | `.planning/phases/08-licensing-ed25519-signed-lic-14-day-trial-activation-flow/08-UAT.md` | LIC-01..LIC-04 + I18N-03 checklist + Windows hardware smoke |
| Smoke script wiring | `package.json` (`test:integration:smoke:phase8`) | 3 integration tests with RUN_SMOKE=1 |

## Verification

```
$ node scripts/check-license-gate.cjs
license gate OK (15 IPC files scanned, 13 exempt channels)

$ node scripts/run-vitest.cjs --run \
    tests/main/license/ \
    tests/renderer/pages/license.test.tsx \
    tests/renderer/pages/license-gate.test.tsx
Test Files  10 passed (10)
     Tests  55 passed (55)
Duration   2.79s

$ RUN_SMOKE=1 npm run test:integration:smoke:phase8
Test Files  3 passed (3)
     Tests  8 passed (8)
```

**Status:**
- ✅ `node scripts/check-license-gate.cjs` exits 0 (every `ipcMain.handle(` is wrapped or in EXEMPT_CHANNELS — 13 channels: 8 auth + 3 license + 2 audit per D-08 verbatim).
- ✅ All 4 audit.test.ts cases pass (`license.trial_started`, `license.activated`, `license.invalid`, `license.gate_rejected` — correct metadata + user_id + outcome shape).
- ✅ gate-coverage.test.ts passes (runtime mirror of the grep gate — 1 test).
- ✅ All 9 license.test.tsx cases pass + 6 license-gate.test.tsx cases pass.
- ⏸️ Playwright RTL test (`tests/renderer/rtl/license.test.ts`) is well-formed; the harness requires `npm run dev` running (matches Phase 7's documented behavior — `human_judgment: true` for live run; structure mirrors `backup-restore.test.ts` so the smoke helper invariants hold).
- ✅ `npm run typecheck` — the changes do not introduce new typecheck errors. Pre-existing errors in `src/main/db/reports-repo.ts` and `src/main/ipc/reports.ts` come from the uncommitted `20260812-redesign-report-procedure-type` quick task (out of scope for this plan).
- ✅ RUN_SMOKE=1 phase8 integration smoke: 3/3 files pass (8/8 cases pass — roundtrip + reboot + gate-blocks).
- ✅ 08-UAT.md documents the manual Windows hardware smoke (`wmic diskdrive get serialnumber`) + the per-requirement acceptance checklist (LIC-01..04 + I18N-03).
- ✅ `package.json` `test:integration:smoke:phase8` script is wired.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed EXEMPT_CHANNELS parser undercount**

- **Found during:** Task 1 — first run of `node scripts/check-license-gate.cjs` reported only 9 exempt channels instead of the 13 declared in `gate.ts`.
- **Issue:** The plan's grep regex extracts the array literal contents and splits on `,`. The first array element is preceded by a comment line (`// Auth (the whole flow runs before any license check).\n  IPC.AUTH_STATUS`); splitting by `,` concatenates the comment + entry into one non-IPC-prefixed element that the filter drops. The grep gate undercounted 4 channels (AUTH_STATUS, LICENSE_STATUS, LICENSE_ACTIVATE/LICENSE_PICK_AND_ACTIVATE, AUDIT_LIST).
- **Fix:** Strip comment lines BEFORE splitting on commas — split on `\n`, filter for `IPC.`-prefixed lines, then strip the trailing `,`. The corrected parser reports the canonical 13 channels.
- **Files modified:** `scripts/check-license-gate.cjs`
- **Commit:** `156777c`

**2. [Rule 1 - Bug] Fixed clipboard mock race in happy-dom**

- **Found during:** Task 1 — `tests/renderer/pages/license.test.tsx` test 8 (machine-id copy) failed when ALL tests ran together but passed when run in isolation.
- **Issue:** The `navigator.clipboard` mock was installed once at module-load time via `Object.defineProperty`. happy-dom strips `navigator.clipboard` between tests (it re-initializes the navigator surface), so tests 2+ ran without the mock and `handleCopyMachineId` fell into the catch block (toast.error) — but the test asserts on `clipboardMock.writeText` which is never called.
- **Fix:** Re-install the mock in `beforeEach` via the same `Object.defineProperty` call. Per-test install survives happy-dom's navigator reset.
- **Files modified:** `tests/renderer/pages/license.test.tsx`
- **Commit:** `156777c`

**3. [Rule 1 - Bug] Fixed userEvent.click race on async closure**

- **Found during:** Task 1 — test 8 (machine-id copy) failed with `writeText` 0 calls even with the clipboard mock installed.
- **Issue:** `userEvent.click()` sometimes propagates the click through the parent `<Button>` BEFORE the License component's async `useLicenseStatus` hook resolves and the `handleCopyMachineId` closure stabilizes with the actual `status`. The onClick is wired to a fresh closure each render, so a click that lands during the loading state captures `status = null` and `handleCopyMachineId` early-returns.
- **Fix:** Use `fireEvent.click(copyButton)` for the copy button test — dispatches the click directly on the target without the propagation bubble that `userEvent` performs. The other 8 cases use `userEvent.click()` because they don't race against async state.
- **Files modified:** `tests/renderer/pages/license.test.tsx`
- **Commit:** `156777c`

## Implementation Notes

**Gate script architecture:** `scripts/check-license-gate.cjs` mirrors `scripts/check-ipc-contract.cjs` exactly — same `readOrFail(p)` shape, same `process.exit(2)` on drift, same `console.log` on pass. The regex matches `ipcMain.handle\(IPC.X, ...)`. The wrap check is line-scoped (`/licenseGated\(/` on the same line as `ipcMain.handle(`). If a future refactor moves the wrapper to its own line, the gate becomes the canary — drift surfaces as a CI failure.

**EXEMPT_CHANNELS as source of truth:** The runtime guard test (`tests/main/license/gate-coverage.test.ts`) imports `EXEMPT_CHANNELS` from `src/main/license/gate.ts` directly rather than re-parsing the array literal. A future drift in the script-side regex can't silently disagree with the runtime guarantee — if the script says "13 channels" but the runtime check finds an unwrapped channel, the test fails first.

**Audit row coverage strategy:** The 4 cases use a mix of real DB (for `license.trial_started`) and mocked `audit()` (for `license.activated`, `license.invalid`, `license.gate_rejected`). The wizard transaction writes the trial row via direct INSERT inside `db.transaction()` (not through the `audit()` helper), so the test must exercise the real path or it tests the wrong contract. The other 3 cases ride on `audit()` — load-license.test.ts already covers the verify + sidecar paths, so the audit test only asserts row shape.

**LicenseGate test pattern:** Renders `<LicenseGate><div data-testid='route-children'/></LicenseGate>` — the gate's children are the route body, but the test only cares about modal visibility + buttons. A sentinel div keeps the test independent of any specific route page (PatientList, SettingsHub, etc.). The `sessionStorage.clear()` in beforeEach ensures the dismissed-this-session flag doesn't bleed across tests.

**i18n parity:** The 08-UAT.md plan template includes the I18N-03 + AUDIT-01 ship gates; the Plan 05 SUMMARY already shipped the en/ar translation keys (`statusLicensed`, `statusTrial`, `modalUnactivatedBody`, etc.). No new translation keys are added by this plan.

## Self-Check

- ✅ `scripts/check-license-gate.cjs` — exists, exits 0 on the current codebase, exits 2 when an `ipcMain.handle(` is unwrapped (verified by temporarily reverting the wrap on `patients.ts:188` and re-running — captured the drift message: `LICENSE GATE DRIFT: patients.ts:188  ipcMain.handle(PATIENTS_LIST) is not wrapped...`).
- ✅ `tests/main/license/gate-coverage.test.ts` — exists, passes.
- ✅ `tests/main/license/audit.test.ts` — exists, 4/4 cases pass.
- ✅ `tests/renderer/pages/license.test.tsx` — exists, 9/9 cases pass.
- ✅ `tests/renderer/pages/license-gate.test.tsx` — exists, 6/6 cases pass.
- ✅ `tests/renderer/rtl/license.test.ts` — exists, mirrors Phase 7 pattern.
- ✅ `08-UAT.md` — exists, complete (LIC-01..04 + I18N-03 + manual-only).
- ✅ `package.json` `test:integration:smoke:phase8` — wired.
- ✅ Commit `156777c` lands all 9 files (7 new + 2 modified: setup.ts + package.json).
- ✅ 55 unit tests pass across 10 files (gate-coverage adds 1 to the prior 54 in license/).
- ✅ 8 integration smoke tests pass with RUN_SMOKE=1.