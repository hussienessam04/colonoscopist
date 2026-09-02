// @vitest-environment node
// Phase 8 / Plan 01 — verify.test.ts (LIC-02).
//
// Per the plan <behavior> block: 6 cases cover happy path, tampered JSON,
// tampered signature, wrong public key, fingerprint mismatch, and the
// `Object.freeze` assertion. The test uses `ed.keygen()` at module scope
// to derive a test keypair; the embedded `VENDOR_PUBLIC_KEY_HEX` constant
// is the one the shipped binary uses, so the roundtrip integration test
// imports the SAME constant (proving constant-vs-constant drift catches).

import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import {
  hashFingerprint,
  verifyLicense,
  VENDOR_PUBLIC_KEY_HEX,
} from '../../../src/main/license/verify';

// ponytail: ensure the test fixture signs with the same SHA-512 hookup
// the shipped verify path uses. Without this, ed.sign() throws on v3.
ed.hashes.sha512 = sha512;

async function makeSignedLicense(publicKey: Uint8Array, privateKey: Uint8Array, fingerprint: string) {
  const payload = {
    vendorId: 'test-vendor',
    machineFingerprint: fingerprint,
    licensedAt: 1700000000000,
    expiresAt: null,
  };
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = await ed.signAsync(json, privateKey);
  return { json, sig, publicKeyHex: Buffer.from(publicKey).toString('hex'), payload };
}

describe('verifyLicense (LIC-02 + Pitfall 6)', () => {
  it('Object.isFrozen(verifyLicense) is true', () => {
    expect(Object.isFrozen(verifyLicense)).toBe(true);
  });

  it('happy path: signed bytes verify and return vendorId + licensedAt + expiresAt', async () => {
    const k = ed.keygen();
    const pub = await ed.getPublicKeyAsync(k.secretKey);
    const fingerprint = hashFingerprint({ cpuModel: 'test-cpu', diskSerial: 'test-disk', mac: '00:11:22:33:44:55' });
    const { json, sig, publicKeyHex } = await makeSignedLicense(pub, k.secretKey, fingerprint);

    const result = await verifyLicense({
      licenseJson: json,
      signature: sig,
      publicKeyHex,
      machineFingerprint: fingerprint,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.vendorId).toBe('test-vendor');
      expect(result.licensedAt).toBe(1700000000000);
      expect(result.expiresAt).toBeNull();
    }
  });

  it('tampered JSON: one byte flipped returns SIGNATURE_MISMATCH', async () => {
    const k = ed.keygen();
    const pub = await ed.getPublicKeyAsync(k.secretKey);
    const fingerprint = hashFingerprint({ cpuModel: 'test-cpu', diskSerial: 'test-disk', mac: '00:11:22:33:44:55' });
    const { json, sig, publicKeyHex } = await makeSignedLicense(pub, k.secretKey, fingerprint);
    // Flip a single byte inside the JSON string content (vendorId "test-vendor" → "test-vendor" with one bit flipped in 't').
    // The payload layout is `{"vendorId":"test-vendor",...}` — index 14 is 't' inside the value string.
    const tampered = Buffer.from(json);
    tampered[14] = (tampered[14] ?? 0) ^ 0x01;

    // Sanity: tampered bytes still parse as valid JSON (just a different value).
    expect(() => JSON.parse(tampered.toString('utf8'))).not.toThrow();

    const result = await verifyLicense({
      licenseJson: tampered,
      signature: sig,
      publicKeyHex,
      machineFingerprint: fingerprint,
    });

    expect(result).toEqual({ valid: false, reason: 'SIGNATURE_MISMATCH' });
  });

  it('tampered signature: one byte flipped returns SIGNATURE_MISMATCH', async () => {
    const k = ed.keygen();
    const pub = await ed.getPublicKeyAsync(k.secretKey);
    const fingerprint = hashFingerprint({ cpuModel: 'test-cpu', diskSerial: 'test-disk', mac: '00:11:22:33:44:55' });
    const { json, sig, publicKeyHex } = await makeSignedLicense(pub, k.secretKey, fingerprint);
    const tamperedSig = Buffer.from(sig);
    tamperedSig[0] = (tamperedSig[0] ?? 0) ^ 0x01;

    const result = await verifyLicense({
      licenseJson: json,
      signature: tamperedSig,
      publicKeyHex,
      machineFingerprint: fingerprint,
    });

    expect(result).toEqual({ valid: false, reason: 'SIGNATURE_MISMATCH' });
  });

  it('wrong public key: a different keypair returns SIGNATURE_MISMATCH', async () => {
    const signer = ed.keygen();
    const pubSigner = await ed.getPublicKeyAsync(signer.secretKey);
    const fingerprint = hashFingerprint({ cpuModel: 'test-cpu', diskSerial: 'test-disk', mac: '00:11:22:33:44:55' });
    const { json, sig } = await makeSignedLicense(pubSigner, signer.secretKey, fingerprint);

    // Different keypair — the verifier.
    const verifier = ed.keygen();
    const pubVerifier = await ed.getPublicKeyAsync(verifier.secretKey);

    const result = await verifyLicense({
      licenseJson: json,
      signature: sig,
      publicKeyHex: Buffer.from(pubVerifier).toString('hex'),
      machineFingerprint: fingerprint,
    });

    expect(result).toEqual({ valid: false, reason: 'SIGNATURE_MISMATCH' });
  });

  it('fingerprint mismatch: signed with fingerprint A, verified against fingerprint B', async () => {
    const k = ed.keygen();
    const pub = await ed.getPublicKeyAsync(k.secretKey);
    const fingerprintA = hashFingerprint({ cpuModel: 'test-cpu', diskSerial: 'disk-A', mac: 'AA:BB:CC:DD:EE:FF' });
    const fingerprintB = hashFingerprint({ cpuModel: 'test-cpu', diskSerial: 'disk-B', mac: 'AA:BB:CC:DD:EE:FF' });
    const { json, sig, publicKeyHex } = await makeSignedLicense(pub, k.secretKey, fingerprintA);

    const result = await verifyLicense({
      licenseJson: json,
      signature: sig,
      publicKeyHex,
      machineFingerprint: fingerprintB,
    });

    expect(result).toEqual({ valid: false, reason: 'FINGERPRINT_MISMATCH' });
  });

  it('VENDOR_PUBLIC_KEY_HEX is exported and is 64 hex chars', () => {
    expect(VENDOR_PUBLIC_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);
  });

  it('malformed JSON returns MALFORMED_PAYLOAD', async () => {
    const garbage = Buffer.from('this is not JSON', 'utf8');
    const sig = Buffer.alloc(64); // length-valid but wrong
    const result = await verifyLicense({
      licenseJson: garbage,
      signature: sig,
      publicKeyHex: VENDOR_PUBLIC_KEY_HEX,
      machineFingerprint: 'anything',
    });
    expect(result).toEqual({ valid: false, reason: 'MALFORMED_PAYLOAD' });
  });
});