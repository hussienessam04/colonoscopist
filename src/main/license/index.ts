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