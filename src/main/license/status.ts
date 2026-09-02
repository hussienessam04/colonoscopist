// Phase 8 / Plan 01 + Plan 02 — License status cache (LIC-02/03).
//
// Per RESEARCH §Pattern 5: `computeLicenseStatus()` reads the sidecar
// from `<userData>/data/license/{license.json,license.sig}` on every call;
// `getLicenseStatus()` memoizes the result so the boot-time + per-render
// reads don't repeat the verify cost. Plan 04's `loadAndVerifyLicense`
// invalidates the cache after a successful activation.
//
// Plan 02 extends the fall-through branch with the 14-day trial clock
// (`trial.ts:getTrialState()` + `readTrialStartedAt()`). The clock is a
// UI countdown, NOT a permission per D-02 + PITFALLS §Pitfall 6; the
// IPC gate (Plan 03) handles the permission to write.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { licenseDir } from '../paths';
import { verifyLicense, VENDOR_PUBLIC_KEY_HEX } from './verify';
import { computeMachineFingerprint } from './fingerprint';
import { getTrialState, readTrialStartedAt, TRIAL_DURATION_MS } from './trial';
import type { LicenseStatus as ContractLicenseStatus } from '@shared/ipc-contract';

export type LicenseState = ContractLicenseStatus['state'];
export type LicenseStatus = ContractLicenseStatus;

let cached: LicenseStatus | null = null;

/**
 * Read the sidecar + verify + return the canonical LicenseStatus. The
 * fall-through branch consumes `trial.ts:getTrialState()` for the 14-day
 * trial window; Plan 02 wires that here. Plan 04's `loadAndVerifyLicense`
 * writes the license.activated / license.invalid audit rows.
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
    const result = await verifyLicense({
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

  // No license (or invalid sidecar) → fall back to trial / expired / unactivated.
  const trial = getTrialState();
  if (trial) {
    return {
      state: 'trial',
      vendorId: null,
      licensedAt: null,
      expiresAt: trial.expiresAt,
      // surfaced for the renderer's "trial started Xd ago" copy if needed
      trialStartedAt: trial.expiresAt - TRIAL_DURATION_MS,
      trialDaysRemaining: trial.daysRemaining,
      machineId,
    };
  }

  // No license + no active trial (either expired or never started).
  const trialStartedAt = readTrialStartedAt();
  return {
    state: trialStartedAt !== null ? 'expired' : 'unactivated',
    vendorId: null,
    licensedAt: null,
    expiresAt: null,
    trialStartedAt,
    trialDaysRemaining: 0,
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