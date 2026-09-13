// @vitest-environment node
// Phase 8 / Plan 03 — license-gate-blocks-procedure integration test (LIC-03 + LIC-04).
//
// Per the plan <behavior> block: RUN_SMOKE=1 test that proves the IPC gate
// wraps the real `procedures.create` handler in `src/main/index.ts` (NOT a
// mock). The flow:
//
//   Step 1 — fresh DB, no license, no trial. Call the procedures IPC
//             handler directly (no real ipcMain — the test stubs the
//             Electron surface so the `registerProceduresIpc` call
//             captures its handler in a Map). Assert: returns
//             `{ ok: false, code: 'IPC_LICENSE_INVALID' }`. Assert: NO
//             row in `procedures` table (the gate short-circuits BEFORE
//             the handler runs).
//
//   Step 2 — write a valid `.lic` sidecar (license.json + license.sig)
//             using the test keypair whose public half matches the
//             embedded `VENDOR_PUBLIC_KEY_HEX` constant. Call
//             `invalidateLicenseCache()` so the next `getLicenseStatus()`
//             reads the new sidecar.
//
//   Step 3 — call the procedures IPC handler again. Assert: returns the
//             expected `Procedure` row (gate passes; the handler runs;
//             the row is inserted).
//
//   Final — assert: when the gate blocked, NO `procedures` row exists;
//           when the gate passed, the row exists. Proves the wire is
//           end-to-end correct (the real handler is gated, not a stub).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';


ed.hashes.sha512 = sha512;

const tmpDir = mkdtempSync(path.join(tmpdir(), 'gate-blocks-procedure-'));

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string): string => tmpDir,
    isPackaged: false,
    getName: (): string => 'colonoscopist-gate-smoke',
    getVersion: (): string => '0.0.0',
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
  },
  ipcMain: {
    handle: (channel: string, cb: (...args: unknown[]) => unknown) => {
      // Capture every handler so the test can invoke them directly.
      handlers.set(channel, cb);
    },
    on: () => {},
  },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null, on: () => {}, removeListener: () => {} },
  shell: { showItemInFolder: () => {}, openPath: async () => '' },
  BrowserWindow: { getAllWindows: () => [] },
}));

// ponytail: truthy check (not === '1') — vitest worker inheritance of
// RUN_SMOKE is reliable but a strict equality on '1' failed in dev. Same
// pattern as 07-06 backup-restore-roundtrip.
const smokeEnabled = Boolean(process.env.RUN_SMOKE);

const handlers = new Map<string, (...args: unknown[]) => unknown>();

// Vendor private key whose matching public key equals the embedded
// VENDOR_PUBLIC_KEY_HEX in src/main/license/verify.ts. This makes the
// integration test exercise the SAME shipped verify path.
const VENDOR_PRIVATE_HEX =
  'fa3efefc7150cbcf256bf2aabd6cd799c56b094f5497267030ab8699d636eec6';

type CreateProcedureInput = {
  patientId: string;
  doctorId: string;
  presetSummary: import('@shared/ipc-contract').PresetSummary;
};

async function registerProceduresHandlerWithDeps(opts: {
  createProcedure: (input: CreateProcedureInput) => import('@shared/ipc-contract').Procedure;
}): Promise<void> {
  const { registerProceduresIpc } = await import(
    '../../src/main/ipc/procedures'
  );
  registerProceduresIpc(opts);
}

async function makePatient(): Promise<string> {
  const { patientRepo } = await import('../../src/main/db/patients');
  const created = patientRepo.create({
    fullName: 'Gate Test Patient',
    dob: '1980-01-01',
    gender: 'male',
    phone: null,
    notes: null,
  });
  return created.id;
}

async function proceduresCreate(patientId: string): Promise<unknown> {
  const handler = handlers.get('procedures:create');
  if (!handler) throw new Error('procedures:create handler not registered');
  return handler({ sender: null }, { patientId });
}

async function listProcedures(): Promise<unknown[]> {
  const { getDb } = await import('../../src/main/db');
  const db = getDb();
  return db.prepare(`SELECT id, patient_id FROM procedures`).all() as unknown[];
}

async function writeLicSidecar(fingerprint: string): Promise<void> {
  const { licenseDir } = await import('../../src/main/paths');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(licenseDir(), { recursive: true });

  const payload = {
    vendorId: 'colonoscopist-test',
    machineFingerprint: fingerprint,
    licensedAt: 1700000000000,
    expiresAt: null,
  };
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const vendorPrivate = Buffer.from(VENDOR_PRIVATE_HEX, 'hex');
  const signature = Buffer.from(await ed.signAsync(json, vendorPrivate));

  // Status.ts reads the sidecar from disk — write `license.json` +
  // `license.sig` as flat files. The vendored `.lic` archive is irrelevant
  // here because Plan 03 ships ONLY the gate (Plan 04 ships
  // loadAndVerifyLicense + archive extraction; not needed for this
  // gate-behavior assertion).
  writeFileSync(path.join(licenseDir(), 'license.json'), json);
  writeFileSync(path.join(licenseDir(), 'license.sig'), signature);
}

beforeAll(async () => {
  // Force-init the live DB at the mocked userData via wizardBootstrap.
  // The same wizard path Plan 07-06's backup-restore-roundtrip uses.
  const { getDb } = await import('../../src/main/db');
  const { wizardBootstrap, login } = await import('../../src/main/auth');
  const { session } = await import('../../src/main/auth/session');
  getDb();
  const r = await wizardBootstrap({
    fullName: 'Dr. Gate',
    clinicName: 'Gate Clinic',
    pin: '1234',
  });
  await login({ userId: r.userId, pin: '1234' });
  expect(session.currentUserId).toBe(r.userId);

  // Register the procedures IPC surface with a real repo-backed
  // createProcedure so the gate's "block" path is provably distinct from
  // the gate's "pass" path (a real row INSERT happens only when the gate
  // permits the handler to run).
  const proceduresRepoMod = await import('../../src/main/db/procedures-repo');
  const proceduresRepo = proceduresRepoMod.proceduresRepo;
  await registerProceduresHandlerWithDeps({
    createProcedure: ({ patientId, doctorId, presetSummary }) =>
      proceduresRepo.insert({
        patientId,
        doctorId,
        videoPath: '',
        presetSummary,
        audioDeviceName: null,
      }),
  });

  // Lock the disk-serial spawn to a known value so the test's fingerprint
  // is deterministic across runs + machines. fingerprint.ts exports a
  // `__fingerprint` test-seam object; setting `__diskSerialForTest`
  // short-circuits the wmic spawn.
  const { __fingerprint } = await import('../../src/main/license/fingerprint');
  __fingerprint.__diskSerialForTest = 'mock-disk-serial';
}, 60_000);

afterAll(() => {
  // Best-effort cleanup; Windows holds file handles briefly after the
  // test process exits so rmSync may EBUSY on the WAL files. The dir
  // sits in tmpdir so the OS will sweep it.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe.skipIf(!smokeEnabled)(
  'license gate blocks procedures.create end-to-end (LIC-03 + LIC-04)',
  () => {
    let patientId: string;

    beforeEach(async () => {
      // Fresh patient row per test so the "row exists" assertion is
      // isolated.
      patientId = await makePatient();
    });

    it("with state='unactivated', procedures.create returns IPC_LICENSE_INVALID and inserts nothing", async () => {
      // Reset the cache so the next getLicenseStatus reads fresh from disk
      // (the previous test might have left a licensed sidecar behind).
      const { invalidateLicenseCache } = await import('../../src/main/license/status');
      invalidateLicenseCache();

      // Clear the license sidecar so the state falls back to the trial
      // branch → then with no trial row → state='unactivated'.
      const { licenseDir } = await import('../../src/main/paths');
      const jsonPath = path.join(licenseDir(), 'license.json');
      const sigPath = path.join(licenseDir(), 'license.sig');
      try {
        rmSync(jsonPath, { force: true });
        rmSync(sigPath, { force: true });
      } catch {
        // ignore if files don't exist yet
      }
      // Make sure no trial_started_at row exists (otherwise we'd land in
      // 'trial' state).
      const { getDb } = await import('../../src/main/db');
      const db = getDb();
      db.prepare(`DELETE FROM settings WHERE key = 'trial_started_at'`).run();
      invalidateLicenseCache();

      const result = await proceduresCreate(patientId);
      expect(result).toEqual({ ok: false, code: 'IPC_LICENSE_INVALID' });

      const rows = await listProcedures();
      const matches = rows.filter((r) => (r as { patient_id: string }).patient_id === patientId);
      expect(matches).toHaveLength(0);
    });

    it("with state='licensed' (sidecar present), procedures.create returns the inserted Procedure row", async () => {
      // Recompute the canonical fingerprint (matches the test's locked
      // disk-serial).
      const { computeMachineFingerprint } = await import(
        '../../src/main/license/fingerprint'
      );
      const fingerprint = await computeMachineFingerprint();

      await writeLicSidecar(fingerprint);
      expect(existsSync(path.join(tmpDir, 'data', 'license', 'license.json'))).toBe(true);

      const { invalidateLicenseCache } = await import('../../src/main/license/status');
      invalidateLicenseCache();

      const result = await proceduresCreate(patientId);
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      const created = result as { id: string; patientId: string };
      expect(created.id).toBeTruthy();
      expect(created.patientId).toBe(patientId);

      const rows = await listProcedures();
      const matches = rows.filter((r) => (r as { patient_id: string }).patient_id === patientId);
      expect(matches).toHaveLength(1);
    });
  },
);

if (!smokeEnabled) {
  describe('license-gate-blocks-procedure — disabled (RUN_SMOKE not set)', () => {
    it('set RUN_SMOKE=1 to enable the gate-blocks-procedure integration smoke', () => {
      expect(smokeEnabled).toBe(false);
    });
  });
}
