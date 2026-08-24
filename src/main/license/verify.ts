// Phase 8 / Plan 01 — Ed25519 verify path core (LIC-02).
//
// Per CONTEXT D-09: this file is the SINGLE source of license truth.
// - `@noble/ed25519` v3 is the cryptographic primitive (pure-JS, audited,
//   RFC8032/ZIP215-compliant). sha512 hookup is REQUIRED by v3 — without
//   this line, `ed.verify()` throws synchronously (A1 in RESEARCH).
// - `VENDOR_PUBLIC_KEY_HEX` is a literal 64-hex-chars constant embedded
//   in the shipped binary. A binary-level grep exposes any tampering of
//   the verify path.
// - `verifyLicense` is the ONLY exported verifier. It is `Object.freeze`d
//   at module export per PITFALLS §Pitfall 6 — runtime reassignment throws
//   TypeError in strict mode. Helper functions (`hashFingerprint`,
//   `parseLicenseSidecar`) stay editable for tests.
// - Raw bytes never round-trip through `JSON.parse`/`JSON.stringify` —
//   the signature is computed over the exact bytes the vendor wrote
//   (Pitfall 2: canonicalization breaks signatures).

import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import yauzl from 'yauzl';

// ponytail: sha512 hookup is REQUIRED for @noble/ed25519 v3 — the
// library's default hash is undefined in the v3 release. Without this
// line, ed.verify() throws synchronously (A1 in RESEARCH Assumptions Log).
ed.hashes.sha512 = sha512;

// Embedded Ed25519 public key (32 bytes hex). The matching private key
// lives ONLY on the vendor machine at $LICENSE_SIGNING_KEY_PATH. A
// binary-level grep on the shipped artifact surfaces any tampering of
// this constant — per PITFALLS §Pitfall 6 warning sign #2.
//
// Generated locally via `node -e "const ed=require('@noble/ed25519'); ..."`
// — the matching private key (NOT included here) signs vendor `.lic` files
// via scripts/gen-license.cjs (Plan 04).
export const VENDOR_PUBLIC_KEY_HEX =
  '3b04db95c08623afa65c81dff66bef16ead59ad913348d2348bfa19aa2cf3363';

export type VerifyResult =
  | {
      valid: true;
      vendorId: string;
      licensedAt: number;
      expiresAt: number | null;
    }
  | {
      valid: false;
      reason: 'SIGNATURE_MISMATCH' | 'FINGERPRINT_MISMATCH' | 'MALFORMED_PAYLOAD' | 'EXPIRED';
    };

/**
 * SHA-256 fingerprint over the three hardware identifiers per LIC-02 + D-12.
 * Pure Node stdlib; mirrors the existing `src/main/auth/pin.ts:createHash`
 * usage. Exported separately so tests can assert SHA-256 stability without
 * spawning the disk-serial subprocess.
 */
export function hashFingerprint(parts: {
  cpuModel: string;
  diskSerial: string;
  mac: string;
}): string {
  return createHash('sha256')
    .update(`${parts.cpuModel}|${parts.diskSerial}|${parts.mac}`, 'utf8')
    .digest('hex');
}

/**
 * Parse a `.lic` zip buffer (archiver-produced) and extract the two
 * sidecar entries: `license.json` (UTF-8 payload) + `license.sig` (raw
 * 64-byte Ed25519 signature). Throws `Error('MALFORMED_PAYLOAD: ...')`
 * if either entry is missing. Signature bytes are returned verbatim —
 * no UTF-8 decoding (Pitfall 2: signature corruption).
 */
export function parseLicenseSidecar(zipBuffer: Buffer): Promise<{
  json: Buffer;
  signature: Buffer;
}> {
  return new Promise((resolve, reject) => {
    // yauzl.fromBuffer avoids writing a temp file; matches the disk-side
    // path that Plan 04's loadAndVerifyLicense will exercise.
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('MALFORMED_PAYLOAD: yauzl.fromBuffer returned null'));
        return;
      }
      const entries: Record<string, Buffer> = {};
      zipfile.readEntry();
      zipfile.on('error', (zipErr: Error) => reject(zipErr));
      zipfile.on('end', () => {
        const json = entries['license.json'];
        const signature = entries['license.sig'];
        if (!json || !signature) {
          reject(
            new Error(
              'MALFORMED_PAYLOAD: missing license.json or license.sig entry in sidecar zip',
            ),
          );
          return;
        }
        resolve({ json, signature });
      });
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== 'license.json' && entry.fileName !== 'license.sig') {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            reject(streamErr ?? new Error('MALFORMED_PAYLOAD: failed to open sidecar entry stream'));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            entries[entry.fileName] = Buffer.concat(chunks);
            zipfile.readEntry();
          });
          stream.on('error', (streamErr2: Error) => reject(streamErr2));
        });
      });
    });
  });
}

function _verifyLicense(args: {
  licenseJson: Buffer;
  signature: Buffer;
  publicKeyHex: string;
  machineFingerprint: string;
}): VerifyResult {
  const { licenseJson, signature, publicKeyHex, machineFingerprint } = args;

  // Step 1: parse the JSON payload. JSON.parse errors surface as MALFORMED_PAYLOAD.
  let payload: {
    vendorId?: unknown;
    machineFingerprint?: unknown;
    licensedAt?: unknown;
    expiresAt?: unknown;
  };
  try {
    payload = JSON.parse(licenseJson.toString('utf8'));
  } catch {
    return { valid: false, reason: 'MALFORMED_PAYLOAD' };
  }

  if (
    typeof payload.vendorId !== 'string' ||
    typeof payload.machineFingerprint !== 'string' ||
    typeof payload.licensedAt !== 'number' ||
    (payload.expiresAt !== null && typeof payload.expiresAt !== 'number')
  ) {
    return { valid: false, reason: 'MALFORMED_PAYLOAD' };
  }

  // Step 2: Ed25519 signature verification over the RAW JSON bytes
  // (NOT JSON.parse→stringify round-trip — that breaks byte-stability,
  // see RESEARCH Pitfall 2 + D-09).
  if (signature.length !== 64) {
    return { valid: false, reason: 'MALFORMED_PAYLOAD' };
  }
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = Buffer.from(publicKeyHex, 'hex');
    if (publicKeyBytes.length !== 32) {
      return { valid: false, reason: 'MALFORMED_PAYLOAD' };
    }
  } catch {
    return { valid: false, reason: 'MALFORMED_PAYLOAD' };
  }

  let sigValid: boolean;
  try {
    sigValid = ed.verify(signature, licenseJson, publicKeyBytes);
  } catch {
    return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  }
  if (!sigValid) {
    return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  }

  // Step 3: fingerprint match. The vendor signed a payload that includes
  // the clinic's machine fingerprint; verify against the runtime-computed
  // fingerprint (CPU + disk serial + MAC).
  if (payload.machineFingerprint !== machineFingerprint) {
    return { valid: false, reason: 'FINGERPRINT_MISMATCH' };
  }

  // Step 4: expiry check (only when the payload specifies a non-null
  // expiresAt; perpetual licenses set expiresAt: null).
  const expiresAt = payload.expiresAt;
  if (expiresAt !== null && expiresAt <= Date.now()) {
    return { valid: false, reason: 'EXPIRED' };
  }

  return {
    valid: true,
    vendorId: payload.vendorId,
    licensedAt: payload.licensedAt,
    expiresAt,
  };
}

// Per PITFALLS §Pitfall 6 + CONTEXT D-09: verify is the SINGLE source of
// license truth; freeze the exported function reference so runtime
// reassignment throws TypeError in strict mode (Vitest runs in strict
// mode by default). Helper functions stay editable for tests.
export const verifyLicense = Object.freeze(_verifyLicense) as typeof _verifyLicense;