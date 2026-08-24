// Phase 8 / Plan 01 — License status cache (LIC-02/03).
//
// Per RESEARCH §Pattern 5: `computeLicenseStatus()` reads the sidecar
// from `<userData>/data/license/{license.json,license.sig}` on every call;
// `getLicenseStatus()` memoizes the result so the boot-time + per-render
// reads don't repeat the verify cost. Plan 04's `loadAndVerifyLicense`
// invalidates the cache after a successful activation.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { licenseDir } from '../paths';
import { verifyLicense, VENDOR_PUBLIC_KEY_HEX } from './verify';
import { computeMachineFingerprint } from './fingerprint';
import type { LicenseStatus as ContractLicenseStatus } from '@shared/ipc-contract';

export type LicenseState = ContractLicenseStatus['state'];
export type LicenseStatus = ContractLicenseStatus;

let cached: LicenseStatus | null = null;

/**
 * Read the sidecar + verify + return the canonical LicenseStatus. The
 * trial branch is stubbed for Plan 01 (returns `unactivated` when no
 * license + no trial row exists); Plan 02 fills the trial clock
 * (readTrialStartedAt / getTrialState) on top of this shape.
 */
export async function computeLicenseStatus(): Promise<LicenseStatus> {
  const licDir = licenseDir();
  const jsonPath = join(licDir, 'license.json');
  const sigPath = join(licDir, 'license.sig');
  const machineId = await computeMachineFingerprint();

  // Try licensed first.
  if (existsSync(jsonPath) && existsSync(sigPath)) {
    const json = readFileSync(jsonPath);
    const sig = readFileSync(sigPath);
    const result = verifyLicense({
      licenseJson: json,
      signature: sig,
      publicKeyHex: VENDOR_PUBLIC_KEY_HEX,
      machineFingerprint: machineId,
    });
    if (result.valid) {
      return {
        state: 'licensed',
        vendorId: result.vendorId,
        licensedAt: result.licensedAt,
        expiresAt: result.expiresAt,
        trialStartedAt: null,
        trialDaysRemaining: null,
        machineId,
      };
    }
    // Invalid sidecar — fall through to unactivated/expired. The
    // renderer's IPC gate handles the rejection; Plan 04's
    // loadAndVerifyLicense writes the license.invalid audit row.
  }

  // No license (or invalid sidecar) → unactivated for Plan 01. Plan 02
  // extends this with trialStartedAt / trialDaysRemaining via
  // readTrialStartedAt() + the 14-day expiry check.
  return {
    state: 'unactivated',
    vendorId: null,
    licensedAt: null,
    expiresAt: null,
    trialStartedAt: null,
    trialDaysRemaining: null,
    machineId,
  };
}

/**
 * Memoized accessor for the IPC handler. The cache is invalidated by
 * Plan 04's loadAndVerifyLicense after a successful activation; the
 * boot-time path warms the cache via `getLicenseStatus()` inside
 * `app.whenReady()` (after `registerLicenseIpc()`).
 */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  if (cached) return cached;
  cached = await computeLicenseStatus();
  return cached;
}

/**
 * Clear the cached status so the next `getLicenseStatus()` call
 * re-reads the sidecar. Called by Plan 04's `loadAndVerifyLicense`
 * after a successful activation.
 */
export function invalidateLicenseCache(): void {
  cached = null;
}