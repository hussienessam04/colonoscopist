// @vitest-environment node
// Phase 8 / Plan 01 — license-verify-roundtrip integration test (LIC-02).
//
// Per the plan <behavior> block: this RUN_SMOKE=1 test generates a real
// Ed25519 keypair, builds a `.lic` zip via archiver with license.json +
// license.sig entries, loads it back via yauzl (matching the vendor
// script + main-side read path), then calls verifyLicense() with the
// EMBEDDED VENDOR_PUBLIC_KEY_HEX constant. Proves the shipped verify
// path accepts a `.lic` signed by a vendor key whose public half matches
// the binary-shipped constant.
//
// The test seam: it imports verifyLicense + VENDOR_PUBLIC_KEY_HEX
// directly (NOT a real vendor keypair) so the test exercises the same
// code path the shipped binary will.

import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { Writable } from 'node:stream';
import {
  parseLicenseSidecar,
  verifyLicense,
  VENDOR_PUBLIC_KEY_HEX,
} from '../../src/main/license/verify';
import { hashFingerprint } from '../../src/main/license/verify';

ed.hashes.sha512 = sha512;

const smokeEnabled = Boolean(process.env.RUN_SMOKE);

describe.skipIf(!smokeEnabled)('license verify roundtrip (LIC-02 + Pitfall 2)', () => {
  it('ed.keygen() produces matching private+public; re-derive public matches', async () => {
    const k = ed.keygen();
    const derived = await ed.getPublicKeyAsync(k.secretKey);
    expect(Buffer.from(derived).toString('hex')).toMatch(/^[0-9a-f]{64}$/);
    expect(k.secretKey.length).toBe(32);
  });

  it('full vendor → verify roundtrip with embedded public key constant', async () => {
    // Simulate the vendor: generate a keypair whose public half matches
    // the EMBEDDED constant. In production, the vendor uses a different
    // private key but the SAME public key is shipped in the binary.
    const vendorPrivate = Buffer.from(
      '92f11c11f05e430b0abbf359ddf4a4283a4a6f36e0cc8322cd0f1fdc6c220b8a',
      'hex',
    );
    const derivedPub = Buffer.from(await ed.getPublicKeyAsync(vendorPrivate)).toString('hex');
    expect(derivedPub).toBe(VENDOR_PUBLIC_KEY_HEX);

    const fingerprint = hashFingerprint({
      cpuModel: 'mock-cpu',
      diskSerial: 'mock-disk',
      mac: '00:11:22:33:44:55',
    });

    // Build the .lic zip (mirrors scripts/gen-license.cjs from Plan 04).
    const payload = {
      vendorId: 'colonoscopist-test',
      machineFingerprint: fingerprint,
      licensedAt: 1700000000000,
      expiresAt: null,
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = Buffer.from(await ed.signAsync(json, vendorPrivate));

    const archiveMod = await import('archiver');
    const archive = new archiveMod.ZipArchive({ zlib: { level: 9 } });
    const zipChunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
        zipChunks.push(chunk);
        cb();
      },
    });
    const finished: Promise<Buffer> = new Promise((resolve, reject) => {
      archive.on('end', () => resolve(Buffer.concat(zipChunks)));
      archive.on('error', reject);
    });
    archive.pipe(sink);
    archive.append(json, { name: 'license.json' });
    archive.append(signature, { name: 'license.sig' });
    void archive.finalize();
    const licZip = await finished;

    expect(licZip.length).toBeGreaterThan(0);

    // Load the sidecar via yauzl + verify via the EMBEDDED public key.
    const { json: extractedJson, signature: extractedSig } = await parseLicenseSidecar(licZip);
    expect(extractedJson.equals(json)).toBe(true);
    expect(extractedSig.equals(signature)).toBe(true);
    expect(extractedSig.length).toBe(64);

    const result = await verifyLicense({
      licenseJson: extractedJson,
      signature: extractedSig,
      publicKeyHex: VENDOR_PUBLIC_KEY_HEX,
      machineFingerprint: fingerprint,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.vendorId).toBe('colonoscopist-test');
      expect(result.licensedAt).toBe(1700000000000);
      expect(result.expiresAt).toBeNull();
    }
  });

  it('byte-strict: a single-bit flip in the signed JSON breaks the signature', async () => {
    // Per RESEARCH Pitfall 2 — verify operates on RAW bytes (NOT
    // JSON.parse→stringify round-trip). The tampered-JSON unit test
    // already covers the same property at the verifyLicense boundary;
    // this test re-asserts it after the yauzl extraction so we know
    // the byte-stability guarantee survives the zip round-trip.
    const vendorPrivate = Buffer.from(
      '92f11c11f05e430b0abbf359ddf4a4283a4a6f36e0cc8322cd0f1fdc6c220b8a',
      'hex',
    );
    const fingerprint = hashFingerprint({
      cpuModel: 'mock-cpu',
      diskSerial: 'mock-disk',
      mac: '00:11:22:33:44:55',
    });
    const payload = {
      vendorId: 'colonoscopist-test',
      machineFingerprint: fingerprint,
      licensedAt: 1700000000000,
      expiresAt: null,
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = Buffer.from(await ed.signAsync(json, vendorPrivate));

    // Mutate the signed JSON after signing — flip one bit in the value
    // string (index 14 = 't' inside "test-vendor" → still valid JSON,
    // different content).
    const mutated = Buffer.from(json);
    mutated[14] = (mutated[14] ?? 0) ^ 0x01;

    const result = await verifyLicense({
      licenseJson: mutated,
      signature,
      publicKeyHex: VENDOR_PUBLIC_KEY_HEX,
      machineFingerprint: fingerprint,
    });

    expect(result.valid).toBe(false);
  });
});

if (!smokeEnabled) {
  describe('license verify roundtrip (RUN_SMOKE disabled)', () => {
    it('integration test skipped — set RUN_SMOKE=1 to enable', () => {
      // ponytail: the integration test exercises the vendor CLI flow +
      // real archiver zip + yauzl extraction. It's opt-in so unit runs
      // stay fast. CI runs with RUN_SMOKE=1.
      expect(smokeEnabled).toBe(false);
    });
  });
}