// Quick task 20260812 — 0008_auto_mrn migration contract.
// Per D-lock: migration backfills NULL mrn rows, seeds the counter above
// the max existing suffix, makes the column NOT NULL, and turns the
// partial unique index into a full unique index.

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
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: {
    handle: () => {},
    on: () => {},
  },
  contextBridge: {
    exposeInMainWorld: () => {},
  },
  ipcRenderer: {
    invoke: async () => null,
    on: () => {},
    removeListener: () => {},
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-0008-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('0008_auto_mrn migration', () => {
  it('backfills NULL mrn rows and seeds the counter above the max existing suffix', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');
    const db = getDb();
    // Migrations have already run via getDb(). Seed three rows directly:
    // one with NULL mrn, one with MRN-001, one with MRN-ABC (non-numeric).
    const now = Date.now();
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
       VALUES (?, 'Null Person', '1980-01-01', NULL, ?, ?)`,
    ).run('00000000-0000-4000-8000-0000000000a1', now, now);
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
       VALUES (?, 'Old One', '1980-01-01', 'MRN-001', ?, ?)`,
    ).run('00000000-0000-4000-8000-0000000000a2', now, now);
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
       VALUES (?, 'Old Two', '1980-01-01', 'MRN-ABC', ?, ?)`,
    ).run('00000000-0000-4000-8000-0000000000a3', now, now);

    // Force re-apply: close DB, drop the 0008 marker row, reopen.
    closeDb();
    // Re-import to get a fresh module instance with no cached connection.
    const { runMigrations } = await import('../../../../src/main/db/migrations');
    const { getDb: getDb2 } = await import('../../../../src/main/db');
    // The cached `db` module still has tmpDir in userData path; reopen it.
    const db2 = getDb2();
    // Wipe just the 0008 marker row so runMigrations re-applies it.
    db2.prepare(`DELETE FROM _migrations WHERE id = 8`).run();
    runMigrations(db2);

    const rows = db2
      .prepare(
        `SELECT id, mrn FROM patients WHERE id IN (?, ?, ?)`,
      )
      .all(
        '00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-0000000000a2',
        '00000000-0000-4000-8000-0000000000a3',
      ) as { id: string; mrn: string }[];

    for (const r of rows) {
      expect(r.mrn).not.toBeNull();
      expect(r.mrn.length).toBeGreaterThan(0);
    }
    // Pre-existing 'MRN-001' is preserved verbatim.
    const oldOne = rows.find((r) => r.id === '00000000-0000-4000-8000-0000000000a2');
    expect(oldOne?.mrn).toBe('MRN-001');
    // Pre-existing 'MRN-ABC' is preserved verbatim (non-numeric suffix).
    const oldTwo = rows.find((r) => r.id === '00000000-0000-4000-8000-0000000000a3');
    expect(oldTwo?.mrn).toBe('MRN-ABC');
    // The backfilled NULL row gets a non-null MRN (we don't pin the exact
    // value — depends on the ROW_NUMBER ordering vs. pre-existing fixtures).
    const nullRow = rows.find((r) => r.id === '00000000-0000-4000-8000-0000000000a1');
    expect(nullRow?.mrn).toBeTruthy();
    expect(nullRow?.mrn).toMatch(/^MRN-\d{6}$/);

    // Counter table exists and is seeded above the max numeric suffix
    // present in the data (MRN-001 → next starts at 2; MRN-ABC is non-numeric
    // so MAX(CAST(SUBSTR(...))) stays at 1 → counter = 2).
    const counter = db2
      .prepare(`SELECT next FROM patient_mrn_counter WHERE id = 1`)
      .get() as { next: number } | undefined;
    expect(counter).toBeDefined();
    expect(counter!.next).toBeGreaterThanOrEqual(2);

    // The mrn column is NOT NULL at the schema layer.
    expect(() =>
      db2
        .prepare(
          `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
           VALUES ('00000000-0000-4000-8000-0000000000ff', 'Should Fail', '1980-01-01', 0, 0)`,
        )
        .run(),
    ).toThrow(/NOT NULL constraint failed: patients\.mrn/);

    // The unique index rejects a duplicate MRN (no longer partial).
    expect(() =>
      db2
        .prepare(
          `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
           VALUES ('00000000-0000-4000-8000-0000000000fe', 'Dup', '1980-01-01', 'MRN-001', 0, 0)`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed: patients\.mrn/);

    closeDb();
  });

  it('is idempotent — second open adds no migration rows', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');

    const db1 = getDb();
    // Migration roster: 0001 + 0002 + 0003 + 0004 + 0007 + 0008 = 6 entries.
    expect((db1.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(6);
    closeDb();

    const db2 = getDb();
    expect((db2.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(6);

    closeDb();
  });
});