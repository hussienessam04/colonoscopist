// search.test.ts — pagination + name substring + MRN exact + soft-delete filter.
// Per PAT-02 + Fix 6 + ROADMAP Phase 2 success criterion 3.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-pat-search-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrapAndLogin(): Promise<void> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. S', clinicName: 'Clinic', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
}

// Bulk-insert helpers — keep test readable.
async function createN(n: number, prefix: string): Promise<void> {
  const { createPatient } = await import('../../../src/main/ipc/patients');
  for (let i = 1; i <= n; i++) {
    createPatient({
      fullName: `${prefix} ${String(i).padStart(3, '0')}`,
      dob: '1990-01-01',
      gender: null,
      mrn: `${prefix.replace(/\s+/g, '')}-${String(i).padStart(3, '0')}`,
      phone: null,
      notes: null,
    });
  }
}

describe('patients:list search + pagination + audit', () => {
  it('default list returns 25 alphabetically sorted rows with total=50 + 1 patient_list audit row', async () => {
    await bootstrapAndLogin();
    await createN(50, 'Patient');

    const { listPatients } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const before = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_list'`)
      .get() as { c: number };

    const result = listPatients({});
    expect(result.total).toBe(50);
    expect(result.rows.length).toBe(25);

    // Alphabetical ordering (COLLATE NOCASE on full_name).
    const names = result.rows.map((r) => r.fullName);
    const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    expect(names).toEqual(sorted);

    const after = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_list'`)
      .get() as { c: number };
    expect(after.c - before.c).toBe(1);

    closeDb();
  });

  it('search: ali returns substring matches case-insensitively + patient_list audit with metadata.search', async () => {
    await bootstrapAndLogin();
    const { createPatient } = await import('../../../src/main/ipc/patients');
    createPatient({ fullName: 'Alice Bob', dob: '1990-01-01', gender: 'female', mrn: 'M-001', phone: null, notes: null });
    createPatient({ fullName: 'Carol Ali', dob: '1990-01-01', gender: 'female', mrn: 'M-002', phone: null, notes: null });
    createPatient({ fullName: 'Bob Smith', dob: '1990-01-01', gender: 'male', mrn: 'M-003', phone: null, notes: null });
    createPatient({ fullName: 'calibration error', dob: '1990-01-01', gender: null, mrn: 'M-004', phone: null, notes: null });

    const { listPatients } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const before = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_list'`)
      .get() as { c: number };

    const result = listPatients({ search: 'ali' });
    expect(result.total).toBeGreaterThanOrEqual(3);
    const names = result.rows.map((r) => r.fullName);
    expect(names).toContain('Alice Bob');
    expect(names).toContain('Carol Ali');
    expect(names).toContain('calibration error');
    expect(names).not.toContain('Bob Smith');

    const after = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_list'`)
      .get() as { c: number };
    expect(after.c - before.c).toBe(1);

    // metadata echoes the filter.
    const auditMeta = getDb()
      .prepare(
        `SELECT metadata FROM audit_log WHERE action = 'patient_list' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { metadata: string | null };
    expect(auditMeta.metadata).not.toBeNull();
    const parsed = JSON.parse(auditMeta.metadata!);
    expect(parsed.search).toBe('ali');

    closeDb();
  });

  it('mrn: EXACT-001 returns the single row with metadata.mrn echo', async () => {
    await bootstrapAndLogin();
    const { createPatient } = await import('../../../src/main/ipc/patients');
    createPatient({ fullName: 'Alice', dob: '1990-01-01', gender: null, mrn: 'EXACT-001', phone: null, notes: null });
    createPatient({ fullName: 'Bob', dob: '1990-01-01', gender: null, mrn: 'OTHER-002', phone: null, notes: null });

    const { listPatients } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const result = listPatients({ mrn: 'EXACT-001' });
    expect(result.total).toBe(1);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].mrn).toBe('EXACT-001');
    expect(result.rows[0].fullName).toBe('Alice');

    const auditMeta = getDb()
      .prepare(
        `SELECT metadata FROM audit_log WHERE action = 'patient_list' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { metadata: string | null };
    expect(auditMeta.metadata).not.toBeNull();
    const parsed = JSON.parse(auditMeta.metadata!);
    expect(parsed.mrn).toBe('EXACT-001');

    closeDb();
  });

  it('search + includeDeleted=false excludes soft-deleted rows', async () => {
    await bootstrapAndLogin();
    const { createPatient, softDeletePatient } = await import('../../../src/main/ipc/patients');
    createPatient({ fullName: 'Alive Ali One', dob: '1990-01-01', gender: null, mrn: null, phone: null, notes: null });
    const deleted = createPatient({ fullName: 'Deleted Ali Two', dob: '1990-01-01', gender: null, mrn: null, phone: null, notes: null });
    softDeletePatient(deleted.id);

    const { listPatients } = await import('../../../src/main/ipc/patients');
    const { closeDb } = await import('../../../src/main/db');

    const filtered = listPatients({ search: 'ali', includeDeleted: false });
    const names = filtered.rows.map((r) => r.fullName);
    expect(names).toContain('Alive Ali One');
    expect(names).not.toContain('Deleted Ali Two');

    closeDb();
  });

  it('page=2 + pageSize=10 returns rows 11-20 alphabetically + 1 patient_list audit', async () => {
    await bootstrapAndLogin();
    await createN(50, 'Patient');

    const { listPatients } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const before = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_list'`)
      .get() as { c: number };

    const result = listPatients({ page: 2, pageSize: 10 });
    expect(result.total).toBe(50);
    expect(result.rows.length).toBe(10);
    // Rows 11..20 alphabetically among "Patient 001".. "Patient 050".
    const expected = [
      'Patient 011',
      'Patient 012',
      'Patient 013',
      'Patient 014',
      'Patient 015',
      'Patient 016',
      'Patient 017',
      'Patient 018',
      'Patient 019',
      'Patient 020',
    ];
    expect(result.rows.map((r) => r.fullName)).toEqual(expected);

    const after = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_list'`)
      .get() as { c: number };
    expect(after.c - before.c).toBe(1);

    closeDb();
  });
});