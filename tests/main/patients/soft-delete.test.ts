// soft-delete.test.ts — soft delete + includeDeleted flag + admin-only restore.
// Per PAT-04 + D-02.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-pat-softdelete-'));
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

async function createNonAdmin(): Promise<string> {
  // ponytail: re-bootstrap won't work (first-launch only). Use createUser while admin is logged in.
  const { createUser, login } = await import('../../../src/main/auth');
  const { session } = await import('../../../src/main/auth/session');
  const nonAdmin = await createUser({ fullName: 'Dr. NonAdmin', pin: '4321' });
  // ponytail: switch session to the non-admin so the admin gate sees a non-admin caller.
  // Admin must be logged in for createUser; then we login() as the non-admin (login() sets session).
  void session.currentUserId;
  await login({ userId: nonAdmin.id, pin: '4321' });
  return nonAdmin.id;
}

describe('patients soft-delete + restore', () => {
  it('soft-delete: default list excludes row, get returns null, row still exists in table with deleted_at populated', async () => {
    await bootstrapAndLogin();
    const { createPatient, softDeletePatient, getPatient, listPatients } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const created = createPatient({
      fullName: 'Doomed Patient',
      dob: '1990-01-01',
      gender: null,
      mrn: 'DOOMED-001',
      phone: null,
      notes: null,
    });
    const result = softDeletePatient(created.id);
    expect(result.ok).toBe(true);

    // default list excludes the row
    const listed = listPatients({});
    expect(listed.rows.map((r) => r.id)).not.toContain(created.id);
    expect(listed.total).toBe(0);

    // get returns null
    expect(getPatient(created.id)).toBeNull();

    // row still exists in table with deleted_at populated
    const row = getDb()
      .prepare(`SELECT id, deleted_at FROM patients WHERE id = ?`)
      .get(created.id) as { id: string; deleted_at: number | null };
    expect(row.id).toBe(created.id);
    expect(row.deleted_at).not.toBeNull();
    expect(typeof row.deleted_at).toBe('number');

    closeDb();
  });

  it('includeDeleted=true surfaces the soft-deleted row with deletedAt populated', async () => {
    await bootstrapAndLogin();
    const { createPatient, softDeletePatient, listPatients } = await import('../../../src/main/ipc/patients');
    const { closeDb } = await import('../../../src/main/db');

    const created = createPatient({
      fullName: 'Doomed Patient',
      dob: '1990-01-01',
      gender: null,
      mrn: null,
      phone: null,
      notes: null,
    });
    softDeletePatient(created.id);

    const listed = listPatients({ includeDeleted: true });
    const found = listed.rows.find((r) => r.id === created.id);
    expect(found).toBeDefined();
    expect(found!.deletedAt).not.toBeNull();

    closeDb();
  });

  it('non-admin cannot restore (IPC_VALIDATION per D-02)', async () => {
    await bootstrapAndLogin();
    const { createPatient, softDeletePatient } = await import('../../../src/main/ipc/patients');
    const { restorePatient } = await import('../../../src/main/ipc/patients');
    const { IpcErrorException } = await import('../../../src/shared/errors');
    const { closeDb } = await import('../../../src/main/db');

    const created = createPatient({
      fullName: 'Patient X',
      dob: '1990-01-01',
      gender: null,
      mrn: null,
      phone: null,
      notes: null,
    });
    softDeletePatient(created.id);

    // Switch to non-admin.
    await createNonAdmin();

    try {
      restorePatient(created.id);
      throw new Error('expected restorePatient to throw');
    } catch (err) {
      const e = err as InstanceType<typeof IpcErrorException>;
      expect(e).toBeInstanceOf(IpcErrorException);
      expect(e.ipc.code).toBe('IPC_VALIDATION');
    }

    closeDb();
  });

  it('admin can restore a soft-deleted patient; deleted_at becomes NULL', async () => {
    await bootstrapAndLogin();
    const { createPatient, softDeletePatient, restorePatient, getPatient } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const created = createPatient({
      fullName: 'Patient Y',
      dob: '1990-01-01',
      gender: null,
      mrn: null,
      phone: null,
      notes: null,
    });
    softDeletePatient(created.id);

    // Admin session still active.
    const result = restorePatient(created.id);
    expect(result.ok).toBe(true);

    const row = getDb()
      .prepare(`SELECT deleted_at FROM patients WHERE id = ?`)
      .get(created.id) as { deleted_at: number | null };
    expect(row.deleted_at).toBeNull();

    // get returns the row again
    const fetched = getPatient(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.fullName).toBe('Patient Y');
    expect(fetched!.deletedAt).toBeNull();

    closeDb();
  });

  it('restore on a non-deleted id throws IPC_NOT_FOUND', async () => {
    await bootstrapAndLogin();
    const { createPatient, restorePatient } = await import('../../../src/main/ipc/patients');
    const { IpcErrorException } = await import('../../../src/shared/errors');
    const { closeDb } = await import('../../../src/main/db');

    const created = createPatient({
      fullName: 'Patient Z',
      dob: '1990-01-01',
      gender: null,
      mrn: null,
      phone: null,
      notes: null,
    });
    // not soft-deleted

    try {
      restorePatient(created.id);
      throw new Error('expected restorePatient to throw');
    } catch (err) {
      const e = err as InstanceType<typeof IpcErrorException>;
      expect(e).toBeInstanceOf(IpcErrorException);
      expect(e.ipc.code).toBe('IPC_NOT_FOUND');
    }

    closeDb();
  });

  it('every soft-delete + restore writes a patient_delete / patient_restore audit row', async () => {
    await bootstrapAndLogin();
    const { createPatient, softDeletePatient, restorePatient } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const created = createPatient({
      fullName: 'Patient A',
      dob: '1990-01-01',
      gender: null,
      mrn: null,
      phone: null,
      notes: null,
    });
    softDeletePatient(created.id);
    restorePatient(created.id);

    const deleteAudit = (getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_delete' AND entity_id = ?`,
      )
      .get(created.id) as { c: number }).c;
    expect(deleteAudit).toBe(1);

    const restoreAudit = (getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_log WHERE action = 'patient_restore' AND entity_id = ?`,
      )
      .get(created.id) as { c: number }).c;
    expect(restoreAudit).toBe(1);

    closeDb();
  });
});