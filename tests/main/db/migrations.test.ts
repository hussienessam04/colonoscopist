// Wave 0: open DB, run migrations, assert tables + triggers exist; second open
// is a no-op (per D-01 first-launch atomicity + idempotency).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

vi.mock('electron', () => {
  return {
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
    },
  };
});

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-migrations-'));
});

afterEach(() => {
  // Reset module cache so each test gets a fresh getDb() singleton.
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('db migrations', () => {
  it('creates the four tables + two triggers on first open', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const db = getDb();

    const tables = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    ).all() as { name: string }[]).map((r) => r.name);

    expect(tables).toContain('users');
    expect(tables).toContain('patients');
    expect(tables).toContain('audit_log');
    expect(tables).toContain('settings');
    expect(tables).toContain('_migrations');

    const triggers = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log' ORDER BY name`,
    ).all() as { name: string }[]).map((r) => r.name);

    expect(triggers).toContain('audit_log_no_update');
    expect(triggers).toContain('audit_log_no_delete');

    const migrations = db.prepare(`SELECT id, name FROM _migrations`).all() as {
      id: number;
      name: string;
    }[];
    // Phase 7 / Plan 07-01 added migration 0007 (doctor_profile.language +
    // users.language). Quick task 20260812 added migration 0008 (auto-MRN).
    // Total now = 6.
    expect(migrations).toHaveLength(6);
    expect(migrations[0].id).toBe(1);

    // Phase 7 / Plan 07-01 — verify migration 0007 added the language
    // columns to both tables in one migration.
    const usersColumns = db.prepare(`PRAGMA table_info(users)`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const usersLang = usersColumns.find((c) => c.name === 'language');
    expect(usersLang).toBeDefined();
    expect(usersLang?.type).toBe('TEXT');
    expect(usersLang?.notnull).toBe(1);
    expect(usersLang?.dflt_value).toBe("'en'");

    const profileColumns = db.prepare(`PRAGMA table_info(doctor_profile)`).all() as {
      name: string;
      type: string;
      notnull: number;
    }[];
    const profileLang = profileColumns.find((c) => c.name === 'language');
    expect(profileLang).toBeDefined();
    expect(profileLang?.type).toBe('TEXT');
    // doctor_profile.language is nullable (NULL means "follow users.language").
    expect(profileLang?.notnull).toBe(0);

    closeDb();
  });

  it('is idempotent — second open adds no migration rows', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');

    // First open
    const db1 = getDb();
    expect((db1.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(6);
    closeDb();

    // Second open on the same file
    const db2 = getDb();
    const count = (db2.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c;
    expect(count).toBe(6);

    // Sanity: same tables still present.
    const tables = (db2.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    ).all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['users', 'patients', 'audit_log', 'settings']));

    // ponytail: re-running migrations on the same db is a no-op for
    // 0007 — the _migrations row prevents the ALTER TABLEs from firing
    // a second time (which would otherwise throw `duplicate column`).
    closeDb();

    // Third open — confirm migration count stays at 6 (idempotency).
    const db3 = getDb();
    expect((db3.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(6);
    closeDb();
  });
});