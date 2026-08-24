---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 01
subsystem: license
tags: [lic-02, ed25519, verify-path, tracer, ipc-contract, frozen-exports, fingerprint, migration-0011]
dependency_graph:
  requires: []
  provides:
    - src/main/license/verify.ts
    - src/main/license/fingerprint.ts
    - src/main/license/status.ts
    - src/main/license/index.ts
    - src/main/ipc/license.ts
    - src/main/db/migrations/0011_settings_trial_started_at.sql
    - src/shared/ipc-contract.ts#IPC.LICENSE_STATUS
    - src/shared/ipc-contract.ts#IPC.LICENSE_ACTIVATE
    - src/shared/ipc-contract.ts#LicenseStatus
    - src/preload/index.ts#api.license
    - src/main/paths.ts#licenseDir
    - tests/main/license/verify.test.ts
    - tests/main/license/fingerprint.test.ts
    - tests/integration/license-verify-roundtrip.test.ts
  affects:
    - src/main/index.ts (wires registerLicenseIpc)
    - src/main/db/migrations.ts (registers migration 0011)
    - src/shared/errors.ts (IPC_LICENSE_INVALID + IPC_LICENSE_EXPIRED)
    - src/shared/validators.ts (licenseActivateInput zod schema)
tech-stack:
  added:
    - "@noble/ed25519 ^3.1.0 (pure-JS Ed25519, no native rebuild)"
    - "@noble/hashes ^2.3.0 (SHA-256 + SHA-512 for fingerprint + ed25519 internal)"
  patterns:
    - Object.freeze on exported verifier function (per PITFALLS §Pitfall 6)
    - SHA-512 hookup (`ed.hashes.sha512 = sha512`) required for @noble/ed25519 v3
    - Sidecar .lic zip (license.json + license.sig) extracted via yauzl
    - License module-level cache warmed in app.whenReady
    - IPC stub pattern: real impl in Plan 04, stub throws IPC_NOT_IMPLEMENTED
key-files:
  created:
    - src/main/db/migrations/0011_settings_trial_started_at.sql
    - src/main/license/verify.ts
    - src/main/license/fingerprint.ts
    - src/main/license/status.ts
    - src/main/license/index.ts
    - src/main/ipc/license.ts
    - tests/main/license/verify.test.ts
    - tests/main/license/fingerprint.test.ts
    - tests/integration/license-verify-roundtrip.test.ts
  modified:
    - package.json (added @noble/ed25519 + @noble/hashes deps)
    - package-lock.json (npm install lockfile)
    - src/shared/ipc-contract.ts (LICENSE_STATUS + LICENSE_ACTIVATE + LicenseStatus/LicenseActivateInput/LicenseActivateResult types + IpcContract.license namespace)
    - src/shared/errors.ts (IPC_LICENSE_INVALID + IPC_LICENSE_EXPIRED codes)
    - src/shared/validators.ts (licenseActivateInput zod schema)
    - src/main/paths.ts (licenseDir() helper)
    - src/main/db/migrations.ts (registers migration 0011)
    - src/main/index.ts (calls registerLicenseIpc() + warms getLicenseStatus cache)
    - src/preload/index.ts (exposes api.license.{status,activate})
    - tests/main/db/migrations.test.ts (migration count 8 → 9)
    - tests/main/db/migrations/0002_procedures.test.ts (migration count 8 → 9)
    - tests/main/db/migrations/0008_auto_mrn.test.ts (migration count 8 → 9)
    - tests/main/db/migrations/0009_profile_header_footer_devices_premedication.test.ts (migration count 8 → 9)
decisions:
  - "@noble/ed25519 v3 with explicit ed.hashes.sha512 hookup (A1 in RESEARCH Assumptions Log)"
  - "Object.freeze on verifyLicense function only (NOT module-level) — keeps hashFingerprint + parseLicenseSidecar editable for tests"
  - "VENDOR_PUBLIC_KEY_HEX embedded as a literal 64-hex constant — binary-level grep exposes tampering"
  - "Sidecar zip format (license.json + license.sig) per PITFALLS §Pitfall 6 + CONTEXT D-10"
  - "LICENSE_ACTIVATE ships as IPC_NOT_IMPLEMENTED stub — Plan 04 fills the real loadAndVerifyLicense"
  - "LICENSE_STATUS + LICENSE_ACTIVATE exempt from the IPC gate (Plan 03 ships the gate)"
  - "License cache warmed in app.whenReady() after registerLicenseIpc() so the first IPC call returns instantly"
  - "Trial branch stubbed (unactivated) — Plan 02 extends status.ts with trialStartedAt / trialDaysRemaining"
  - "fingerprint.ts uses Promise.race 5s timeouts for wmic + PowerShell fallback (RESEARCH Pitfall 5)"
  - "4 migration tests updated to expect count 9 (8 → 9) — pre-existing migration count assertions"
metrics:
  duration: ~30 min
  completed_date: 2026-08-24
  tasks: 1 (TRACER)
  files: 11 created + 11 modified
status: complete
---

# Phase 8 Plan 1: License Verify Path Core (TRACER) — Summary

## One-liner

Ed25519 verify path end-to-end: vendor-signed `.lic` proves `state: 'licensed'` via `license.status()` IPC, with `@noble/ed25519` + embedded public key + `Object.freeze` + sidecar `.lic` zip — 17 new tests, all green.

## What was shipped

### Source files (new)
- `src/main/db/migrations/0011_settings_trial_started_at.sql` — one `ALTER TABLE settings ADD COLUMN trial_started_at INTEGER NULL` (Plan 02 writes the row on first wizard bootstrap; Plan 01 just adds the column).
- `src/main/license/verify.ts` — `verifyLicense({ licenseJson, signature, publicKeyHex, machineFingerprint })` + `hashFingerprint` + `parseLicenseSidecar` + the embedded `VENDOR_PUBLIC_KEY_HEX` constant. The single exported verifier is `Object.freeze`d at module export so runtime reassignment throws TypeError in strict mode.
- `src/main/license/fingerprint.ts` — `computeMachineFingerprint()` reads CPU via `os.cpus()[0].model`, MAC via first non-internal IPv4 from `os.networkInterfaces()`, disk serial via 5s-timeout `wmic diskdrive get serialnumber` → PowerShell `Get-CimInstance Win32_DiskDrive` fallback → empty disk serial (degraded). Test seam via `__fingerprint.__diskSerialForTest`.
- `src/main/license/status.ts` — `computeLicenseStatus()` reads sidecar from `<userData>/data/license/{license.json,license.sig}` via `verifyLicense`; returns `{state: 'licensed' | 'unactivated', ...}` (Plan 02 fills the trial branch). `getLicenseStatus()` is memoized; `invalidateLicenseCache()` clears it.
- `src/main/license/index.ts` — orchestrator re-exports the verify surface.
- `src/main/ipc/license.ts` — `registerLicenseIpc()` registers `LICENSE_STATUS` (live) + `LICENSE_ACTIVATE` (stub throws `IPC_NOT_IMPLEMENTED` until Plan 04 ships `loadAndVerifyLicense`).

### Source files (modified)
- `package.json` + `package-lock.json` — `@noble/ed25519 ^3.1.0` + `@noble/hashes ^2.3.0` (both pure-JS, no electron-rebuild).
- `src/shared/ipc-contract.ts` — added `IPC.LICENSE_STATUS` + `IPC.LICENSE_ACTIVATE` constants, `LicenseState` + `LicenseStatus` + `LicenseActivateInput` + `LicenseActivateResult` types, and the `license: { status, activate }` namespace on `IpcContract`.
- `src/shared/errors.ts` — added `IPC_LICENSE_INVALID` + `IPC_LICENSE_EXPIRED` cases to the `IpcError` union + `ipcError()` switch.
- `src/shared/validators.ts` — added `licenseActivateInput` zod schema (`.strict()` + 2000-char path cap).
- `src/main/paths.ts` — added `licenseDir()` returning `<userData>/data/license/` (pre-creates the dir on access; mirrors `reportsDir()`).
- `src/main/db/migrations.ts` — registered migration 0011 in the `MIGRATIONS` array.
- `src/main/index.ts` — `registerLicenseIpc()` runs FIRST in `app.whenReady()` (before every existing `register*()` call so the gate exemption list is correct in Plan 03); `getLicenseStatus()` warms the cache immediately after.
- `src/preload/index.ts` — exposed `api.license.{status, activate}` on the contextBridge.

### Test files (new)
- `tests/main/license/verify.test.ts` — 8 cases: `Object.isFrozen(verifyLicense)` assertion, happy path, tampered JSON, tampered signature, wrong public key, fingerprint mismatch, `VENDOR_PUBLIC_KEY_HEX` shape, malformed JSON.
- `tests/main/license/fingerprint.test.ts` — 6 cases: `hashFingerprint` stability + differentiation + empty-disk degraded path; `computeMachineFingerprint` with the `__diskSerialForTest` seam + degraded empty-disk path + differentiation.
- `tests/integration/license-verify-roundtrip.test.ts` — `RUN_SMOKE=1` gated; 3 cases: `ed.keygen()` private↔public derivation; full vendor → archiver zip → yauzl extract → `verifyLicense` roundtrip with the EMBEDDED public key constant; byte-strict signature failure on bit-flipped JSON (Pitfall 2 invariant).

### Test files (modified)
- 4 migration tests (`tests/main/db/migrations.test.ts`, `tests/main/db/migrations/0002_procedures.test.ts`, `tests/main/db/migrations/0008_auto_mrn.test.ts`, `tests/main/db/migrations/0009_profile_header_footer_devices_premedication.test.ts`) — migration count assertion updated 8 →9 to account for migration 0011.

## Verification

```
node scripts/run-vitest.cjs --run tests/main/license/verify.test.ts tests/main/license/fingerprint.test.ts
✓ 8 + 6 = 14 tests passed (1 file: verify 8, 1 file: fingerprint 6)

RUN_SMOKE=1 node scripts/run-vitest.cjs --run tests/integration/license-verify-roundtrip.test.ts
✓ 3 tests passed (archiver zip + yauzl extract + verify with embedded pubkey + bit-flip byte-strictness)

npm run typecheck:node   → clean
npm run typecheck:web    → clean

Migration 0011 applies cleanly on a fresh DB; _migrations row count = 9.
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed byte index in tampered-JSON test (JSON.parse error instead of signature mismatch)**
- **Found during:** Task 1 test run
- **Issue:** The original test flipped byte index 10 of the JSON payload, which was a closing quote — making the buffer invalid JSON. The verify path correctly returned `MALFORMED_PAYLOAD` for invalid JSON, but the test expected `SIGNATURE_MISMATCH`.
- **Fix:** Flipped byte index 14 (inside the `"test-vendor"` value string) instead. The bit flip changes the value but keeps it parseable as valid JSON, so the verify path now correctly returns `SIGNATURE_MISMATCH` (the signature was computed over the unmutated bytes).
- **Files modified:** `tests/main/license/verify.test.ts`
- **Commit:** (this plan's commit)

### Plan adaptation

**archiver v8 is ESM-only — integration test uses dynamic `await import('archiver')` instead of static import**
- The plan text said "import archiver from 'archiver'", but `archiver@^8.0.0` is pure ESM (`"type": "module"`, `"exports": "./index.js"`); static `import` in compiled CJS would throw `ERR_REQUIRE_ESM` at runtime. The integration test follows the same dynamic-import pattern already used by `src/main/backup/index.ts:52`.

**Test imports use `../../../src/main/license/...` (3 levels up from `tests/main/license/`)**
- The plan's example showed `../../src/main/license/verify`, but the test files actually live at `tests/main/license/` (one level deeper than `tests/main/audit/`), so the relative path needs an extra `../`. Confirmed by the test run.

**Test re-stringify assertion swapped for byte-flip assertion**
- The plan called for a "re-stringifying breaks signature" test that flips JSON.parse→stringify before verify. For Node.js flat JSON, `JSON.parse(JSON.stringify(x))` preserves byte order, so the verify path correctly returns `valid: true` (the signature IS byte-identical). The test was rewritten as "byte-strict: bit-flip in signed JSON breaks signature" which exercises the same Pitfall 2 invariant without relying on incidental stringification differences.

### None of the architectural changes Rule 4 would flag

- No new DB table (column add only).
- No new service layer (extends existing `src/main/license/` namespace).
- No auth/permissioning changes (LICENSE_STATUS + LICENSE_ACTIVATE are exempt; Plan 03 ships the gate).
- No native module rebuild (both new packages are pure-JS).

## Risk Mitigations Applied (from plan's `threat_model`)

- **T-08-01 / T-08-02 (tampered JSON / signature):** `verifyLicense` operates on raw bytes via `ed.verify(signature, licenseJson, publicKey)`. JSON.parse errors surface as `MALFORMED_PAYLOAD`; signature mismatch returns `SIGNATURE_MISMATCH`.
- **T-08-03 (license theft across machines):** Payload embeds `machineFingerprint`; verify compares to `computeMachineFingerprint()` (CPU + disk + MAC).
- **T-08-04 (public key replacement):** `VENDOR_PUBLIC_KEY_HEX` is a literal 64-hex constant in `src/main/license/verify.ts` (binary-level grep exposes tampering); the integration test imports the SAME constant.
- **T-08-05 (verify-path replacement via debugger eval):** `Object.freeze(_verifyLicense)` at module export; runtime reassignment throws TypeError in strict mode; the freeze assertion is `tests/main/license/verify.test.ts:Object.isFrozen(verifyLicense) === true`.
- **T-08-06 (trial clock reset):** Trial clock column added by migration 0011; the verify path does NOT read `settings.trial_started_at` (Plan 02 wires the trial branch separately).
- **T-08-SC (package legitimacy):** Both `@noble/ed25519` + `@noble/hashes` are [VERIFIED] in RESEARCH §Package Legitimacy Audit (Context7 `/paulmillr/noble-ed25519` High reputation 336 snippets + npm registry existence verified).

## Deferred to Later Plans

- **T-08-07 (audit row on license events):** Plan 04 wires `loadAndVerifyLicense` + `audit({ action: 'license.activated' | 'license.invalid' })`. The audit helper import path is referenced from `verify.ts` JSDoc; the actual call sites land in Plan 04.
- **T-08-IPC-GATE (renderer bypass via direct IPC):** Plan 03 wraps every `register*()` call with `licenseGated`; the exemption list includes `LICENSE_STATUS` + `LICENSE_ACTIVATE`. Plan 01 ships the IPC channel surface; Plan 03 ships the gate.
- **T-08-GREP (drift in license gate coverage):** Plan 06 ships `scripts/check-license-gate.cjs` + `tests/main/license/gate-coverage.test.ts`.
- **LICENSE_ACTIVATE real impl:** Plan 04 ships `loadAndVerifyLicense` (file picker → sidecar parse → verify → audit row + cache invalidation). Plan 01's stub throws `IPC_NOT_IMPLEMENTED`.
- **Trial clock reader:** Plan 02 extends `status.ts` with `readTrialStartedAt()` + `getTrialState()` (14-day window).
- **License UI:** Plan 05 ships the License sub-page + `<LicenseGate>` modal + `useLicenseStatus` hook + bilingual i18n.

## Known Stubs

None that prevent the plan's goal. The `LICENSE_ACTIVATE` stub is intentional per the tracer pattern (the plan verifies the path works before wiring the file picker); Plan 04 fills the real impl. No stubs block the verify-path-tracer goal.

## Self-Check: PASSED

All files exist; all commits land; new tests green; typecheck clean.

```
$ ls src/main/license/
fingerprint.ts  index.ts  status.ts  verify.ts

$ ls src/main/ipc/license.ts
src/main/ipc/license.ts

$ ls tests/main/license/
fingerprint.test.ts  verify.test.ts

$ ls tests/integration/license-verify-roundtrip.test.ts
tests/integration/license-verify-roundtrip.test.ts

$ node -e "const m = require('./out/main/license/verify.js'); console.log(Object.isFrozen(m.verifyLicense))"
true
```

---

*Phase: 8-licensing-ed25519-signed-lic-14-day-trial-activation-flow*
*Plan: 01 (TRACER — Wave 1)*
*Status: complete*