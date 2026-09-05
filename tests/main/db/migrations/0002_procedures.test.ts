// Wave 0: 0002_procedures migration runs idempotently and CHECK constraints
// reject bad rows (per D-01 + D-03 + D-06 + D-11).

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-0002-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('0002_procedures migration', () => {
  it('creates three tables + CHECK constraints on first open', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');

    const db = getDb();
    const tables = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    ).all() as { name: string }[]).map((r) => r.name);

    expect(tables).toContain('procedures');
    expect(tables).toContain('procedure_notes');
    expect(tables).toContain('procedure_segments');

    // CHECK rejects invalid status
    expect(() =>
      db
        .prepare(
          `INSERT INTO procedures (id, patient_id, doctor_id, started_at, video_path, preset_summary, status)
           VALUES ('x', 'p', 'd', 0, 'rel', '{}', 'bogus')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed: status/);

    // Note body length 0 fails CHECK
    expect(() =>
      db
        .prepare(
          `INSERT INTO procedure_notes (procedure_id, body, created_at) VALUES ('x', '', 0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed: length\(body\)/);

    // Note body length 1001 fails CHECK
    expect(() =>
      db
        .prepare(
          `INSERT INTO procedure_notes (procedure_id, body, created_at)
           VALUES ('x', ?, 0)`,
        )
        .run('x'.repeat(1001)),
    ).toThrow(/CHECK constraint failed: length\(body\)/);

    closeDb();
  });

  it('is idempotent — second open adds no migration rows', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');

    const db1 = getDb();
    // Phase 6 / Plan 06-01 added migration 0004 (doctor_profile + reports
    // + report_screenshots). Phase 7 / Plan 07-01 added migration 0007
    // (users.language + doctor_profile.language). Quick task 20260812
    // added migration 0008 (auto-MRN). Quick task 20260812-redesign-report
    // added migration 0010 (procedure_type + 8 box columns + templates).
    // Phase 8 / Plan 01 added migration 0011 (settings.trial_started_at).
    // Phase 8 / Plan 15 (G-08-8) added migration 0012 (revert the redesign
    // drop columns). Total now = 10.
    expect((db1.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(10);
    closeDb();

    const db2 = getDb();
    expect((db2.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(10);

    closeDb();
  });
});