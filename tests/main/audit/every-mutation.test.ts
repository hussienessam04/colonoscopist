// every-mutation test — verify that wizardBootstrap, login (success/failure),
// createUser, and resetPin each write the expected audit_log row.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-mutations-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('every mutation writes audit_log', () => {
  it('wizardBootstrap + login success/fail + createUser + resetPin all write rows', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { wizardBootstrap, login, createUser, resetPin } = await import('../../../src/main/auth');
    const { auditRepo } = await import('../../../src/main/db/audit');

    getDb();
    const wiz = await wizardBootstrap({ fullName: 'Dr. M', clinicName: 'C', pin: '1234' });

    // success login
    await login({ userId: wiz.userId, pin: '1234' });

    // failed login (different user id, but still writes audit)
    await login({ userId: '00000000-0000-0000-0000-000000000000', pin: '9999' });

    // createUser requires admin session
    const newUser = await createUser({ fullName: 'Dr. N', pin: '4321' });

    // resetPin
    await resetPin({ userId: newUser.id, newPin: '5678' });

    const all = auditRepo.list({}).rows.map((r) => r.action);
    expect(all).toContain('auth.bootstrap.completed');
    expect(all).toContain('auth.login.success');
    expect(all).toContain('auth.login.failed');
    expect(all).toContain('users.create');
    expect(all).toContain('users.reset_pin');

    closeDb();
  });
});