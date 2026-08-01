// wizard bootstrap tests — atomicity + first-launch-only gate (per D-01).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpDir,
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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-wizard-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('wizardBootstrap', () => {
  it('commits first user + clinic_name atomically', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    const { session } = await import('../../../src/main/auth/session');

    getDb();

    const result = await wizardBootstrap({
      fullName: 'Dr. Alice',
      clinicName: 'Clinic A',
      pin: '1234',
    });

    expect(result.accepted).toBe(true);
    expect(result.clinicName).toBe('Clinic A');
    expect(result.userId).toMatch(/^[0-9a-f-]{36}$/i);

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId) as {
      full_name: string;
      is_first_admin: number;
    };
    expect(user.full_name).toBe('Dr. Alice');
    expect(user.is_first_admin).toBe(1);

    const clinicRow = db.prepare(`SELECT value FROM settings WHERE key = 'clinic_name'`).get() as {
      value: string;
    };
    expect(clinicRow.value).toBe('Clinic A');

    const auditRows = db.prepare(
      `SELECT action, outcome FROM audit_log ORDER BY id`,
    ).all() as { action: string; outcome: string }[];
    expect(auditRows.map((r) => r.action)).toContain('auth.bootstrap.completed');
    expect(auditRows.map((r) => r.action)).toContain('auth.bootstrap.completed');

    expect(session.currentUserId).toBeNull(); // wizard does NOT log the user in
    closeDb();
  });

  it('rejects a second wizard commit (first-launch only)', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    const { IpcErrorException } = await import('../../../src/shared/errors');

    getDb();

    await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'C1', pin: '1111' });

    await expect(
      wizardBootstrap({ fullName: 'Dr. B', clinicName: 'C2', pin: '2222' }),
    ).rejects.toBeInstanceOf(IpcErrorException);

    closeDb();
  });

  it('rolls back user row when the audit insert throws', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    const audit = await import('../../../src/main/db/audit');

    getDb();

    const original = audit.audit;
    let calls = 0;
    // Force a throw on the audit insert so the transaction rolls back the user row.
    // We swap the audit helper's internal insert by overwriting one of the underlying
    // statements via a direct DB call — but the wizard uses its own prepared stmt,
    // so we instead patch the getDb().prepare('INSERT INTO audit_log ...') result
    // by triggering a unique constraint on audit_log via the trigger abort path.
    // Simpler: spy on the insert so it throws after row 0; the wizard runs
    // users INSERT + audit_log INSERT in one txn — we make audit throw.
    const db = getDb();
    const insertAudit = db.prepare(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const wrapped = vi
      .spyOn(insertAudit, 'run')
      .mockImplementation((...args: unknown[]) => {
        calls += 1;
        // First call (during getDb() migration runs): pass through
        if (calls === 1) return original.run.apply(insertAudit, args as never);
        throw new Error('forced');
      });

    void audit; // silence unused

    // Override the audit insert by replacing the prepared statement on the open db:
    // the wizard does its own prepare() call inline so we can't intercept cleanly.
    // Instead we trigger the ABORT trigger by attempting a DELETE on audit_log —
    // the wizard's INSERT will succeed but a subsequent operation will fail.
    // Simplest reliable path: drop the audit_log table just before wizard commits.
    db.exec('DROP TABLE audit_log');
    wrapped.mockRestore();

    await expect(
      wizardBootstrap({ fullName: 'Dr. Z', clinicName: 'C', pin: '9999' }),
    ).rejects.toThrow();

    // User row must NOT exist (transaction rolled back).
    const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    expect(userCount).toBe(0);
    closeDb();
  });
});