// @vitest-environment node
// Phase 8 / Plan 04 — load-license.test.ts (LIC-03 + D-10 + D-11).
//
// Per the plan <behavior> block: 4 cases cover happy path, tampered JSON,
// fingerprint mismatch, and missing-sidecar-entry. The test generates a
// fresh Ed25519 keypair in-memory via `ed.keygen()` (NOT via the vendor
// CLI — the roundtrip integration is in Plan 01's verify.test.ts), builds
// the sidecar zip via `archiver`, writes to `os.tmpdir()` + `randomUUID()`,
// calls `loadAndVerifyLicense(path)`, and asserts the result shape +
// audit row + sidecar files on disk.
//
// ponytail: audit() is mocked via vi.mock so the test surface isolates
// load-license.ts from the DB. The audit helper's actual SQL doesn't
// matter for these assertions — only that the right action is emitted
// with the right metadata shape.
//
// VENDOR_PUBLIC_KEY_HEX seam — Plan 01's verify.ts embeds the literal
// 32-byte hex constant for the shipped vendor keypair. The matching
// private key lives ONLY on the vendor machine (D-13), so the test
// cannot sign with the matching private key. We override the export
// via `vi.importActual + vi.mock` so the test signs with a fresh
// keypair and the verify path sees the matching public key. The
// verifyLicense + parseLicenseSidecar code is byte-for-byte the same
// as production — only the constant is swapped.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ponytail: ensure the test fixture signs with the same SHA-512 hookup
// the shipped verify path uses. Without this, ed.signAsync throws on v3.
ed.hashes.sha512 = sha512;

let tmpDir: string;
const capturedAudits: Array<Record<string, unknown>> = [];
let testPubKeyHex: string;
let testSecretKey: Uint8Array;

// Single-instance vi.mock for `./verify` with a dynamic VENDOR_PUBLIC_KEY_HEX.
// Filled in by `seedKey()` before each test so the test signs with the
// matching private key.
vi.mock('../../../src/main/license/verify', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/license/verify')>(
    '../../../src/main/license/verify',
  );
  return {
    ...actual,
    get VENDOR_PUBLIC_KEY_HEX() {
      return testPubKeyHex;
    },
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? tmpDir : tmpDir),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

vi.mock('../../../src/main/db/audit', () => ({
  audit: (opts: Record<string, unknown>) => {
    capturedAudits.push(opts);
  },
  auditRepo: {
    append: (opts: Record<string, unknown>) => {
      capturedAudits.push(opts);
    },
    list: () => ({ rows: [], total: 0 }),
  },
}));

async function buildLicZip(
  licPath: string,
  licenseJson: Buffer,
  signature: Buffer | null,
): Promise<void> {
  const archiverMod = await import('archiver');
  const archiverCls = (archiverMod as { default?: unknown }).default
    ? (archiverMod as unknown as { default: new (o?: unknown) => ArchiverInstance }).default
    : (archiverMod as unknown as { ZipArchive: new (o?: unknown) => ArchiverInstance }).ZipArchive;
  return new Promise<void>((resolve, reject) => {
    const output = createWriteStream(licPath);
    const archive = new archiverCls('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', (err: Error) => reject(err));
    archive.on('error', (err: Error) => reject(err));
    archive.pipe(output);
    archive.append(licenseJson, { name: 'license.json' });
    if (signature) {
      archive.append(signature, { name: 'license.sig' });
    }
    void archive.finalize();
  });
}

interface ArchiverInstance {
  on: (e: string, l: (...args: unknown[]) => void) => void;
  pipe: (s: unknown) => unknown;
  append: (d: Buffer | string, opts: { name: string }) => unknown;
  finalize: () => Promise<unknown>;
}

async function seedKey(): Promise<void> {
  const k = ed.keygen();
  testSecretKey = k.secretKey;
  testPubKeyHex = Buffer.from(await ed.getPublicKeyAsync(k.secretKey)).toString('hex');
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'colonosco-load-license-'));
  mkdirSync(join(tmpDir, 'data', 'license'), { recursive: true });
  capturedAudits.length = 0;
  await seedKey();
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('loadAndVerifyLicense (LIC-03 + D-10 + D-11)', () => {
  it('happy path: signed .lic → ok + sidecar files on disk + license.activated audit row', async () => {
    const fingerprint = 'a'.repeat(64);
    const payload = {
      vendorId: 'test-vendor',
      machineFingerprint: fingerprint,
      licensedAt: 1700000000000,
      expiresAt: null as number | null,
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = Buffer.from(await ed.signAsync(json, testSecretKey));

    const licPath = join(tmpDir, `${randomUUID()}.lic`);
    await buildLicZip(licPath, json, sig);

    const { loadAndVerifyLicense } = await import('../../../src/main/license/load-license');
    const result = await loadAndVerifyLicense(licPath, { fingerprintOverride: fingerprint });
    expect(result).toEqual({
      ok: true,
      vendorId: 'test-vendor',
      licensedAt: 1700000000000,
    });

    // Sidecar files should be on disk.
    expect(existsSync(join(tmpDir, 'data', 'license', 'license.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'data', 'license', 'license.sig'))).toBe(true);
    expect(readFileSync(join(tmpDir, 'data', 'license', 'license.json'))).toEqual(json);
    expect(readFileSync(join(tmpDir, 'data', 'license', 'license.sig'))).toEqual(sig);

    // Audit row: license.activated.
    expect(capturedAudits).toHaveLength(1);
    const row = capturedAudits[0];
    expect(row?.['action']).toBe('license.activated');
    expect(row?.['entityType']).toBe('license');
    expect(row?.['entityId']).toBe(licPath);
    expect(row?.['outcome']).toBe('ok');
    expect(row?.['userId']).toBeNull();
    expect(row?.['metadata']).toEqual({
      vendorId: 'test-vendor',
      fingerprintHash: fingerprint,
      expiresAt: null,
    });
  });

  it('tampered JSON: one byte flipped → SIGNATURE_MISMATCH + license.invalid audit row + NO sidecar write', async () => {
    const fingerprint = 'b'.repeat(64);
    const payload = {
      vendorId: 'test-vendor',
      machineFingerprint: fingerprint,
      licensedAt: 1700000000000,
      expiresAt: null as number | null,
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = Buffer.from(await ed.signAsync(json, testSecretKey));

    // Tamper: flip a single byte inside the JSON; the signature still
    // covers the ORIGINAL payload so verify rejects.
    const tamperedJson = Buffer.from(json);
    tamperedJson[14] = (tamperedJson[14] ?? 0) ^ 0x01;
    // Sanity: bytes still parse as JSON (different value, valid format).
    expect(() => JSON.parse(tamperedJson.toString('utf8'))).not.toThrow();

    const licPath = join(tmpDir, `${randomUUID()}.lic`);
    await buildLicZip(licPath, tamperedJson, sig);

    const { loadAndVerifyLicense } = await import('../../../src/main/license/load-license');
    const result = await loadAndVerifyLicense(licPath, { fingerprintOverride: fingerprint });
    expect(result).toEqual({
      ok: false,
      code: 'IPC_LICENSE_INVALID',
      reason: 'SIGNATURE_MISMATCH',
    });

    // Audit row: license.invalid.
    expect(capturedAudits).toHaveLength(1);
    const row = capturedAudits[0];
    expect(row?.['action']).toBe('license.invalid');
    expect(row?.['outcome']).toBe('failed');
    expect(row?.['userId']).toBeNull();
    expect(row?.['metadata']).toEqual({
      reason: 'SIGNATURE_MISMATCH',
      fingerprintHash: fingerprint,
    });

    // Sidecar files should NOT be written.
    expect(existsSync(join(tmpDir, 'data', 'license', 'license.json'))).toBe(false);
    expect(existsSync(join(tmpDir, 'data', 'license', 'license.sig'))).toBe(false);
  });

  it('fingerprint mismatch: signed with fingerprint A → load with fingerprint B → FINGERPRINT_MISMATCH + audit row', async () => {
    const fingerprintA = 'a'.repeat(64);
    const payload = {
      vendorId: 'test-vendor',
      machineFingerprint: fingerprintA,
      licensedAt: 1700000000000,
      expiresAt: null as number | null,
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = Buffer.from(await ed.signAsync(json, testSecretKey));

    const licPath = join(tmpDir, `${randomUUID()}.lic`);
    await buildLicZip(licPath, json, sig);

    const { loadAndVerifyLicense } = await import('../../../src/main/license/load-license');
    const result = await loadAndVerifyLicense(licPath, {
      fingerprintOverride: 'b'.repeat(64),
    });
    expect(result).toEqual({
      ok: false,
      code: 'IPC_LICENSE_INVALID',
      reason: 'FINGERPRINT_MISMATCH',
    });

    // Audit row: license.invalid.
    expect(capturedAudits).toHaveLength(1);
    const row = capturedAudits[0];
    expect(row?.['action']).toBe('license.invalid');
    expect(row?.['metadata']?.['reason']).toBe('FINGERPRINT_MISMATCH');
    expect(row?.['metadata']?.['fingerprintHash']).toBe('b'.repeat(64));

    // Sidecar NOT written.
    expect(existsSync(join(tmpDir, 'data', 'license', 'license.json'))).toBe(false);
  });

  it('missing sidecar entry: zip with only license.json → MALFORMED_PAYLOAD + audit row', async () => {
    const fingerprint = 'c'.repeat(64);
    const payload = {
      vendorId: 'test-vendor',
      machineFingerprint: fingerprint,
      licensedAt: 1700000000000,
      expiresAt: null as number | null,
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8');

    // Build a zip with only license.json (NO license.sig entry).
    const licPath = join(tmpDir, `${randomUUID()}.lic`);
    await buildLicZip(licPath, json, null);

    const { loadAndVerifyLicense } = await import('../../../src/main/license/load-license');
    const result = await loadAndVerifyLicense(licPath, { fingerprintOverride: fingerprint });
    expect(result).toEqual({
      ok: false,
      code: 'IPC_LICENSE_INVALID',
      reason: 'MALFORMED_PAYLOAD',
    });

    // Audit row: license.invalid.
    expect(capturedAudits).toHaveLength(1);
    const row = capturedAudits[0];
    expect(row?.['action']).toBe('license.invalid');
    expect(row?.['metadata']?.['reason']).toBe('MALFORMED_PAYLOAD');
    expect(row?.['metadata']?.['fingerprintHash']).toBe(fingerprint);

    // Sidecar NOT written.
    expect(existsSync(join(tmpDir, 'data', 'license', 'license.json'))).toBe(false);
  });
});
