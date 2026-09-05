// Phase 8 / Plan 15 (G-08-8) — 0012_revert_report_redesign_drop_columns
// migration contract. Adds 4 columns back to `reports`:
//   - findings
//   - diagnosis
//   - recommendations
//   - procedure_details
// Each column is `TEXT NOT NULL DEFAULT ''` so the existing
// reports-repo.ts insert + update paths (which assume these columns
// exist with `DEFAULT ''`) work on a DB that already ran migration 0010.
//
// Why a separate test: the regression guard — without these columns on
// a user's DB, `reports:get-by-procedure` fails with "table reports has
// no column named findings" (the patient-list accordion surfaces this
// as a silent UI failure). This test asserts the columns exist post-
// migration and that the migration is idempotent.

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
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-0012-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('0012_revert_report_redesign_drop_columns migration (Plan 15 — G-08-8)', () => {
  it('adds the 4 columns back to reports after all migrations run', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');
    const db = getDb();

    // PRAGMA reports(table_info) returns columns; verify all 4 back.
    const columns = db
      .prepare(`PRAGMA table_info(reports)`)
      .all() as { name: string; notnull: number; dflt_value: string | null }[];
    const names = columns.map((c) => c.name);

    for (const col of ['findings', 'diagnosis', 'recommendations', 'procedure_details']) {
      const matched = columns.find((c) => c.name === col);
      expect(matched).toBeDefined();
      // NOT NULL with DEFAULT '' per the migration spec.
      expect(matched?.notnull).toBe(1);
      expect(matched?.dflt_value).toBe("''");
    }

    // 0010's columns still present (no DROP statements in 0012). The
    // dual-shape co-existence is intentional — old + new both work.
    for (const col of [
      'procedure_type',
      'instrument',
      'premedication_override',
      'esophagus',
      'stomach',
      'pylorus',
      'duodenum',
      'colon',
      'ileum',
      'conclusion',
      'recommendation',
    ]) {
      expect(names).toContain(col);
    }

    // Verify the migration row is recorded.
    const row = db
      .prepare(`SELECT id, name FROM _migrations WHERE id = 12`)
      .get() as { id: number; name: string } | undefined;
    expect(row?.name).toBe('revert_report_redesign_drop_columns');

    closeDb();
  });

  it('is idempotent — second open adds no migration rows', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');

    const db1 = getDb();
    // 0001 + 0002 + 0003 + 0004 + 0007 + 0008 + 0009 + 0010 + 0011 + 0012 = 10 entries
    expect((db1.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(10);
    closeDb();

    const db2 = getDb();
    expect((db2.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(10);

    closeDb();
  });

  it('regression guard: reports:get-by-procedure no longer fails with "no column named findings" on a DB that ran migration 0010 + 0012', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');
    const { wizardBootstrap, login } = await import('../../../../src/main/auth');
    const db = getDb();

    const r = await wizardBootstrap({ fullName: 'Dr. R', clinicName: 'Clinic R', pin: '1234' });
    await login({ userId: r.userId, pin: '1234' });

    const patientId = '00000000-0000-4000-8000-000000000020';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(patientId, 'Bob', '1985-01-01', `MRN-R-${patientId.slice(-8)}`, Date.now(), Date.now());

    const { proceduresRepo } = await import('../../../../src/main/db/procedures-repo');
    const proc = proceduresRepo.insert({
      patientId,
      doctorId: r.userId,
      videoPath: 'video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
    });

    // This is the call that was throwing "no column named findings"
    // pre-migration-0012. After Plan 15 it resolves cleanly.
    const { reportsRepo } = await import('../../../../src/main/db/reports-repo');
    const row = reportsRepo.getByProcedure(proc.id);
    // The row is null because the report hasn't been created yet (no
    // getOrCreate), but the call MUST NOT throw.
    expect(row).toBeNull();

    // And the getOrCreate path also works.
    const created = reportsRepo.getOrCreate(proc.id, r.userId);
    expect(created.findings).toBe('');
    expect(created.diagnosis).toBe('');
    expect(created.recommendations).toBe('');
    // repo normalizes procedure_details -> camelCase procedureDetails.
    expect((created as unknown as { procedureDetails: string }).procedureDetails).toBe('');

    closeDb();
  });
});
