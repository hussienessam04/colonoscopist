// @vitest-environment node
// Phase 8 / Plan 06 — audit.test.ts (LIC-04 + AUDIT-01 + D-11).
//
// Per the plan <behavior> block: 4 cases cover every license audit
// action:
//   1. `license.trial_started` — emitted by wizardBootstrap on first
//      launch (Plan 02). Metadata: { trialStartedAt: <ms> }. user_id
//      matches the wizard admin's userId.
//   2. `license.activated` — emitted by loadAndVerifyLicense on success
//      (Plan 04). Metadata: { vendorId, fingerprintHash, expiresAt }.
//      user_id IS NULL (workstation-level event).
//   3. `license.invalid` — emitted by loadAndVerifyLicense on failure
//      (Plan 04). Metadata: { reason, fingerprintHash }. user_id IS
//      NULL.
//   4. `license.gate_rejected` — emitted by licenseGated on every
//      rejection (Plan 03). Metadata: { channel, fingerprintHash,
//      code }. user_id IS NULL.
//
// The trial_started case is wired by exercising wizardBootstrap against
// a real DB (the same path Plan 02's integration test uses); the other
// 3 cases run against mocks of the audit helper + status reader because
// loadAndVerifyLicense's Ed25519 verify + sidecar extraction path is
// already covered by tests/main/license/load-license.test.ts. Here we
// only assert the audit-row shape, so a thin mock surface is sufficient.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

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

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-license-audit-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('license audit emission (LIC-04 + AUDIT-01 + D-11)', () => {
  it('license.trial_started: wizardBootstrap writes the row inside the txn with userId = wizard admin', async () => {
    // The trial row is written via direct INSERT inside wizardBootstrap's
    // db.transaction — the same place it ships in production. We exercise
    // the real wizard path against a real DB so the assertion catches
    // metadata drift + user_id semantics.
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    getDb();

    const wizardResult = await wizardBootstrap({
      fullName: 'Dr. Trial',
      clinicName: 'Audit Clinic',
      pin: '1234',
    });

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT user_id, action, entity_type, entity_id, metadata, outcome
         FROM audit_log WHERE action = 'license.trial_started'`,
      )
      .all() as Array<{
      user_id: string | null;
      action: string;
      entity_type: string | null;
      entity_id: string | null;
      metadata: string | null;
      outcome: string;
    }>;

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    // The trial row's user_id matches the wizard admin (wizardBootstrap
    // writes it explicitly because session.currentUserId is null at the
    // point the row is inserted — D-11 verbatim).
    expect(row?.user_id).toBe(wizardResult.userId);
    expect(row?.action).toBe('license.trial_started');
    expect(row?.entity_type).toBe('license');
    expect(row?.entity_id).toBeNull();
    expect(row?.outcome).toBe('ok');
    const meta = JSON.parse(row?.metadata ?? '{}') as { trialStartedAt: number };
    expect(typeof meta.trialStartedAt).toBe('number');
    expect(meta.trialStartedAt).toBeGreaterThan(0);

    closeDb();
  });

  it('license.activated: loadAndVerifyLicense happy path emits the row with user_id = null', async () => {
    // loadAndVerifyLicense is exercised in load-license.test.ts with real
    // Ed25519 keypairs. Here we only need to assert the audit row shape,
    // so the test mocks the audit helper to capture the row emission.
    // The shape assertion (entityType, metadata, user_id=null) is the
    // contract this test guards.
    const captured: Array<Record<string, unknown>> = [];
    vi.doMock('../../../src/main/db/audit', () => ({
      audit: (opts: Record<string, unknown>) => {
        captured.push(opts);
      },
      auditRepo: { append: () => {}, list: () => ({ rows: [], total: 0 }) },
    }));

    // Stub fingerprint compute so the audit row's metadata.fingerprintHash
    // is deterministic + the test doesn't depend on the host's wmic spawn.
    vi.doMock('../../../src/main/license/fingerprint', () => ({
      computeMachineFingerprint: async () => 'a'.repeat(64),
    }));

    // Stub the verify.ts VENDOR_PUBLIC_KEY_HEX to a key we control so
    // we can sign with the matching private key without touching disk.
    let testPubKeyHex = '';
    const ed = await import('@noble/ed25519');
    const { sha512 } = await import('@noble/hashes/sha2.js');
    ed.hashes.sha512 = sha512;
    const k = ed.keygen();
    testPubKeyHex = Buffer.from(await ed.getPublicKeyAsync(k.secretKey)).toString('hex');

    vi.doMock('../../../src/main/license/verify', async () => {
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

    // Build a minimal .lic zip in memory; loadAndVerifyLicense reads from
    // disk so we use os.tmpdir() for the .lic file.
    const os = await import('node:os');
    const fs = await import('node:fs');
    const archiverMod = await import('archiver');
    const licPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.lic`);
    const payload = {
      vendorId: 'test-vendor',
      machineFingerprint: 'a'.repeat(64),
      licensedAt: 1700000000000,
      expiresAt: null as number | null,
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = Buffer.from(await ed.signAsync(json, k.secretKey));

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(licPath);
      const archive = new (archiverMod.default ?? archiverMod.ZipArchive as never)({
        zlib: { level: 9 },
      } as never);
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(json, { name: 'license.json' });
      archive.append(sig, { name: 'license.sig' });
      void archive.finalize();
    });

    const { loadAndVerifyLicense } = await import(
      '../../../src/main/license/load-license'
    );
    const result = await loadAndVerifyLicense(licPath);
    expect(result.ok).toBe(true);

    // Find the license.activated row in the captured array. loadAndVerifyLicense
    // may have emitted additional rows on retry paths; assert only the
    // activated one.
    const activatedRows = captured.filter((r) => r['action'] === 'license.activated');
    expect(activatedRows).toHaveLength(1);
    const row = activatedRows[0];
    expect(row).toBeDefined();
    expect(row?.['entityType']).toBe('license');
    expect(row?.['outcome']).toBe('ok');
    expect(row?.['userId']).toBeNull();
    expect(row?.['metadata']).toEqual({
      vendorId: 'test-vendor',
      fingerprintHash: 'a'.repeat(64),
      expiresAt: null,
    });

    try {
      rmSync(licPath, { force: true });
    } catch {
      // ignore
    }
  });

  it('license.invalid: tampered JSON emits the row with reason + fingerprintHash + user_id = null', async () => {
    // The same path as load-license.test.ts's tampered-JSON case, but we
    // mock the audit helper to assert the audit row shape. We only need
    // the SHAPE — the verify result was already covered by the dedicated
    // load-license.test.ts cases.
    const captured: Array<Record<string, unknown>> = [];
    vi.doMock('../../../src/main/db/audit', () => ({
      audit: (opts: Record<string, unknown>) => {
        captured.push(opts);
      },
      auditRepo: { append: () => {}, list: () => ({ rows: [], total: 0 }) },
    }));

    vi.doMock('../../../src/main/license/fingerprint', () => ({
      computeMachineFingerprint: async () => 'b'.repeat(64),
    }));

    let testPubKeyHex = '';
    const ed = await import('@noble/ed25519');
    const { sha512 } = await import('@noble/hashes/sha2.js');
    ed.hashes.sha512 = sha512;
    const k = ed.keygen();
    testPubKeyHex = Buffer.from(await ed.getPublicKeyAsync(k.secretKey)).toString('hex');

    vi.doMock('../../../src/main/license/verify', async () => {
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

    // Build a zip with a tampered JSON (one byte flipped AFTER signing).
    const os = await import('node:os');
    const fs = await import('node:fs');
    const archiverMod = await import('archiver');
    const licPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.lic`);
    const payload = {
      vendorId: 'test-vendor',
      machineFingerprint: 'b'.repeat(64),
      licensedAt: 1700000000000,
      expiresAt: null as number | null,
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = Buffer.from(await ed.signAsync(json, k.secretKey));
    const tampered = Buffer.from(json);
    tampered[14] = (tampered[14] ?? 0) ^ 0x01;

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(licPath);
      const archive = new (archiverMod.default ?? archiverMod.ZipArchive as never)({
        zlib: { level: 9 },
      } as never);
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(tampered, { name: 'license.json' });
      archive.append(sig, { name: 'license.sig' });
      void archive.finalize();
    });

    const { loadAndVerifyLicense } = await import(
      '../../../src/main/license/load-license'
    );
    const result = await loadAndVerifyLicense(licPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('SIGNATURE_MISMATCH');
    }

    const invalidRows = captured.filter((r) => r['action'] === 'license.invalid');
    expect(invalidRows.length).toBeGreaterThanOrEqual(1);
    const row = invalidRows[0];
    expect(row).toBeDefined();
    expect(row?.['entityType']).toBe('license');
    expect(row?.['outcome']).toBe('failed');
    expect(row?.['userId']).toBeNull();
    expect(row?.['metadata']?.['reason']).toBe('SIGNATURE_MISMATCH');
    expect(row?.['metadata']?.['fingerprintHash']).toBe('b'.repeat(64));

    try {
      rmSync(licPath, { force: true });
    } catch {
      // ignore
    }
  });

  it('license.gate_rejected: licenseGated emits the row on every rejection with channel + fingerprintHash + code + user_id = null', async () => {
    // Mirrors the audit shape assertions in tests/main/license/gate.test.ts
    // case #2 + case #3 + the audit-shape case #8, but lifted out as an
    // audit-focused test so the D-11 contract is guarded independently.
    const captured: Array<Record<string, unknown>> = [];
    vi.doMock('../../../src/main/db/audit', () => ({
      audit: (opts: Record<string, unknown>) => {
        captured.push(opts);
      },
      auditRepo: { append: () => {}, list: () => ({ rows: [], total: 0 }) },
    }));

    // Stub the status helper to return unactivated state — the gate's
    // rejection branch fires when state !== trial + state !== licensed.
    let activeState: 'unactivated' | 'expired' = 'unactivated';
    vi.doMock('../../../src/main/license/status', () => ({
      getLicenseStatus: async () => ({
        state: activeState,
        machineId: 'f'.repeat(64),
      }),
    }));

    const { licenseGated } = await import('../../../src/main/license/gate');

    // Case A: unactivated → IPC_LICENSE_INVALID
    activeState = 'unactivated';
    const handlerUnactivated = vi.fn(() => 'should-not-run');
    const wrapped = licenseGated('patients:create', handlerUnactivated as never);
    const resultA = await wrapped({ sender: null } as never, { patientId: 'p1' });
    expect(resultA).toEqual({ ok: false, code: 'IPC_LICENSE_INVALID' });
    expect(handlerUnactivated).not.toHaveBeenCalled();

    // Case B: expired → IPC_LICENSE_EXPIRED (different code, different row)
    activeState = 'expired';
    const handlerExpired = vi.fn(() => 'should-not-run');
    const wrappedB = licenseGated('procedures:create', handlerExpired as never);
    const resultB = await wrappedB({ sender: null } as never, { patientId: 'p1' });
    expect(resultB).toEqual({ ok: false, code: 'IPC_LICENSE_EXPIRED' });
    expect(handlerExpired).not.toHaveBeenCalled();

    // Both rows must be in the captured array; the shape is identical
    // except for the code field (per D-11).
    const rejectedRows = captured.filter((r) => r['action'] === 'license.gate_rejected');
    expect(rejectedRows).toHaveLength(2);

    const rowA = rejectedRows[0];
    expect(rowA?.['entityType']).toBe('license');
    expect(rowA?.['entityId']).toBe('patients:create');
    expect(rowA?.['outcome']).toBe('failed');
    expect(rowA?.['userId']).toBeNull();
    expect(rowA?.['metadata']).toEqual({
      channel: 'patients:create',
      fingerprintHash: 'f'.repeat(64),
      code: 'IPC_LICENSE_INVALID',
    });

    const rowB = rejectedRows[1];
    expect(rowB?.['entityType']).toBe('license');
    expect(rowB?.['entityId']).toBe('procedures:create');
    expect(rowB?.['outcome']).toBe('failed');
    expect(rowB?.['userId']).toBeNull();
    expect(rowB?.['metadata']).toEqual({
      channel: 'procedures:create',
      fingerprintHash: 'f'.repeat(64),
      code: 'IPC_LICENSE_EXPIRED',
    });
  });
});