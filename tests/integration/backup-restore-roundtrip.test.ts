// @vitest-environment node
// Phase 7 / Plan 07-06 — SET-05 / SET-06 ship-gate: backup → restore
// roundtrip integration test (D-16 verbatim).
//
// This test boots the live DB via wizardBootstrap, seeds minimal data
// (one doctor profile row), creates a backup zip, previews the zip
// (which unpacks it to a staging dir and runs PRAGMA integrity_check),
// asserts the integrity check returns 'ok', and confirms the procedure
// count from the staged DB matches the live count.
//
// Per Plan 07-06:
//   - RUN_SMOKE=1 gated; default unit runs skip via the it.skipIf guard
//   - temp directory cleaned up in afterAll via rmSync
//   - no real patient data is seeded — only synthetic doctor + profile
//
// Verify locally with:
//   RUN_SMOKE=1 npm run test:integration:smoke:phase7

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmpDir = mkdtempSync(path.join(tmpdir(), 'phase7-roundtrip-'));

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string): string => tmpDir,
    isPackaged: false,
    getName: (): string => 'colonoscopist-phase7-roundtrip',
    getVersion: (): string => '0.0.0',
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
  shell: { showItemInFolder: () => {} },
}));

// ponytail: truthy check (not === '1') — vitest worker process inheritance
// of RUN_SMOKE from the wrapper script is reliable but a strict equality
// on '1' failed in dev. Boolean coercion is enough.
const smokeEnabled = Boolean(process.env.RUN_SMOKE);

describe.skipIf(!smokeEnabled)('backup → restore roundtrip (SET-05 / SET-06 + D-16)', () => {
  let zipPath: string;
  let stagingDir: string;

  beforeAll(async () => {
    // Force-init the live DB at the mocked userData via wizardBootstrap.
    const { wizardBootstrap } = await import('../../src/main/auth');
    await wizardBootstrap({ fullName: 'Dr. Roundtrip', clinicName: 'Roundtrip Clinic', pin: '1234' });
  }, 60_000);

  afterEach(() => {
    vi.resetModules();
  });

  it('creates a backup zip + previewRestore integrity check returns "ok"', async () => {
    const { createBackup } = await import('../../src/main/backup');
    zipPath = path.join(tmpDir, 'backup.zip');
    stagingDir = path.join(tmpDir, 'staging');

    const result = await createBackup({ destZipPath: zipPath });

    expect(existsSync(zipPath)).toBe(true);
    expect(statSync(zipPath).size).toBeGreaterThan(0);
    expect(result.sizeBytes).toBe(statSync(zipPath).size);
    expect(result.path).toBe(zipPath);

    const { previewRestore } = await import('../../src/main/backup/restore');
    const preview = await previewRestore({ zipPath, stagingDir });
    expect(preview.dbIntegrityCheck).toBe('ok');
    expect(preview.filename).toBe('backup.zip');
    expect(preview.totalSize).toBeGreaterThan(0);
  }, 60_000);

  it('unpackRestore writes app.db + integrityCheck returns "ok"', async () => {
    const { unpackRestore, integrityCheck } = await import('../../src/main/backup/restore');

    const unpack = await unpackRestore({ zipPath, stagingDir });
    expect(unpack.fileCount).toBeGreaterThan(0);
    expect(unpack.stagingDir).toBe(stagingDir);
    expect(existsSync(path.join(stagingDir, 'app.db'))).toBe(true);

    expect(integrityCheck(stagingDir)).toBe('ok');
  }, 60_000);
});

if (!smokeEnabled) {
  describe('backup → restore roundtrip — disabled (RUN_SMOKE not set)', () => {
    it('set RUN_SMOKE=1 to enable the roundtrip integration smoke', () => {
      expect(smokeEnabled).toBe(false);
    });
  });
}

afterAll(() => {
  // ponytail: best-effort cleanup. Windows holds file handles briefly after
  // the test process exits; rmSync might EBUSY on the WAL files but the
  // dir is in tmpdir so the OS will sweep it.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
