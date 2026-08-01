// audit_log append-only trigger tests (per AUDIT-02) + audit:list filter tests (Fix 5).

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
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-audit-'));
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
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. X', clinicName: 'C', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  return r.userId;
}

describe('audit_log triggers + auditRepo.list', () => {
  it('UPDATE on audit_log raises ABORT', async () => {
    const userId = await bootstrapAndLogin();
    const { closeDb, getDb } = await import('../../../src/main/db');

    const db = getDb();
    expect(() =>
      db.prepare(`UPDATE audit_log SET action = 'tampered' WHERE user_id = ?`).run(userId),
    ).toThrow(/append-only/);

    closeDb();
  });

  it('DELETE on audit_log raises ABORT', async () => {
    const userId = await bootstrapAndLogin();
    const { closeDb, getDb } = await import('../../../src/main/db');

    const db = getDb();
    expect(() =>
      db.prepare(`DELETE FROM audit_log WHERE user_id = ?`).run(userId),
    ).toThrow(/append-only/);

    closeDb();
  });

  it('auditRepo.list: empty range returns 0 rows', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    getDb();
    const { auditRepo } = await import('../../../src/main/db/audit');
    const r = auditRepo.list({ from: 0, to: 1 });
    expect(r.total).toBe(0);
    expect(r.rows).toEqual([]);
    closeDb();
  });

  it('auditRepo.list: full range returns all rows', async () => {
    const userId = await bootstrapAndLogin();
    const { closeDb } = await import('../../../src/main/db');
    const { auditRepo } = await import('../../../src/main/db/audit');
    const r = auditRepo.list({});
    expect(r.total).toBeGreaterThan(0);
    expect(r.rows.length).toBeGreaterThan(0);
    void userId;
    closeDb();
  });

  it('auditRepo.list: action filter narrows rows', async () => {
    await bootstrapAndLogin();
    const { closeDb } = await import('../../../src/main/db');
    const { auditRepo } = await import('../../../src/main/db/audit');
    const r = auditRepo.list({ action: 'auth.login.success' });
    expect(r.total).toBeGreaterThan(0);
    expect(r.rows.every((row) => row.action === 'auth.login.success')).toBe(true);
    closeDb();
  });

  it('auditRepo.list: userId filter narrows rows', async () => {
    const userId = await bootstrapAndLogin();
    const { closeDb } = await import('../../../src/main/db');
    const { auditRepo } = await import('../../../src/main/db/audit');
    const r = auditRepo.list({ userId });
    expect(r.total).toBeGreaterThan(0);
    expect(r.rows.every((row) => row.user_id === userId)).toBe(true);
    closeDb();
  });

  it('auditRepo.list: page bounds cap to pageSize', async () => {
    await bootstrapAndLogin();
    const { closeDb } = await import('../../../src/main/db');
    const { auditRepo } = await import('../../../src/main/db/audit');
    const r = auditRepo.list({ pageSize: 1, page: 1 });
    expect(r.rows.length).toBeLessThanOrEqual(1);
    closeDb();
  });
});