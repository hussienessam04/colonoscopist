#!/usr/bin/env node
// Phase 8 / Plan 04 — Vendor-side license signing CLI (NOT bundled with the
// shipped app). CONTEXT D-13 verbatim.
//
// Usage: node scripts/gen-license.cjs <machine-fingerprint> <vendor-id>
//
//   - <machine-fingerprint>: SHA-256 hex of CPU.model + diskSerial + MAC,
//     computed by the clinic and surfaced in the License sub-page per D-12.
//   - <vendor-id>: free-form vendor identifier (e.g. "vendor-abc").
//
// Reads the Ed25519 private key from the LICENSE_SIGNING_KEY_PATH env var
// (default ./secrets/ed25519.private — gitignored). The matching public
// key is the embedded VENDOR_PUBLIC_KEY_HEX constant in
// src/main/license/verify.ts (Plan 01 shipped the constant + the matching
// private key was generated on the vendor's machine at keypair creation
// time).
//
// Produces a sidecar zip of license.json + license.sig and writes
// <machineId>.lic to cwd. The .lic file is what the clinic loads via
// the LICENSE_ACTIVATE / LICENSE_PICK_AND_ACTIVATE IPC handlers.

const fs = require('node:fs');
const path = require('node:path');

// ponytail: archiver v8 + @noble/ed25519 v3 + @noble/hashes are ESM-only —
// require() returns the namespace object, not the callable. Dynamic import
// is the only interop shape that works under Node 22+ CJS (same root cause
// as the Plan 08-07 ESM fix; src/main/backup/index.ts:52 already uses this
// pattern).

async function main() {
  const [machineFingerprint, vendorId] = process.argv.slice(2);
  if (!machineFingerprint || !vendorId) {
    console.error('Usage: node scripts/gen-license.cjs <machine-fingerprint> <vendor-id>');
    console.error('  Set LICENSE_SIGNING_KEY_PATH to the private key file (default: ./secrets/ed25519.private)');
    process.exit(1);
  }

  const archiverMod = await import('archiver');
  const { ZipArchive } = archiverMod;
  const ed = await import('@noble/ed25519');
  const hashes = await import('@noble/hashes/sha2.js');
  // ponytail: sha512 hookup is REQUIRED for @noble/ed25519 v3 — the
  // library's default hash is undefined. Without this line, ed.signAsync
  // throws synchronously (same reason as src/main/license/verify.ts).
  ed.hashes.sha512 = hashes.sha512;

  const keyPath =
    process.env.LICENSE_SIGNING_KEY_PATH || path.join(process.cwd(), 'secrets', 'ed25519.private');
  let privateKey;
  try {
    const keyRaw = fs.readFileSync(keyPath, 'utf8').trim();
    // Accept both formats: comma-separated decimal bytes (legacy) OR pure hex
    if (keyRaw.includes(',')) {
      privateKey = Uint8Array.from(keyRaw.split(',').map((s) => parseInt(s.trim(), 10)));
    } else {
      privateKey = Uint8Array.from(keyRaw.match(/.{1,2}/g).map((h) => parseInt(h, 16)));
    }
  } catch (err) {
    console.error(`Failed to read private key from ${keyPath}: ${err.message}`);
    process.exit(2);
  }

  if (privateKey.length !== 32) {
    console.error(
      `Private key must be exactly 32 bytes (got ${privateKey.length}).`,
    );
    process.exit(2);
  }

  // CONTEXT D-13: payload includes the machine fingerprint + vendorId +
  // licensedAt + (perpetual) expiresAt. The shipped verify path consumes
  // these verbatim via parseLicenseSidecar + verifyLicense.
  const payload = {
    vendorId,
    machineFingerprint,
    licensedAt: Date.now(),
    expiresAt: null, // perpetual
  };
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = Buffer.from(await ed.signAsync(json, privateKey));

  const outPath = `${machineFingerprint.slice(0, 12)}.lic`;
  const output = fs.createWriteStream(outPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(output);
  archive.append(json, { name: 'license.json' });
  archive.append(signature, { name: 'license.sig' });
  await archive.finalize();

  // Wait for the output stream to finish before exiting.
  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
  });

  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
