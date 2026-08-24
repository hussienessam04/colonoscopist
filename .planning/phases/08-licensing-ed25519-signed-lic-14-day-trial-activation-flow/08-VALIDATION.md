---
phase: 8
slug: licensing-ed25519-signed-lic-14-day-trial-activation-flow
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-24
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 (existing) + Playwright 1.50 (e2e, existing from Phase 7) |
| **Config file** | `vitest.config.ts` (existing) + `playwright.config.ts` (existing from Phase 7) |
| **Quick run command** | `npm run test:unit -- tests/main/license/ tests/renderer/pages/license.test.tsx` |
| **Full suite command** | `npm run test:unit && npm run test:integration:smoke:phase8 && npm run test:e2e` |
| **Estimated runtime** | ~25 seconds for quick command; ~3 minutes for full suite |

---

## Sampling Rate

- **After every task commit:** `npm run test:unit -- tests/main/license/ tests/renderer/pages/license.test.tsx`
- **After every plan wave:** `npm run test:unit && npm run test:integration:smoke:phase8` (RUN_SMOKE=1)
- **Before `/gsd-verify-work 8`:** Full suite green
- **Max feedback latency:** ~25 seconds per task commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | LIC-02 | T-08-01 (fingerprint spoof) | SHA-256(CPU+disk+MAC) hash stable across reboots | unit | `npm run test:unit -- tests/main/license/fingerprint.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | LIC-02 | T-08-02 (verify replacement) | `Object.isFrozen(verifyLicense) === true` | unit | `npm run test:unit -- tests/main/license/verify.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | LIC-01 | T-08-03 (trial manipulation) | `wizardBootstrap()` writes `trial_started_at` inside `db.transaction` | unit + integration | `npm run test:unit -- tests/main/license/trial.test.ts` + `RUN_SMOKE=1 npm run test:integration:smoke:phase8 -- license-trial-survives-reboot` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 2 | LIC-02, LIC-04 | T-08-04 (gate bypass) | `licenseGated(channel, handler)` rejects when license invalid; exemption list enforced | unit + grep-gate | `npm run test:unit -- tests/main/license/gate.test.ts tests/main/license/gate-coverage.test.ts` | ❌ W0 | ⬜ pending |
| 08-04-01 | 04 | 2 | LIC-02, LIC-03 | T-08-05 (tampered license) | Tampered JSON / signature → `IPC_LICENSE_INVALID` + audit row | unit + integration | `npm run test:unit -- tests/main/license/load-license.test.ts` + `RUN_SMOKE=1 npm run test:integration:smoke:phase8 -- license-verify-roundtrip` | ❌ W0 | ⬜ pending |
| 08-05-01 | 05 | 2 | LIC-03, I18N-01, I18N-03 | T-08-06 (UI bypass) | License sub-page + boot-time modal render correctly; RTL parity | unit + e2e | `npm run test:unit -- tests/renderer/pages/license.test.tsx` + `npm run test:e2e -- tests/renderer/rtl/license.test.ts` | � W0 | ⬜ pending |
| 08-06-01 | 06 | 3 | LIC-04 | T-08-07 (gate coverage) | Every `ipcMain.handle(` in `src/main/ipc/*.ts` wrapped or in EXEMPT list | grep-gate | `node scripts/check-license-gate.cjs` | ❌ W0 | ⬜ pending |
| 08-06-02 | 06 | 3 | AUDIT-01 (license events) | T-08-08 (repudiation) | license.activated / invalid / expired / trial_started audit rows | unit | `npm run test:unit -- tests/main/license/audit.test.ts` | ❌ W0 | ⬜ pending |
| 08-07-01 | 07 | 3 | LIC-03 | T-08-09 (expired path) | Expired trial → `procedures.create` IPC returns `IPC_LICENSE_EXPIRED` | integration | `RUN_SMOKE=1 npm run test:integration:smoke:phase8 -- license-gate-blocks-procedure` | ❌ W0 | ⬜ pending |
| 08-08-01 | 08 | 3 | LIC-02 | T-08-10 (vendor tooling) | `gen-license.cjs` produces valid `.lic`; private key never in repo | manual + script | `node scripts/gen-license.cjs <fingerprint> <vendor> --keypath ./secrets/test.private --out ./tmp/test.lic` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/main/license/verify.test.ts` — 6+ cases: happy-path verify, tampered JSON, tampered signature, wrong public key, fingerprint mismatch, `Object.isFrozen(verifyLicense) === true`.
- [ ] `tests/main/license/fingerprint.test.ts` — 4+ cases: CPU-only, MAC-only, mocked disk serial, SHA-256 stability (same input → same hash).
- [ ] `tests/main/license/trial.test.ts` — 3+ cases: clock read, expiry boundary, missing row (unactivated).
- [ ] `tests/main/license/gate.test.ts` — 5+ cases: exempt list membership, expired path returns `IPC_LICENSE_EXPIRED`, invalid path returns `IPC_LICENSE_INVALID`, audit row emitted on gate rejection, no gate for AUDIT_LOG.
- [ ] `tests/main/license/load-license.test.ts` — 3+ cases: sidecar extraction happy path, missing entry throws, malformed zip throws.
- [ ] `tests/main/license/gate-coverage.test.ts` — 1+ case: assert every `ipcMain.handle(` in `src/main/ipc/*.ts` is wrapped with `licenseGated` (or in the EXEMPT set).
- [ ] `tests/main/license/audit.test.ts` — 2+ cases: license.activated audit row has `userId: null` + correct metadata shape; license.invalid row has correct reason metadata.
- [ ] `tests/integration/license-verify-roundtrip.test.ts` — 1 case (RUN_SMOKE=1): generate keypair → vendor CLI stub → produce `.lic` → load → verify → assert cached status.
- [ ] `tests/integration/license-trial-survives-reboot.test.ts` — 1 case (RUN_SMOKE=1): wizard bootstrap writes `trial_started_at`; close DB; reopen; assert row persists.
- [ ] `tests/integration/license-gate-blocks-procedure.test.ts` — 1 case (RUN_SMOKE=1): wizard bootstrap with no `.lic`; assert `procedures.create` IPC returns `IPC_LICENSE_INVALID`; activate `.lic`; assert success.
- [ ] `tests/renderer/pages/license.test.tsx` — 8+ cases: status card renders all 4 states, "Load .lic file…" calls `license.activate`, error toast on bad file, machine-id copy button, sidebar badge countdown.
- [ ] `tests/renderer/rtl/license.test.ts` — 1 case: Playwright RTL smoke (dir='rtl' + scrollWidth check + screenshot).
- [ ] `scripts/check-license-gate.cjs` — grep gate: every `ipcMain.handle(` in `src/main/ipc/*.ts` is either wrapped with `licenseGated` OR appears in `EXEMPT_CHANNELS`. Exits non-zero on drift.

*Existing infrastructure covers the framework (Vitest + Playwright already installed from Phases 1–7); Wave 0 only adds the new test files + grep gate above.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Windows `wmic diskdrive get serialnumber` returns a real disk serial | LIC-02 | Hardware-dependent; CI runners typically have no disk serial exposed; needs the user's actual workstation | Run on a Windows machine: `wmic diskdrive get serialnumber` should print a non-empty serial; then `npm run test:e2e -- tests/integration/license-fingerprint-windows.test.ts` (RUN_SMOKE=1) on the workstation |
| Vendor `gen-license.cjs` produces a `.lic` the vendor can send to the clinic | LIC-02 | Vendor-side tooling; not part of the shipped app | `node scripts/gen-license.cjs <machineId> <vendorId> --keypath ./secrets/ed25519.private --out ./tmp/test.lic` then copy to a real workstation + run the activation flow |
| First-launch modal blocks procedure capture until activation | LIC-03 | Needs the actual UI + DB boot path on a real Windows workstation | Install the built app; launch; confirm modal appears; try Procedure Room (Record button disabled or "Activate to record" message) |

*All other behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (12 test files + 1 grep gate)
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s per task commit
- [ ] `nyquist_compliant: true` set in frontmatter after `/gsd-validate-phase 8`

**Approval:** pending
