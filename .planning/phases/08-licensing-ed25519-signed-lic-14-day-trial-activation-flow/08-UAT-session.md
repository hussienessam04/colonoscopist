---
status: testing
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
source: 08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md, 08-05-SUMMARY.md, 08-06-SUMMARY.md, 08-07-SUMMARY.md, 08-08-SUMMARY.md, 08-09-SUMMARY.md, 08-10-SUMMARY.md
started: 2026-09-02T00:00:00Z
updated: 2026-09-02T00:06:00Z
---

## Current Test

number: 3
name: LicenseGate Modal Appears on First Boot (unactivated)
expected: |
  Wipe trial_started_at row in settings (simulate expired trial), restart app. A modal appears above any route with "Welcome to Colonoscopist" copy, "Activate now" primary button, and (for unactivated only) "Continue in trial" outline button. The modal is dismissable per-session.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Fresh install (no .lic, no prior app data) — app boots cleanly, wizard appears, completes, migration 0011 applies, license status returns trial/14-days-remaining after wizard bootstrap. No errors in main process console.
result: pass

### 2. Fresh Install Starts 14-Day Trial
expected: After wizard completion, Settings → License shows a status card reading "Trial" with "14 days remaining". The audit page shows a `license.trial_started` row.
result: pass

### 3. LicenseGate Modal Appears on First Boot (unactivated)
expected: Wipe trial_started_at row in settings (simulate expired trial), restart app. A modal appears above any route with "Welcome to Colonoscopist" copy, "Activate now" primary button, and (for unactivated only) "Continue in trial" outline button. The modal is dismissable per-session.
result: issue
reported: "Modal renders momentarily then app white-screens before user can interact. The gated IPC `patients.list` returns `{ok: false, code: 'IPC_LICENSE_INVALID'}` but the renderer's SWR hook (likely usePatients) doesn't handle the discriminated union — crashes React tree, white screen."
severity: blocker

### 4. Activate via Valid .lic File
expected: Settings → License → click "Load .lic file…" → file picker opens filtered to `*.lic`. Pick a valid Ed25519-signed `license.json` + `license.sig` sidecar that matches this workstation's fingerprint. Toast success appears. Page updates to show "Licensed · Perpetual" badge (green dot), vendor id, licensed-at timestamp, and machine id grouped in 4-char blocks.
result: blocked
blocked_by: third-party
reason: "Requires vendor Ed25519 private key + scripts/gen-license.cjs to produce a workstation-specific .lic sidecar. Clinic-side workstation does not have the vendor signing key."

### 5. Tampered .lic File Rejected
expected: Edit one byte inside the .lic payload (or replace the signature with garbage). Click "Load .lic file…" again. Error toast surfaces with the failure reason (e.g. "Invalid license" / SIGNATURE_MISMATCH). No sidecar files written to `<userData>/data/license/`. The Audit page shows a `license.invalid` row with the tampering metadata.
result: blocked
blocked_by: third-party
reason: "Requires a real .lic (vendor-signed) to mutate. Same dependency as Test 4."

### 6. File Picker Cancel Is Silent
expected: Click "Load .lic file…" → click Cancel in the OS file dialog. No toast appears, no audit row written, license state unchanged.
result: blocked
blocked_by: third-party
reason: "Requires navigating to Settings → License sub-page. Also benefits from a real .lic to confirm cancel path doesn't trigger side effects."

### 7. Gated IPC Channels Block Without License
expected: From a fresh install (no license, no trial), invoke `procedures.create` via the renderer — returns `{ ok: false, code: 'IPC_LICENSE_INVALID' }`. `patients.list` returns the same. `auth.status`, `auth.bootstrap`, `audit.log`, and `license.status` continue to work. Each gated rejection writes a `license.gate_rejected` audit row with the channel + fingerprintHash + code metadata.
result: blocked
blocked_by: third-party
reason: "Requires setting an expired trial or wiping the trial row to reach the unactivated state — vendor .lic would resolve to 'licensed' which exempts this test."

### 8. Sidebar Badge Reflects License State
expected: Settings sidebar License entry shows a colored dot + label: green dot + "Licensed · Perpetual" when licensed; blue + "تجريبي"/"Trial" when on trial; red + "Expired"/"منتهي" when past 14d; gray + "Not activated"/"غير مفعّل" when unactivated.
result: blocked
blocked_by: third-party
reason: "Requires a licensed (green) badge to verify Perpetual state. Only 'gray / Not activated' or 'blue / Trial' are observable from current build (after G-08-2 fix)."

### 9. License Sub-page Shows Machine ID + Vendor
expected: After activation, the License sub-page status card shows: vendor id (raw string), licensed-at timestamp, and machine id grouped 4-char (`xxxx-xxxx-xxxx-xxxx`) with a Copy button. Clicking Copy puts the raw id on the clipboard and surfaces a "Copied" toast.
result: blocked
blocked_by: third-party
reason: "Vendor id + licensed-at only populate after successful .lic activation. Machine id group + Copy button are observable from current build (test those parts)."

### 10. Bilingual License UI (EN + AR)
expected: Switch app language to AR (Wizard or Settings → Profile → Language). Every License UI string translates: status labels, trial days remaining, vendor + licensed-at labels, machine id label, Load button, modal title + body, "Continue in trial" + "Activate now". RTL layout renders without right-edge overflow at 1280×800. Sidebar badge renders in Arabic ("مفعّل", "تجريبي", "منتهي", "غير مفعّل").
result: pending

## Summary

total: 10
passed: 2
issues: 1
pending: 1
skipped: 0
blocked: 6

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

- gap_id: G-08-2
  truth: "After wizard completion, license state transitions from 'unactivated' (pre-wizard cache) to 'trial' (post-wizard row write)"
  status: resolved
  resolved_by: 08-08-PLAN.md
  resolved_at: 2026-09-02
  reason: "User observed LicenseGate modal firing post-wizard with 'Continue in trial' button — per LicenseGate.tsx:64,80 this only happens when state==='unactivated'. wizardBootstrap writes settings.trial_started_at at src/main/auth/index.ts:95 but does NOT call invalidateLicenseCache(), so the cached state stays stale."
  severity: major
  test: 2
  root_cause: "src/main/auth/index.ts:39 wizardBootstrap writes settings.trial_started_at at line 95 but does NOT call invalidateLicenseCache() afterwards. The license status cache (src/main/license/status.ts:25 `let cached: LicenseStatus | null = null`) was warmed at app.whenReady() before wizardBootstrap ran, so it holds state='unactivated' from the no-row-yet evaluation. The next license.status IPC call returns the stale cached value, LicenseGate sees state==='unactivated' and fires the modal. Plan 04 wired invalidateLicenseCache() in loadAndVerifyLicense (load-license.ts:119) but missed the wizard bootstrap call site. Plan 02's integration test exercises wizardBootstrap directly + getTrialState directly, so it doesn't exercise the cache-invalidation pathway."
  artifacts:
    - path: "src/main/auth/index.ts"
      issue: "wizardBootstrap() writes settings.trial_started_at inside db.transaction at line 95 but does not call invalidateLicenseCache() afterwards; cache stays stale at state='unactivated' until next app boot"
    - path: "src/main/license/status.ts"
      issue: "Module-level `let cached: LicenseStatus | null = null` (line 25) memoizes state; not invalidated by wizardBootstrap"
    - path: "src/main/license/load-license.ts:119"
      issue: "Reference implementation that DOES call invalidateLicenseCache() after activation — the pattern wizardBootstrap was supposed to follow"
  missing:
    - "Import invalidateLicenseCache from src/main/license/index.ts in src/main/auth/index.ts"
    - "Call invalidateLicenseCache() AFTER wizardBootstrap's db.transaction commits successfully (NOT inside the transaction — invalidate after the row is visible to other connections)"
    - "Audit row license.trial_started should still be inside the transaction (per Plan 02 D-11 + audit row pattern)"
    - "Add integration test case: warm cache, call wizardBootstrap, assert next license.status returns state='trial' (not the stale 'unactivated')"
    - "Re-run unit + integration suites to confirm no regression"
  debug_session: "Plan 08-08 commits: b8bedc2 (import + post-commit call in wizardBootstrap) + 9b7ea0e (new tests/integration/license-cache-invalidation-on-wizard.test.ts + package.json registration) + 8ce8a01 (SUMMARY). Verification: typecheck:node clean, 3/3 wizard unit tests pass, RUN_SMOKE=1 smoke 5/5 pass (2 new + 3 existing reboot). Negative control proven: commenting out invalidateLicenseCache() makes new test FAIL with 'expected unactivated to be trial' while the audit-row sibling test still passes — proves the test exercises the cache pathway and the transaction is untouched. Restoring the line restores the green."

- gap_id: G-08-3
  truth: "On first launch (no license, no trial, no users row), the wizard renders cleanly without LicenseGate modal interference. The wizard IS the path to start the trial; gating it with the activation modal breaks first-launch UX."
  status: resolved
  resolved_by: 08-09-PLAN.md
  resolved_at: 2026-09-02
  reason: "User screenshot: LicenseGate modal 'Activate Colonoscopist' with 'Continue in trial' + 'Activate now' fires ON TOP of the in-progress wizard. Blocks the wizard form. App.tsx:158 wraps EVERY route (including 'wizard') with <LicenseGate>; LicenseGate.tsx has no wizard-route exemption, so it fires for state='unactivated' regardless of route. The wizard is the gateway to activation — gating it with the activation modal is contradictory."
  severity: major
  test: 1
  root_cause: "src/renderer/src/components/LicenseGate.tsx:64 — the showModal predicate fires for state==='unactivated' regardless of the active route. App.tsx:158 wraps EVERY route (including 'wizard') with <LicenseGate>. On first launch there is no users row → wizardBootstrap has not run → no settings.trial_started_at row → state='unactivated' → modal fires → blocks the wizard form. The wizard IS the path to start the trial; gating it with the activation modal is contradictory."
  artifacts:
    - path: "src/renderer/src/components/LicenseGate.tsx"
      issue: "showModal predicate has no wizard-route exemption — fires for state==='unactivated' regardless of route"
    - path: "src/renderer/src/App.tsx:158"
      issue: "Wraps EVERY route (including 'wizard') with <LicenseGate>; no route-based exemption at the App level either"
  missing:
    - "Widen useRoute() destructure in LicenseGate.tsx to also pull route"
    - "Add route.name !== 'wizard' && route.name !== 'login' to the showModal predicate"
    - "Add 2 new test cases (wizard route + login route exemption) to tests/renderer/pages/license-gate.test.tsx"
    - "Re-run typecheck:web + license-gate tests to confirm no regression to the 6 existing cases"
  debug_session: "Plan 08-09 commits: db1dfb7 (LicenseGate.tsx: widen destructure + widen predicate + header comment update) + 7636ee5 (license-gate.test.tsx: 2 new regression-guard test cases) + a7070fa (SUMMARY). Verification: typecheck:web no new errors, license-gate tests 8/8 pass (6 existing + 2 new). Wizard now renders cleanly on first launch; modal still gates every authenticated route as before."

- gap_id: G-08-4
  truth: "When the LicenseGate modal fires for unactivated state and a gated IPC returns {ok: false, code: 'IPC_LICENSE_INVALID'}, the renderer renders gracefully (empty-state fallback) rather than crashing to a white screen — modal must remain interactable"
  status: failed
  reason: "User observed: deleted trial_started_at row → login → modal renders briefly → white screen before user can click. The gated IPC (likely patients.list via usePatients SWR hook) returns {ok: false, code: 'IPC_LICENSE_INVALID'} but the SWR hook doesn't branch on the discriminated union — likely crashes React tree or returns malformed data that breaks downstream render."
  severity: blocker
  test: 3
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
