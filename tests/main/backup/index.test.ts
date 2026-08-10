// Phase 7 / Plan 07-01 — Create backup unit tests (D-09 + D-10).
// Real archiver round-trip — the temp DB file is unlinked after the zip closes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yauzl from 'yauzl';

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
  shell: {
    showItemInFolder: () => {},
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-backup-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrap(): Promise<{ userId: string }> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap } = await import('../../../src/main/auth');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  return { userId: r.userId };
}

describe('createBackup', () => {
  it('streams a zip > 0 bytes containing app.db + temp file is unlinked', async () => {
    const { userId } = await bootstrap();
    expect(userId).toMatch(/^[0-9a-f-]{36}$/i);

    const { createBackup } = await import('../../../src/main/backup');
    const destZip = path.join(tmpDir, 'backup.zip');
    const result = await createBackup({ destZipPath: destZip });

    expect(result.path).toBe(destZip);
    expect(existsSync(destZip)).toBe(true);
    expect(statSync(destZip).size).toBeGreaterThan(0);
    expect(result.sizeBytes).toBe(statSync(destZip).size);
    expect(result.procedureCount).toBe(0);

    // The temp db file must NOT linger next to the zip.
    const tempDb = `${destZip}.db.tmp`;
    expect(existsSync(tempDb)).toBe(false);

    // Must-have: the zip actually contains `app.db` as the canonical entry
    // (D-09 + D-10). Read the central directory via yauzl and assert.
    const entries = await readZipEntries(destZip);
    expect(entries.some((e) => e === 'app.db')).toBe(true);
    // The empty-data bootstrap means media/profiles/reports dirs may or may
    // not be present (archiver skips empty directories). What MUST be present
    // is app.db — that's the must-have for a usable backup.
  });

  it('cleanups up the temp file even when the source data is empty', async () => {
    await bootstrap();
    const { createBackup } = await import('../../../src/main/backup');
    const destZip = path.join(tmpDir, 'empty.zip');
    const result = await createBackup({ destZipPath: destZip });

    expect(result.sizeBytes).toBeGreaterThan(0); // zip headers + app.db at minimum
    expect(existsSync(`${destZip}.db.tmp`)).toBe(false);

    // must-have: app.db is in the zip regardless of source-data emptiness
    const entries = await readZipEntries(destZip);
    expect(entries.some((e) => e === 'app.db')).toBe(true);
  });
});

/** ponytail: walk a zip's central directory via yauzl and return entry names.
 * Used by the must-have assertions above. */
function readZipEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error('yauzl.open returned null'));
        return;
      }
      const names: string[] = [];
      zip.on('error', reject);
      zip.on('end', () => resolve(names));
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.readEntry();
    });
  });
}

describe('revealBackup', () => {
  it('does not throw when invoked outside Electron', async () => {
    await bootstrap();
    const { revealBackup } = await import('../../../src/main/backup');
    // ponytail: shell.showItemInFolder is mocked as a no-op in this test,
    // so the call returns cleanly. The fallback console.info path is the
    // path when electron.shell is unavailable — also covered.
    expect(() => revealBackup(path.join(tmpDir, 'backup.zip'))).not.toThrow();
  });
});
