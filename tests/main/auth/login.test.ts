// login flow tests — correct PIN, wrong PIN, unknown user, safeStorage-off fail-closed (Fix 3).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;
let safeStorageAvailable = true;

vi.mock('electron', () => ({
  get app() {
    return { getPath: () => tmpDir };
  },
  get safeStorage() {
    return {
      isEncryptionAvailable: () => safeStorageAvailable,
      encryptString: (s: string) => Buffer.from(s, 'utf8'),
      decryptString: (b: Buffer) => b,
    };
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-login-'));
  safeStorageAvailable = true;
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrap(pin: string): Promise<string> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap } = await import('../../../src/main/auth');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic', pin });
  return r.userId;
}

describe('login', () => {
  it('correct PIN sets session + returns UserPublic', async () => {
    const userId = await bootstrap('1234');
    const { login } = await import('../../../src/main/auth');
    const { session } = await import('../../../src/main/auth/session');

    const result = await login({ userId, pin: '1234' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(userId);
      expect(result.user.isFirstAdmin).toBe(true);
    }
    expect(session.currentUserId).toBe(userId);
  });

  it('wrong PIN returns IPC_AUTH_FAILED + increments failed_attempts', async () => {
    const userId = await bootstrap('1234');
    const { login } = await import('../../../src/main/auth');
    const { closeDb, getDb } = await import('../../../src/main/db');

    const result = await login({ userId, pin: '0000' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('IPC_AUTH_FAILED');
    }

    const user = getDb()
      .prepare('SELECT failed_attempts FROM users WHERE id = ?')
      .get(userId) as { failed_attempts: number };
    expect(user.failed_attempts).toBe(1);
    closeDb();
  });

  it('unknown userId returns IPC_AUTH_FAILED', async () => {
    await bootstrap('1234');
    const { login } = await import('../../../src/main/auth');
    const { closeDb } = await import('../../../src/main/db');

    const result = await login({
      userId: '00000000-0000-0000-0000-000000000000',
      pin: '1234',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('IPC_AUTH_FAILED');
    }
    closeDb();
  });

  it('success writes audit_log row with outcome=ok', async () => {
    const userId = await bootstrap('1234');
    const { login } = await import('../../../src/main/auth');
    const { closeDb, getDb } = await import('../../../src/main/db');

    await login({ userId, pin: '1234' });

    const rows = getDb()
      .prepare(`SELECT action, outcome FROM audit_log WHERE action = 'auth.login.success'`)
      .all() as { action: string; outcome: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].outcome).toBe('ok');
    closeDb();
  });

  it('safeStorage-off throws IPC_ENCRYPTION_UNAVAILABLE before any row writes', async () => {
    safeStorageAvailable = true;
    const userId = await bootstrap('1234');
    safeStorageAvailable = false;
    const { login } = await import('../../../src/main/auth');
    const { closeDb, getDb } = await import('../../../src/main/db');

    await expect(login({ userId, pin: '1234' })).rejects.toMatchObject({
      code: 'IPC_ENCRYPTION_UNAVAILABLE',
    });

    // failed_attempts must NOT have been incremented
    const user = getDb()
      .prepare('SELECT failed_attempts FROM users WHERE id = ?')
      .get(userId) as { failed_attempts: number };
    expect(user.failed_attempts).toBe(0);
    closeDb();
  });
});