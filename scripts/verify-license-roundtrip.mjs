// End-to-end license test — uses yauzl (what production uses) + the
// shipped VENDOR_PUBLIC_KEY_HEX inlined. Run BEFORE rebuild/publish.

import yauzl from 'yauzl';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

// MUST match the constant in src/main/license/verify.ts.
const VENDOR_PUBLIC_KEY_HEX =
  'fe5adcec4424f65402686c7fd3f175fead71dd53fcec9f85326d35e0b43038e9';

ed.hashes.sha512 = sha512;

function unzipSidecar(zipBuffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('yauzl returned null'));
      const entries = {};
      zipfile.on('error', reject);
      zipfile.on('end', () => {
        const json = entries['license.json'];
        const sig = entries['license.sig'];
        if (!json || !sig) return reject(new Error('missing license.json or license.sig'));
        resolve({ json, signature: sig });
      });
      zipfile.on('entry', (entry) => {
        if (entry.fileName !== 'license.json' && entry.fileName !== 'license.sig') {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (sErr, stream) => {
          if (sErr || !stream) return reject(sErr ?? new Error('stream error'));
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            entries[entry.fileName] = Buffer.concat(chunks);
            zipfile.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zipfile.readEntry();
    });
  });
}

async function verifyLicense({ licenseJson, signature, publicKeyHex, machineFingerprint }) {
  let payload;
  try { payload = JSON.parse(licenseJson.toString('utf8')); }
  catch { return { valid: false, reason: 'MALFORMED_PAYLOAD' }; }

  if (
    typeof payload.vendorId !== 'string' ||
    typeof payload.machineFingerprint !== 'string' ||
    typeof payload.licensedAt !== 'number' ||
    (payload.expiresAt !== null && typeof payload.expiresAt !== 'number')
  ) return { valid: false, reason: 'MALFORMED_PAYLOAD' };

  if (signature.length !== 64) return { valid: false, reason: 'MALFORMED_PAYLOAD' };
  const pub = Buffer.from(publicKeyHex, 'hex');
  if (pub.length !== 32) return { valid: false, reason: 'MALFORMED_PAYLOAD' };
  let sigValid;
  try { sigValid = ed.verify(signature, licenseJson, pub); }
  catch { return { valid: false, reason: 'SIGNATURE_MISMATCH' }; }
  if (!sigValid) return { valid: false, reason: 'SIGNATURE_MISMATCH' };

  if (payload.machineFingerprint !== machineFingerprint)
    return { valid: false, reason: 'FINGERPRINT_MISMATCH' };

  if (payload.expiresAt !== null && payload.expiresAt <= Date.now())
    return { valid: false, reason: 'EXPIRED' };

  return { valid: true, vendorId: payload.vendorId, licensedAt: payload.licensedAt, expiresAt: payload.expiresAt };
}

import fs from 'node:fs';

const licPath = process.argv[2];
const targetFingerprint = process.argv[3];
if (!licPath) {
  console.error('usage: node scripts/verify-license-roundtrip.mjs <lic-path> [expected-fingerprint]');
  process.exit(2);
}

const buf = fs.readFileSync(licPath);
const { json, signature } = await unzipSidecar(buf);
const payload = JSON.parse(json.toString('utf8'));
const fingerprint = targetFingerprint ?? payload.machineFingerprint;

console.log('embedded fingerprint:        ', payload.machineFingerprint);
console.log('expected fingerprint (target):', fingerprint);
console.log('match:                       ', payload.machineFingerprint === fingerprint);
console.log('payload:                     ', JSON.stringify(payload, null, 2));
console.log('signature length:            ', signature.length, '(expected 64)');
console.log('shipped VENDOR_PUBLIC_KEY_HEX:', VENDOR_PUBLIC_KEY_HEX);
console.log();
console.log('verifying against SHIPPED verify path...');

const result = await verifyLicense({
  licenseJson: json,
  signature,
  publicKeyHex: VENDOR_PUBLIC_KEY_HEX,
  machineFingerprint: fingerprint,
});

console.log('result:', JSON.stringify(result, null, 2));
if (!result.valid) {
  console.error(`\n❌ FAIL — license would NOT load in the app: ${result.reason}`);
  process.exit(1);
}
console.log('\n✅ PASS — this license will verify successfully when loaded in the app.');
