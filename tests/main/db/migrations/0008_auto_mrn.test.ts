// Quick task 20260812 — 0008_auto_mrn migration contract.
// Per D-lock: migration backfills NULL mrn rows, seeds the counter above
// the max existing suffix, makes the column NOT NULL, and turns the
// partial unique index into a full unique index.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
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

// ponytail: helper that creates the DB file at the userData path and
// applies only migration 0001 (so the patients table exists with a nullable
// mrn column). After this returns, calling getDb() picks up the file and
// applies migrations 0002-0008 on top — 0008's backfill runs against the
// NULL row we seeded.
//
// dbPath() resolves to `<userData>/data/app.db` (see src/main/paths.ts:14),
// so we mirror that path here. tmpDir IS userData in the vi.mock setup above.
function seedPreMigrationFixtures(): void {
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  const dbPath = path.join(tmpDir, 'data', 'app.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  // Run migration 0001 verbatim (creates _migrations + users + patients).
  db.exec(
    `CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
     INSERT INTO _migrations (id, name, applied_at) VALUES (1, 'init', 0);
     CREATE TABLE users (
       id TEXT PRIMARY KEY, full_name TEXT NOT NULL, is_first_admin INTEGER NOT NULL DEFAULT 0,
       pin_hash TEXT NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0,
       locked_until INTEGER, is_locked INTEGER NOT NULL DEFAULT 0,
       last_login_at INTEGER, created_at INTEGER NOT NULL, deleted_at INTEGER,
       CHECK (is_first_admin IN (0, 1))
     );
     CREATE UNIQUE INDEX idx_users_first_admin ON users(is_first_admin) WHERE is_first_admin = 1;
     CREATE INDEX idx_users_full_name ON users(full_name COLLATE NOCASE);
     CREATE TABLE patients (
       id TEXT PRIMARY KEY, full_name TEXT NOT NULL, dob TEXT NOT NULL,
       gender TEXT, mrn TEXT, phone TEXT, notes TEXT,
       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
     );
     CREATE UNIQUE INDEX idx_patients_mrn ON patients(mrn) WHERE mrn IS NOT NULL AND deleted_at IS NULL;
     CREATE INDEX idx_patients_name ON patients(full_name COLLATE NOCASE);
     CREATE INDEX idx_patients_deleted ON patients(deleted_at);
     CREATE TABLE audit_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT NOT NULL,
       entity_type TEXT, entity_id TEXT, metadata TEXT, outcome TEXT NOT NULL DEFAULT 'ok',
       created_at INTEGER NOT NULL
     );
     CREATE INDEX idx_audit_user ON audit_log(user_id);
     CREATE INDEX idx_audit_created ON audit_log(created_at);
     CREATE INDEX idx_audit_action ON audit_log(action);
     CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
     CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
     CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);`,
  );
  // Seed three fixtures: one NULL, one MRN-001, one MRN-ABC.
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
  db.close();
}

describe('0008_auto_mrn migration', () => {
  it('backfills NULL mrn rows and seeds the counter above the max existing suffix', async () => {
    seedPreMigrationFixtures();
    // Open via the standard path — getDb() applies migrations 2-8 on top
    // of our pre-seeded state. Migration 0008's backfill runs against the
    // NULL row we seeded.
    const { getDb, closeDb } = await import('../../../../src/main/db');
    const db = getDb();

    const rows = db
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
    // The backfilled NULL row gets a non-null MRN matching the serial format.
    const nullRow = rows.find((r) => r.id === '00000000-0000-4000-8000-0000000000a1');
    expect(nullRow?.mrn).toBeTruthy();
    expect(nullRow?.mrn).toMatch(/^MRN-\d{6}$/);

    // Counter table exists and is seeded above the max numeric suffix
    // present in the data (MRN-001 → next starts at 2; MRN-ABC is non-numeric
    // so MAX(CAST(SUBSTR(...))) stays at 1 → counter = 2).
    const counter = db
      .prepare(`SELECT next FROM patient_mrn_counter WHERE id = 1`)
      .get() as { next: number } | undefined;
    expect(counter).toBeDefined();
    expect(counter!.next).toBeGreaterThanOrEqual(2);

    // The mrn column is NOT NULL at the schema layer.
    expect(() =>
      db
        .prepare(
          `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
           VALUES ('00000000-0000-4000-8000-0000000000ff', 'Should Fail', '1980-01-01', 0, 0)`,
        )
        .run(),
    ).toThrow(/NOT NULL constraint failed: patients\.mrn/);

    // The unique index rejects a duplicate MRN (no longer partial).
    expect(() =>
      db
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