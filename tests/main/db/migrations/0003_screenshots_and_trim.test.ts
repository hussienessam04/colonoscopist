// Migration 0003 — screenshots table + procedures.video_path_original.
// Wave 0 of Plan 01: schema, CHECK constraint, FK ON DELETE CASCADE,
// idempotent re-run.

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
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-mig-0003-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrap({ seedProcedure = true }: { seedProcedure?: boolean } = {}): Promise<{
  db: import('better-sqlite3').Database;
  procedureId: string | null;
  patientId: string;
  doctorId: string;
}> {
  const { getDb, closeDb } = await import('../../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../../src/main/auth');
  const { session } = await import('../../../../src/main/auth/session');
  const db = getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  let procedureId: string | null = null;
  let patientId = '';
  if (seedProcedure) {
    patientId = '00000000-0000-4000-8000-000000000010';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(patientId, 'Alice', '1990-01-01', Date.now(), Date.now());
    const { proceduresRepo } = await import('../../../../src/main/db/procedures-repo');
    const inserted = proceduresRepo.insert({
      patientId,
      doctorId: r.userId,
      videoPath: 'data/media/patients/abc/proc1/video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
    });
    procedureId = inserted.id;
  }
  expect(session.currentUserId).toBe(r.userId);
  return { db, procedureId, patientId, doctorId: r.userId };
}

describe('migration 0003_screenshots_and_trim', () => {
  it('creates the screenshots table with the expected columns + index', async () => {
    const { db, closeDb: _closeDb } = await bootstrap({ seedProcedure: false });
    const tables = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'screenshots'`,
    ).all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain('screenshots');

    const cols = (db.prepare(`PRAGMA table_info(screenshots)`).all() as {
      name: string;
      notnull: number;
    }[]).map((r) => r.name);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'procedure_id', 'timestamp_in_video', 'file_path', 'annotation', 'created_at']),
    );

    const idxs = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'screenshots' AND name LIKE 'idx_%'`,
    ).all() as { name: string }[]).map((r) => r.name);
    expect(idxs).toContain('idx_screenshots_proc_ts');
  });

  it('CHECK constraint enforces timestamp_in_video >= 0', async () => {
    const { db, procedureId } = await bootstrap();
    expect(procedureId).not.toBeNull();
    let caught: unknown = null;
    try {
      db.prepare(
        `INSERT INTO screenshots (procedure_id, timestamp_in_video, file_path, annotation, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      ).run(procedureId, -1, 'data/media/foo.jpg', Date.now());
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as { code: string }).code).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('FK constraint rejects a screenshot with an unknown procedure_id', async () => {
    const { db } = await bootstrap({ seedProcedure: false });
    let caught: unknown = null;
    try {
      db.prepare(
        `INSERT INTO screenshots (procedure_id, timestamp_in_video, file_path, annotation, created_at)
         VALUES ('00000000-0000-4000-8000-deadbeefdead', 100, 'data/media/foo.jpg', NULL, ?)`,
      ).run(Date.now());
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as { code: string }).code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
  });

  it('ON DELETE CASCADE removes screenshots when the procedure is deleted', async () => {
    const { db, procedureId } = await bootstrap();
    expect(procedureId).not.toBeNull();
    db.prepare(
      `INSERT INTO screenshots (procedure_id, timestamp_in_video, file_path, annotation, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
    ).run(procedureId, 1000, 'data/media/foo.jpg', Date.now());
    const before = (db.prepare(`SELECT COUNT(*) AS c FROM screenshots`).get() as { c: number }).c;
    expect(before).toBe(1);
    db.prepare(`DELETE FROM procedures WHERE id = ?`).run(procedureId);
    const after = (db.prepare(`SELECT COUNT(*) AS c FROM screenshots`).get() as { c: number }).c;
    expect(after).toBe(0);
  });

  it('re-running runMigrations does not re-apply the migration (idempotent)', async () => {
    await bootstrap({ seedProcedure: false });
    const { getDb } = await import('../../../../src/main/db');
    const db = getDb();
    const before = (db.prepare(`SELECT COUNT(*) AS c FROM _migrations WHERE id = 3`).get() as {
      c: number;
    }).c;
    expect(before).toBe(1);
    const { runMigrations } = await import('../../../../src/main/db/migrations');
    const result = runMigrations(db);
    const after = (db.prepare(`SELECT COUNT(*) AS c FROM _migrations WHERE id = 3`).get() as {
      c: number;
    }).c;
    expect(after).toBe(1);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain(3);
  });

  it('procedures.video_path_original column exists and is nullable', async () => {
    const { db } = await bootstrap({ seedProcedure: false });
    const cols = db.prepare(`PRAGMA table_info(procedures)`).all() as {
      name: string;
      notnull: number;
      dflt_value: unknown;
    }[];
    const col = cols.find((c) => c.name === 'video_path_original');
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(0); // nullable
  });
});
