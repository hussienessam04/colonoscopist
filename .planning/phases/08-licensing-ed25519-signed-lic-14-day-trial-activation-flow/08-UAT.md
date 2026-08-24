# Phase 8 — User Acceptance Test Plan

**Phase:** 8 — Licensing (Ed25519 signed `.lic` + 14-day trial + activation)
**Ship gate:** Windows desktop, offline-only, GCC small clinics

## Prerequisites

- Fresh Windows 10/11 workstation.
- Built installer from `npm run build` + `electron-builder`.
- No `.lic` file present.
- No internet connection (offline-only daily use).
- `node scripts/gen-license.cjs` accessible from the vendor's offline
  machine (the vendor uses a separate signing-key path — NOT shipped
  with the clinic installer).

## Test cases per requirement

### LIC-01: 14-day trial with full features, no card required

1. Install the app on a fresh workstation.
2. Complete the wizard (any PIN).
3. Verify the boot-time modal appears with "Welcome to Colonoscopist" copy.
4. Click "Continue in trial".
5. Verify the Patient List renders; the Settings → License sidebar
   badge shows "Not activated" (the trial state is implicit — see
   Plan 05 sidebar badge contract).
6. Close the app; reopen.
7. Verify the modal does NOT re-appear (the wizard IS the first-launch
   flow; the LicenseGate modal only fires on subsequent boots that
   detect no license; per CONTEXT D-05 the modal fires on every
   boot pre-activation but is session-dismissable).
8. Verify the Settings → License sub-page shows "Trial" with
   "14 days remaining".
9. (Manual-only) Set the system clock forward 14 days.
10. Reopen the app.
11. Verify the boot-time modal appears with EXPIRED copy.
12. Verify all gated IPC channels return `IPC_LICENSE_EXPIRED` when
    invoked (`procedures.create`, `screenshots.add`, etc.).

### LIC-02: Ed25519-signed `.lic` bound to fingerprint

1. Generate a test keypair on the vendor machine:
   `node -e "import('@noble/ed25519').then(m => console.log(Array.from(m.keygen().secretKey).join(',')))"`
   — save to a path supplied via `LICENSE_SIGNING_KEY_PATH`.
2. Vendor-side: `node scripts/gen-license.cjs <machine-fingerprint> <vendor-id>`
   — produces `<machineId>.lic`. (Note: the public key from the test
   keygen step above replaces the shipped `VENDOR_PUBLIC_KEY_HEX` only
   for testing — production uses the SHIPPED public half that the
   vendor's real private key signs against.)
3. Copy the `.lic` file to the clinic workstation.
4. On the workstation: Settings → License → "Load .lic file…".
5. Verify the dialog opens; select the `.lic` file.
6. Verify the sidebar badge updates to green dot + "Licensed ·
   Perpetual".
7. Verify the status card shows the machine id (raw + grouped) +
   vendor id + activation timestamp.
8. Tampered test: edit one byte in the `.lic` JSON.
9. Re-load the tampered `.lic` → verify the toast error surfaces
   with "Invalid license" copy.
10. Verify the Audit page shows a `license.invalid` row with the
    tampering attempt metadata (reason + fingerprintHash + user_id
    null).

### LIC-03: Activation prompt + expired gate

1. From LIC-02.7 above: load a valid `.lic` → modal disappears +
   sidebar updates.
2. Uninstall the app via Windows Settings (preserves `<userData>`).
3. Reinstall the app.
4. Verify the License sub-page still shows "Licensed · Perpetual"
   (the sidecar files in `<userData>/data/license/` survived
   reinstall).
5. Manually delete `<userData>/data/license/{license.json,license.sig}`
   to simulate corruption.
6. Reopen the app → verify the boot-time modal appears (no license).
7. Verify the IPC gate returns `IPC_LICENSE_INVALID` on
   `procedures.create` until a new `.lic` is loaded.

### LIC-04: All IPC handlers gated

1. From a fresh install (no license, no trial):
2. Attempt each IPC channel via the renderer:
   - `auth.status` → succeeds (EXEMPT).
   - `auth.bootstrap` → succeeds (EXEMPT).
   - `patients.list` → returns `{ok: false, code: 'IPC_LICENSE_INVALID'}`.
   - `procedures.create` → returns `{ok: false, code: 'IPC_LICENSE_INVALID'}`.
   - `audit.log` → succeeds (EXEMPT).
   - `license.status` → succeeds (EXEMPT, returns `{state: 'unactivated'}`).
3. Verify the Audit page shows `license.gate_rejected` rows for each
   gated channel that was invoked.
4. After activating a valid `.lic`, re-invoke the same gated channels
   → they succeed.

### I18N-03: EN + AR parity for the new license UI

1. Set the workstation language to AR via the wizard.
2. Verify every License UI string is translated: status labels
   ("Not activated", "Trial", "Expired", "Licensed"), trial days
   remaining, vendor + licensed-at labels, machine id label, Load
   button, modal title + body, "Continue in trial" + "Activate now"
   buttons.
3. Verify the page renders without right-edge overflow under
   `document.documentElement.dir='rtl'` (Playwright RTL smoke).
4. Verify the sidebar badge renders in Arabic ("مفعّل", "تجريبي",
   "منتهي", "غير مفعّل").

## Pass/Fail

- All automated tests pass:
  - `npm run test:unit`
  - `RUN_SMOKE=1 npm run test:integration:smoke:phase8`
  - `npm run test:e2e` (Playwright RTL suite).
- Manual Windows hardware smoke for the disk-serial `wmic` spawn
  passes (per Plan 03 fingerprint test).
- Vendor CLI smoke: vendor generates a `.lic` from a machine
  fingerprint, sends it to the clinic, clinic activates
  successfully.

## Manual-Only Verifications

- `wmic diskdrive get serialnumber` returns a real serial on the
  workstation (Plan 03 fingerprint compute path).
- `node scripts/gen-license.cjs <fingerprint> <vendor>` produces a
  `.lic` the clinic can activate end-to-end.
- First-launch modal blocks procedure capture until activation
  (the IPC gate is the actual enforcement; the modal is cosmetic).
- A future `.lic extension for hardware changes (NIC swap,
  motherboard swap) requires vendor re-issue; the workstation
  cannot self-recover.

## Cross-Reference

- Plan 06 grep gate: `node scripts/check-license-gate.cjs` exits 0
  (every `ipcMain.handle(` is wrapped with `licenseGated` OR in
  `EXEMPT_CHANNELS`).
- Plan 06 runtime guard: `tests/main/license/gate-coverage.test.ts`
  asserts the same coverage invariant at unit-test time.
- Plan 06 audit tests: `tests/main/license/audit.test.ts` covers the
  4 license actions (`license.trial_started`, `license.activated`,
  `license.invalid`, `license.gate_rejected`).
- Plan 06 renderer tests: `tests/renderer/pages/license.test.tsx`
  (9 cases) + `tests/renderer/pages/license-gate.test.tsx`
  (6 cases).
- Plan 06 RTL smoke: `tests/renderer/rtl/license.test.ts`.
- Plan 06 phase smoke: `RUN_SMOKE=1 npm run test:integration:smoke:phase8`
  exercises `license-verify-roundtrip`, `license-trial-survives-reboot`,
  `license-gate-blocks-procedure`.