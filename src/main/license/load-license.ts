// Phase 8 / Plan 04 — License activation handler (LIC-02 + LIC-03).
//
// Per CONTEXT D-10 + D-11: the `.lic` file is a sidecar zip (license.json +
// license.sig). This module reads the zip via yauzl (already used by
// parseLicenseSidecar), invokes verifyLicense, and on success writes the
// verified `license.json` + `license.sig` to `licenseDir()` so
// status.ts can re-derive on every boot without re-prompting.
//
// Audit: every invocation emits EITHER `license.activated` (success) OR
// `license.invalid` (failure) per D-11. `userId: null` because license
// events are workstation-level, not per-doctor.
//
// Test seam: the `fingerprintOverride` option bypasses
// `computeMachineFingerprint()` so tests don't spawn `wmic`. The seam
// matches the pattern used by verify.test.ts.
//
// ponytail: verify, fingerprint, audit, licenseDir are all pure-JS; the
// only async IO here is fs.readFile + yauzl.fromBuffer. The whole
// function Promise-wraps cleanly with no need for an EventEmitter.

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import {
  parseLicenseSidecar,
  verifyLicense,
  VENDOR_PUBLIC_KEY_HEX,
} from './verify';
import { computeMachineFingerprint } from './fingerprint';
import { audit } from '../db/audit';
import { licenseDir } from '../paths';
import { invalidateLicenseCache } from './status';
import type { LicenseActivateResult } from '@shared/ipc-contract';

/**
 * Load the `.lic` zip at `licPath`, verify it against the embedded
 * vendor public key + the runtime machine fingerprint, and on success
 * write the verified sidecar files to `<userData>/data/license/` so the
 * boot-time verify path can re-derive. On failure, write the
 * `license.invalid` audit row and return the discriminated union's
 * failure arm without touching the sidecar files.
 *
 * Behavior summary (LIC-02 + D-09..D-11):
 *   1. Read the zip file bytes.
 *   2. Extract `license.json` + `license.sig` via parseLicenseSidecar (yauzl).
 *   3. Compute the machine fingerprint (test seam: `fingerprintOverride`).
 *   4. verifyLicense(licenseJson, signature, embeddedPubkey, fingerprint).
 *   5. On failure: emit `license.invalid` audit row (failure case) and
 *      return `{ ok: false, code: 'IPC_LICENSE_INVALID', reason }`.
 *      Sidecar is NOT written.
 *   6. On success: write sidecar files, invalidate the cached status,
 *      emit `license.activated` audit row, return success shape.
 */
export async function loadAndVerifyLicense(
  licPath: string,
  options?: { fingerprintOverride?: string },
): Promise<LicenseActivateResult> {
  // Step 1: Read the zip bytes.
  const zipBuffer = await fsp.readFile(licPath);

  // Step 3: Compute the machine fingerprint (test seam: explicit override).
  // Compute BEFORE parsing the sidecar so the audit row carries the
  // fingerprint even when the sidecar extraction fails (Pitfall 8 + D-11:
  // every activation attempt emits an audit row).
  const fingerprint = options?.fingerprintOverride ?? (await computeMachineFingerprint());

  // Step 2: Extract license.json + license.sig from the zip. The
  // parseLicenseSidecar helper throws on missing entries; we catch and
  // surface as MALFORMED_PAYLOAD so the license.invalid audit row carries
  // a stable `reason` (the renderer's toast + future vendor-debug tooling
  // surfaces rely on the discriminated union, not a thrown error).
  let json: Buffer;
  let signature: Buffer;
  try {
    ({ json, signature } = await parseLicenseSidecar(zipBuffer));
  } catch {
    audit({
      action: 'license.invalid',
      entityType: 'license',
      entityId: licPath,
      outcome: 'failed',
      userId: null,
      metadata: { reason: 'MALFORMED_PAYLOAD', fingerprintHash: fingerprint },
    });
    return { ok: false, code: 'IPC_LICENSE_INVALID', reason: 'MALFORMED_PAYLOAD' };
  }

  // Step 4: Verify. verifyLicense is a pure function — no I/O, no side
  // effects. Frozen by export per PITFALLS §Pitfall 6 + D-09.
  const result = verifyLicense({
    licenseJson: json,
    signature,
    publicKeyHex: VENDOR_PUBLIC_KEY_HEX,
    machineFingerprint: fingerprint,
  });

  // Step 5: Failure path. NO sidecar writes.
  if (!result.valid) {
    audit({
      action: 'license.invalid',
      entityType: 'license',
      entityId: licPath,
      outcome: 'failed',
      userId: null,
      metadata: { reason: result.reason, fingerprintHash: fingerprint },
    });
    return { ok: false, code: 'IPC_LICENSE_INVALID', reason: result.reason };
  }

  // Step 6: Success path. Write the sidecar files to licenseDir().
  // The license.json + license.sig are the exact bytes the vendor
  // signed — we DO NOT re-canonicalize; canonicalization breaks
  // signatures (Pitfall 2).
  const licDir = licenseDir();
  await fsp.writeFile(join(licDir, 'license.json'), json);
  await fsp.writeFile(join(licDir, 'license.sig'), signature);

  // Invalidate the cached status so the next getLicenseStatus() call
  // re-reads the freshly-written sidecar from disk.
  invalidateLicenseCache();

  // Audit row (D-11). Workstation-level event per the plan <behavior>
  // block — `userId: null` so the Phase 7 Audit sub-page surfaces these
  // rows under the workstation fingerprint, not a per-doctor profile.
  audit({
    action: 'license.activated',
    entityType: 'license',
    entityId: licPath,
    outcome: 'ok',
    userId: null,
    metadata: {
      vendorId: result.vendorId,
      fingerprintHash: fingerprint,
      expiresAt: result.expiresAt,
    },
  });

  return {
    ok: true,
    vendorId: result.vendorId,
    licensedAt: result.licensedAt,
  };
}
