// patients table repository tests — Phase 7 / Plan 07-02 cross-cutting
// filter tests. Per SRCH-01..03 + D-02: patientRepo.list accepts dateFrom /
// dateTo / doctorId / procedureStatus and AND-combines them with the
// existing name / MRN filters. The Phase 2 surface (no extra filters)
// must continue to return the same 25-row page of active patients.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-patients-repo-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrapWithSecondUser(): Promise<{ doctor1: string; doctor2: string }> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const db = getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  // Insert a second doctor directly so we can exercise the doctorId filter
  // (no second wizard bootstrap — that would clobber clinic settings).
  const doctor2 = '00000000-0000-4000-8000-000000000099';
  db.prepare(
    `INSERT INTO users (id, full_name, is_first_admin, pin_hash, failed_attempts, is_locked, created_at)
     VALUES (?, ?, 0, 'h', 0, 0, ?)`,
  ).run(doctor2, 'Dr. B', Date.now());
  return { doctor1: r.userId, doctor2 };
}

function insertPatient(db: ReturnType<typeof import('../../../src/main/db').getDb>, id: string, fullName: string): void {
  db.prepare(
    `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
     VALUES (?, ?, '1980-01-01', ?, ?)`,
  ).run(id, fullName, Date.now(), Date.now());
}

function insertProcedure(
  db: ReturnType<typeof import('../../../src/main/db').getDb>,
  id: string,
  patientId: string,
  doctorId: string,
  startedAt: number,
  status: 'recording' | 'completed' | 'partial' | 'crashed',
): void {
  db.prepare(
    `INSERT INTO procedures
      (id, patient_id, doctor_id, started_at, ended_at, duration_seconds, status,
       video_path, preset_summary, audio_device_name, created_at)
     VALUES (?, ?, ?, ?, ?, 60, ?, 'v.mp4', '{}', NULL, ?)`,
  ).run(id, patientId, doctorId, startedAt, startedAt + 60_000, status, startedAt);
}

describe('patientRepo.list — Phase 2 zero-config surface (regression)', () => {
  it('no filters returns all active patients (preserves Phase 2 behavior)', async () => {
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    await bootstrapWithSecondUser();
    insertPatient(db, '00000000-0000-4000-8000-000000000010', 'Alice');
    insertPatient(db, '00000000-0000-4000-8000-000000000020', 'Bob');
    insertPatient(db, '00000000-0000-4000-8000-000000000030', 'Carol');
    const { patientRepo } = await import('../../../src/main/db/patients');
    const result = patientRepo.list({});
    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r.fullName).sort()).toEqual(['Alice', 'Bob', 'Carol']);
  });
});

describe('patientRepo.list — Phase 7 cross-cutting filters (SRCH-01..03 + D-02)', () => {
  it('dateFrom/dateTo filters on procedures.started_at (canonical procedure date per Phase 4 D-10)', async () => {
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    const { doctor1 } = await bootstrapWithSecondUser();
    insertPatient(db, '00000000-0000-4000-8000-000000000010', 'Alice');
    insertPatient(db, '00000000-0000-4000-8000-000000000020', 'Bob');
    insertPatient(db, '00000000-0000-4000-8000-000000000030', 'Carol');
    // Alice — procedure on Aug 5
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-000000000010',
      doctor1,
      Date.UTC(2026, 7, 5, 10, 0, 0), // Aug 5 2026
      'completed',
    );
    // Bob — procedure on Sep 10
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000b1',
      '00000000-0000-4000-8000-000000000020',
      doctor1,
      Date.UTC(2026, 8, 10, 10, 0, 0), // Sep 10 2026
      'completed',
    );
    // Carol — procedure on Jul 1 (outside August)
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000c1',
      '00000000-0000-4000-8000-000000000030',
      doctor1,
      Date.UTC(2026, 6, 1, 10, 0, 0), // Jul 1 2026
      'completed',
    );
    const { patientRepo } = await import('../../../src/main/db/patients');
    const augOnly = patientRepo.list({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
    expect(augOnly.total).toBe(1);
    expect(augOnly.rows[0]?.fullName).toBe('Alice');
  });

  it('doctorId filters on procedures.doctor_id', async () => {
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    const { doctor1, doctor2 } = await bootstrapWithSecondUser();
    insertPatient(db, '00000000-0000-4000-8000-000000000010', 'Alice');
    insertPatient(db, '00000000-0000-4000-8000-000000000020', 'Bob');
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-000000000010',
      doctor1,
      Date.UTC(2026, 7, 5, 10, 0, 0),
      'completed',
    );
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000b1',
      '00000000-0000-4000-8000-000000000020',
      doctor2,
      Date.UTC(2026, 7, 6, 10, 0, 0),
      'completed',
    );
    const { patientRepo } = await import('../../../src/main/db/patients');
    const d1Only = patientRepo.list({ doctorId: doctor1 });
    expect(d1Only.total).toBe(1);
    expect(d1Only.rows[0]?.fullName).toBe('Alice');
  });

  it('procedureStatus multi-select returns patients with matching procedure status', async () => {
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    const { doctor1 } = await bootstrapWithSecondUser();
    insertPatient(db, '00000000-0000-4000-8000-000000000010', 'Alice');
    insertPatient(db, '00000000-0000-4000-8000-000000000020', 'Bob');
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-000000000010',
      doctor1,
      Date.UTC(2026, 7, 5, 10, 0, 0),
      'completed',
    );
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000b1',
      '00000000-0000-4000-8000-000000000020',
      doctor1,
      Date.UTC(2026, 7, 6, 10, 0, 0),
      'partial',
    );
    const { patientRepo } = await import('../../../src/main/db/patients');
    const completedOnly = patientRepo.list({ procedureStatus: ['completed'] });
    expect(completedOnly.total).toBe(1);
    expect(completedOnly.rows[0]?.fullName).toBe('Alice');
  });

  it('AND-combined filters: dateFrom/dateTo + doctorId + procedureStatus = the intersection', async () => {
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    const { doctor1, doctor2 } = await bootstrapWithSecondUser();
    insertPatient(db, '00000000-0000-4000-8000-000000000010', 'Alice');
    insertPatient(db, '00000000-0000-4000-8000-000000000020', 'Bob');
    insertPatient(db, '00000000-0000-4000-8000-000000000030', 'Carol');
    // Alice — Aug + doctor1 + completed (matches all)
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-000000000010',
      doctor1,
      Date.UTC(2026, 7, 5, 10, 0, 0),
      'completed',
    );
    // Bob — Aug + doctor2 + completed (doctor mismatch)
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000b1',
      '00000000-0000-4000-8000-000000000020',
      doctor2,
      Date.UTC(2026, 7, 6, 10, 0, 0),
      'completed',
    );
    // Carol — Aug + doctor1 + partial (status mismatch)
    insertProcedure(
      db,
      '00000000-0000-4000-8000-0000000000c1',
      '00000000-0000-4000-8000-000000000030',
      doctor1,
      Date.UTC(2026, 7, 7, 10, 0, 0),
      'partial',
    );
    const { patientRepo } = await import('../../../src/main/db/patients');
    const intersected = patientRepo.list({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      doctorId: doctor1,
      procedureStatus: ['completed'],
    });
    expect(intersected.total).toBe(1);
    expect(intersected.rows[0]?.fullName).toBe('Alice');
  });
});
