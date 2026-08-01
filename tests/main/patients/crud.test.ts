// crud.test.ts — get + update + audit count for reads + audit-on-update metadata.fields.
// Per PAT-03 + AUDIT-01 + Fix 6.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-pat-crud-'));
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
  const r = await wizardBootstrap({ fullName: 'Dr. C', clinicName: 'Clinic', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
}

describe('patients CRUD + audit-on-everything', () => {
  it('get + update + get writes 2 patient_view audit rows + 1 patient_update with metadata.fields', async () => {
    await bootstrapAndLogin();
    const { createPatient, getPatient, updatePatient } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const created = createPatient({
      fullName: 'Alice',
      dob: '1990-01-01',
      gender: 'female',
      mrn: 'CRUD-001',
      phone: '555-0001',
      notes: 'first visit',
    });

    // First get
    const view1 = getPatient(created.id);
    expect(view1).not.toBeNull();
    expect(view1!.fullName).toBe('Alice');
    expect(view1!.phone).toBe('555-0001');

    // Update phone + notes
    const updated = updatePatient(created.id, { phone: '555-9999', notes: 'follow-up' });
    expect(updated.phone).toBe('555-9999');
    expect(updated.notes).toBe('follow-up');
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated.fullName).toBe('Alice'); // unchanged

    // Second get — confirms persistence + advances updatedAt
    const view2 = getPatient(created.id);
    expect(view2).not.toBeNull();
    expect(view2!.phone).toBe('555-9999');
    expect(view2!.notes).toBe('follow-up');

    // patient_view: 2 rows (view1 + view2)
    const viewAudit = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_view' AND entity_id = ?`,
      )
      .get(created.id) as { c: number };
    expect(viewAudit.c).toBe(2);

    // patient_update: 1 row with metadata.fields = ['phone', 'notes']
    const updateAudit = getDb()
      .prepare(
        `SELECT metadata FROM audit_log WHERE action = 'patient_update' AND entity_id = ?`,
      )
      .get(created.id) as { metadata: string | null };
    expect(updateAudit.metadata).not.toBeNull();
    const parsed = JSON.parse(updateAudit.metadata!);
    expect(parsed.fields.sort()).toEqual(['notes', 'phone']);

    closeDb();
  });

  it('update on a non-existent id throws IPC_NOT_FOUND and writes no audit row', async () => {
    await bootstrapAndLogin();
    const { updatePatient } = await import('../../../src/main/ipc/patients');
    const { IpcErrorException } = await import('../../../src/shared/errors');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const before = (getDb()
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_update'`)
      .get() as { c: number }).c;

    try {
      updatePatient('00000000-0000-0000-0000-000000000000', { phone: '555-9999' });
      throw new Error('expected updatePatient to throw');
    } catch (err) {
      const e = err as InstanceType<typeof IpcErrorException>;
      expect(e).toBeInstanceOf(IpcErrorException);
      expect(e.ipc.code).toBe('IPC_NOT_FOUND');
    }

    const after = (getDb()
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_update'`)
      .get() as { c: number }).c;
    expect(after).toBe(before);

    closeDb();
  });

  it('every successful update writes patient_update audit with metadata.fields', async () => {
    await bootstrapAndLogin();
    const { createPatient, updatePatient } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const created = createPatient({
      fullName: 'Bob',
      dob: '1990-01-01',
      gender: 'male',
      mrn: 'CRUD-002',
      phone: null,
      notes: null,
    });

    updatePatient(created.id, { notes: 'one' });
    updatePatient(created.id, { phone: '555-0001', notes: 'two' });

    const rows = getDb()
      .prepare(
        `SELECT metadata FROM audit_log WHERE action = 'patient_update' AND entity_id = ? ORDER BY id ASC`,
      )
      .all(created.id) as { metadata: string | null }[];

    expect(rows.length).toBe(2);
    expect(JSON.parse(rows[0].metadata!).fields).toEqual(['notes']);
    expect(JSON.parse(rows[1].metadata!).fields.sort()).toEqual(['notes', 'phone']);

    closeDb();
  });

  it('3 list calls produce 3 patient_list audit rows with filter echoed in metadata', async () => {
    await bootstrapAndLogin();
    const { createPatient, listPatients } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    createPatient({ fullName: 'A', dob: '1990-01-01', gender: null, mrn: null, phone: null, notes: null });
    createPatient({ fullName: 'B', dob: '1990-01-01', gender: null, mrn: 'M-B', phone: null, notes: null });

    listPatients({});
    listPatients({ search: 'A' });
    listPatients({ mrn: 'M-B' });

    const listAudit = getDb()
      .prepare(
        `SELECT metadata FROM audit_log WHERE action = 'patient_list' ORDER BY id ASC`,
      )
      .all() as { metadata: string | null }[];
    expect(listAudit.length).toBe(3);

    const m1 = JSON.parse(listAudit[0].metadata!);
    expect(m1.search).toBeNull();
    expect(m1.mrn).toBeNull();

    const m2 = JSON.parse(listAudit[1].metadata!);
    expect(m2.search).toBe('A');

    const m3 = JSON.parse(listAudit[2].metadata!);
    expect(m3.mrn).toBe('M-B');

    closeDb();
  });

  it('5 get calls produce 5 patient_view audit rows', async () => {
    await bootstrapAndLogin();
    const { createPatient, getPatient } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const created = createPatient({
      fullName: 'Carol',
      dob: '1990-01-01',
      gender: null,
      mrn: null,
      phone: null,
      notes: null,
    });

    for (let i = 0; i < 5; i++) {
      const v = getPatient(created.id);
      expect(v).not.toBeNull();
    }

    const viewAudit = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_view' AND entity_id = ?`,
      )
      .get(created.id) as { c: number };
    expect(viewAudit.c).toBe(5);

    closeDb();
  });
});