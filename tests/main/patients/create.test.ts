// create.test.ts — patient create IPC + audit-on-create + validation gates.
// Per PAT-01 + AUDIT-01 + Fix 6.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-pat-create-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrapAndLogin(): Promise<string> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const { session } = await import('../../../src/main/auth/session');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  expect(session.currentUserId).toBe(r.userId);
  return r.userId;
}

describe('patients:create', () => {
  it('creates a row with all 6 fields and writes audit_log row in the same transaction', async () => {
    const adminId = await bootstrapAndLogin();
    const { createPatient } = await import('../../../src/main/ipc/patients');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const row = createPatient({
      fullName: 'Alice Bob',
      dob: '1990-04-15',
      gender: 'female',
      mrn: 'EXACT-001',
      phone: '555-1234',
      notes: 'headache',
    });

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(row.fullName).toBe('Alice Bob');
    expect(row.dob).toBe('1990-04-15');
    expect(row.gender).toBe('female');
    expect(row.mrn).toBe('EXACT-001');
    expect(row.phone).toBe('555-1234');
    expect(row.notes).toBe('headache');
    expect(typeof row.createdAt).toBe('number');
    expect(typeof row.updatedAt).toBe('number');
    expect(row.createdAt).toBe(row.updatedAt);
    expect(row.deletedAt).toBeNull();

    // per AUDIT-01 — audit row in the SAME transaction; both the patient row and the audit row exist.
    const auditRows = getDb()
      .prepare(
        `SELECT action, entity_type, entity_id, user_id FROM audit_log
         WHERE action = 'patient_create' AND entity_id = ?`,
      )
      .all(row.id) as { action: string; entity_type: string; entity_id: string; user_id: string }[];
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].entity_type).toBe('patient');
    expect(auditRows[0].entity_id).toBe(row.id);
    expect(auditRows[0].user_id).toBe(adminId);

    closeDb();
  });

  it('returns IPC_VALIDATION { field: mrn } on duplicate active MRN', async () => {
    await bootstrapAndLogin();
    const { createPatient } = await import('../../../src/main/ipc/patients');
    const { IpcErrorException } = await import('../../../src/shared/errors');
    const { closeDb } = await import('../../../src/main/db');

    createPatient({
      fullName: 'Alice',
      dob: '1990-01-01',
      gender: null,
      mrn: 'DUP-001',
      phone: null,
      notes: null,
    });

    expect(() =>
      createPatient({
        fullName: 'Bob',
        dob: '1991-01-01',
        gender: null,
        mrn: 'DUP-001',
        phone: null,
        notes: null,
      }),
    ).toThrow(IpcErrorException);

    try {
      createPatient({
        fullName: 'Carol',
        dob: '1992-01-01',
        gender: null,
        mrn: 'DUP-001',
        phone: null,
        notes: null,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(IpcErrorException);
      const e = err as InstanceType<typeof IpcErrorException>;
      expect(e.ipc.code).toBe('IPC_VALIDATION');
      expect(e.ipc.field).toBe('mrn');
    }

    closeDb();
  });

  it('returns IPC_VALIDATION { field: fullName } when fullName is missing', async () => {
    await bootstrapAndLogin();
    const { createPatient } = await import('../../../src/main/ipc/patients');
    const { IpcErrorException } = await import('../../../src/shared/errors');
    const { closeDb } = await import('../../../src/main/db');

    // @ts-expect-error — intentionally omit fullName to test zod validation
    expect(() => createPatient({ dob: '1990-01-01' })).toThrow(IpcErrorException);
    try {
      // @ts-expect-error — intentionally omit fullName
      createPatient({ dob: '1990-01-01' });
    } catch (err) {
      const e = err as InstanceType<typeof IpcErrorException>;
      expect(e.ipc.code).toBe('IPC_VALIDATION');
      expect(e.ipc.field).toBe('fullName');
    }

    closeDb();
  });

  it('rejects creation while unauthenticated (gating)', async () => {
    // bootstrap but DO NOT log in → session.currentUserId stays null
    const { getDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    const { session } = await import('../../../src/main/auth/session');
    getDb();
    await wizardBootstrap({ fullName: 'Dr. U', clinicName: 'Clinic', pin: '1234' });
    expect(session.currentUserId).toBeNull();

    const { createPatient } = await import('../../../src/main/ipc/patients');
    const { IpcErrorException } = await import('../../../src/shared/errors');
    const { closeDb } = await import('../../../src/main/db');

    try {
      createPatient({
        fullName: 'A',
        dob: '1990-01-01',
        gender: null,
        mrn: null,
        phone: null,
        notes: null,
      });
      throw new Error('expected createPatient to throw');
    } catch (err) {
      const e = err as InstanceType<typeof IpcErrorException>;
      expect(e).toBeInstanceOf(IpcErrorException);
      expect(['IPC_VALIDATION', 'IPC_AUTH_FAILED']).toContain(e.ipc.code);
    }

    closeDb();
  });
});