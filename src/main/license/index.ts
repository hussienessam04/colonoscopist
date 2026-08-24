// Phase 8 / Plan 01 + Plan 02 — License module orchestrator.
//
// Re-exports the verify path + fingerprint + status + trial clock surface
// so the renderer-side preload bridge + IPC handlers have a single import
// point. Plan 04 extends this with loadAndVerifyLicense + audit row
// emission.

export {
  verifyLicense,
  hashFingerprint,
  parseLicenseSidecar,
  VENDOR_PUBLIC_KEY_HEX,
  type VerifyResult,
} from './verify';

export { computeMachineFingerprint, __fingerprint } from './fingerprint';

export { getTrialState, readTrialStartedAt, TRIAL_DURATION_MS } from './trial';
export type { TrialState } from './trial';

export { getLicenseStatus, invalidateLicenseCache, computeLicenseStatus } from './status';
export type { LicenseState, LicenseStatus } from './status';

// Phase 8 / Plan 04 — license activation handler (LIC-03). Reads the
// `.lic` zip, invokes verifyLicense, writes the verified sidecar to
// licenseDir(), and emits the license.activated / license.invalid audit
// row per D-11.
export { loadAndVerifyLicense } from './load-license';

// Phase 8 / Plan 03 — IPC gate (LIC-04). Re-exports the gate helper +
// EXEMPT_CHANNELS set so `ipcMain.handle` call sites can wrap their
// handlers with `licenseGated(IPC.X, ...)` from the main module.
export { licenseGated, EXEMPT_CHANNELS, type LicenseGateError } from './gate';