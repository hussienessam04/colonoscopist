// Session model tests (per AUTH-04).

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-session-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('session', () => {
  it('currentUserId is null on fresh import', async () => {
    const { session } = await import('../../src/main/auth/session');
    expect(session.currentUserId).toBeNull();
  });

  it('set then clear round-trip', async () => {
    const { session } = await import('../../src/main/auth/session');
    session.set('user-a');
    expect(session.currentUserId).toBe('user-a');
    session.clear();
    expect(session.currentUserId).toBeNull();
  });

  it('login success sets session to the current user', async () => {
    const { getDb, closeDb } = await import('../../src/main/db');
    const { wizardBootstrap, login } = await import('../../src/main/auth');
    const { session } = await import('../../src/main/auth/session');
    getDb();
    const wiz = await wizardBootstrap({ fullName: 'Dr. S', clinicName: 'C', pin: '1234' });
    await login({ userId: wiz.userId, pin: '1234' });
    expect(session.currentUserId).toBe(wiz.userId);
    closeDb();
  });

  it('logout clears session', async () => {
    const { getDb, closeDb } = await import('../../src/main/db');
    const { wizardBootstrap, login, logout } = await import('../../src/main/auth');
    const { session } = await import('../../src/main/auth/session');
    getDb();
    const wiz = await wizardBootstrap({ fullName: 'Dr. S', clinicName: 'C', pin: '1234' });
    await login({ userId: wiz.userId, pin: '1234' });
    logout();
    expect(session.currentUserId).toBeNull();
    closeDb();
  });

  it('app restart resets session (no persistence across modules)', async () => {
    const { getDb, closeDb } = await import('../../src/main/db');
    const { wizardBootstrap, login } = await import('../../src/main/auth');
    const { session } = await import('../../src/main/auth/session');
    getDb();
    const wiz = await wizardBootstrap({ fullName: 'Dr. S', clinicName: 'C', pin: '1234' });
    await login({ userId: wiz.userId, pin: '1234' });
    expect(session.currentUserId).toBe(wiz.userId);
    closeDb();

    // Simulate restart — re-import everything.
    vi.resetModules();
    const { session: freshSession } = await import('../../src/main/auth/session');
    expect(freshSession.currentUserId).toBeNull();
  });
});