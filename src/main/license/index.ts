// Phase 8 / Plan 01 — License module orchestrator.
//
// Re-exports the verify path + fingerprint + status surface so the
// renderer-side preload bridge + IPC handlers have a single import
// point. Plan 04 extends this with loadAndVerifyLicense + audit row
// emission; Plan 02 extends this with the trial clock reader.

export {
  verifyLicense,
  hashFingerprint,
  parseLicenseSidecar,
  VENDOR_PUBLIC_KEY_HEX,
  type VerifyResult,
} from './verify';

export { computeMachineFingerprint, __fingerprint } from './fingerprint';

export { getLicenseStatus, invalidateLicenseCache, computeLicenseStatus } from './status';
export type { LicenseState, LicenseStatus } from './status';