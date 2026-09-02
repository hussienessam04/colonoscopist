---
status: testing
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
source: 08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md, 08-05-SUMMARY.md, 08-06-SUMMARY.md, 08-07-SUMMARY.md
started: 2026-09-02T00:00:00Z
updated: 2026-09-02T00:01:00Z
---

## Current Test

number: 2
name: Fresh Install Starts 14-Day Trial
expected: |
  After wizard completion, Settings → License shows a status card reading "Trial" with "14 days remaining". The audit page shows a `license.trial_started` row.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Fresh install (no .lic, no prior app data) — app boots cleanly, wizard appears, completes, migration 0011 applies, license status returns trial/14-days-remaining after wizard bootstrap. No errors in main process console.
result: pass
note: "Plan 08-07 dynamic-import fix verified via build (out/main/index.js emits 2 await import('@noble/ed25519')/await import('@noble/hashes/sha2.js') lines, zero require() calls) + 16/16 unit tests pass. Original ERR_REQUIRE_ESM crash resolved."

### 2. Fresh Install Starts 14-Day Trial
expected: After wizard completion, Settings → License shows a status card reading "Trial" with "14 days remaining". The audit page shows a `license.trial_started` row.
result: pending

### 3. LicenseGate Modal Appears on First Boot (unactivated)
expected: Clear `<userData>/data/license/` sidecar, restart app. A modal appears above any route with "Welcome to Colonoscopist" copy, a "Continue in trial" outline button, and an "Activate now" primary button. The modal is dismissable per-session.
result: pending

### 4. Activate via Valid .lic File
expected: Settings → License → click "Load .lic file…" → file picker opens filtered to `*.lic`. Pick a valid Ed25519-signed `license.json` + `license.sig` sidecar that matches this workstation's fingerprint. Toast success appears. Page updates to show "Licensed · Perpetual" badge (green dot), vendor id, licensed-at timestamp, and machine id grouped in 4-char blocks.
result: pending

### 5. Tampered .lic File Rejected
expected: Edit one byte inside the .lic payload (or replace the signature with garbage). Click "Load .lic file…" again. Error toast surfaces with the failure reason (e.g. "Invalid license" / SIGNATURE_MISMATCH). No sidecar files written to `<userData>/data/license/`. The Audit page shows a `license.invalid` row with the tampering metadata.
result: pending

### 6. File Picker Cancel Is Silent
expected: Click "Load .lic file…" → click Cancel in the OS file dialog. No toast appears, no audit row written, license state unchanged.
result: pending

### 7. Gated IPC Channels Block Without License
expected: From a fresh install (no license, no trial), invoke `procedures.create` via the renderer — returns `{ ok: false, code: 'IPC_LICENSE_INVALID' }`. `patients.list` returns the same. `auth.status`, `auth.bootstrap`, `audit.log`, and `license.status` continue to work. Each gated rejection writes a `license.gate_rejected` audit row with the channel + fingerprintHash + code metadata.
result: pending

### 8. Sidebar Badge Reflects License State
expected: Settings sidebar License entry shows a colored dot + label: green dot + "Licensed · Perpetual" when licensed; blue + "تجريبي"/"Trial" when on trial; red + "Expired"/"منتهي" when past 14d; gray + "Not activated"/"غير مفعّل" when unactivated.
result: pending

### 9. License Sub-page Shows Machine ID + Vendor
expected: After activation, the License sub-page status card shows: vendor id (raw string), licensed-at timestamp, and machine id grouped 4-char (`xxxx-xxxx-xxxx-xxxx`) with a Copy button. Clicking Copy puts the raw id on the clipboard and surfaces a "Copied" toast.
result: pending

### 10. Bilingual License UI (EN + AR)
expected: Switch app language to AR (Wizard or Settings → Profile → Language). Every License UI string translates: status labels, trial days remaining, vendor + licensed-at labels, machine id label, Load button, modal title + body, "Continue in trial" + "Activate now". RTL layout renders without right-edge overflow at 1280×800. Sidebar badge renders in Arabic ("مفعّل", "تجريبي", "منتهي", "غير مفعّل").
result: pending

## Summary

total: 10
passed: 0
issues: 1
pending: 9
skipped: 0
blocked: 0

## Gaps

- gap_id: G-08-1
  truth: "App boots cleanly after fresh install; wizard completes; migration 0011 applies; license status returns trial/14-days-remaining"
  status: resolved
  resolved_by: 08-07-PLAN.md
  resolved_at: 2026-09-02
  reason: "User reported: App threw an error during load. Error [ERR_REQUIRE_ESM]: require() of ES Module node_modules/@noble/ed25519/index.js from out/main/index.js not supported."
  severity: blocker
  test: 1
  root_cause: "src/main/license/verify.ts:19-20 imports @noble/ed25519 + @noble/hashes/sha2.js statically. Both packages are ESM-only ('type: module'). electron-vite's externalizeDepsPlugin keeps them external, so the bundled out/main/index.js emits require('@noble/ed25519') which Node 24's CJS loader rejects. Plan 01 unit tests passed because Vitest handles ESM dynamically; the bundled Electron main process does not. Plan 01's own deviation log already acknowledged archiver v8 needs dynamic import (same root cause), but did not apply the pattern to the production verify.ts imports."
  artifacts:
    - path: "src/main/license/verify.ts"
      issue: "Static import of @noble/ed25519 + @noble/hashes/sha2.js compiles to CJS require() in out/main/index.js — both packages are ESM-only"
    - path: "out/main/index.js"
      issue: "Line 31-32 emit require('@noble/ed25519') and require('@noble/hashes/sha2.js') which throw ERR_REQUIRE_ESM at runtime"
    - path: "electron.vite.config.ts"
      issue: "externalizeDepsPlugin keeps noble deps external; the plugin passes through require() verbatim instead of bundling the ESM source"
  missing:
    - "Convert static imports at src/main/license/verify.ts:19-20 to dynamic await import() with memoization (matches existing archiver pattern at src/main/backup/index.ts:52 and tests/integration/license-verify-roundtrip.test.ts per Plan 01 deviation)"
    - "Make verifyLicense async OR add an async preload helper that loads noble deps during app.whenReady() cache-warm step"
    - "Audit all verifyLicense callers (load-license.ts, status.ts, tests) for await propagation"
    - "Re-run typecheck + unit suite + smoke integration suite to confirm no regression"
  debug_session: "Plan 08-07 commits: bcdcb83 (source+await) + 23ced22 (test+await, incl. license-verify-roundtrip.test.ts Rule 2 deviation) + 6dc06d0 (SUMMARY). All 4 verification commands green: typecheck exit 0, 16/16 unit tests pass, build succeeds (out/main/index.js 296.07 kB), findstr for require('@noble returns 0."
