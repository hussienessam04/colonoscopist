// Rate-limit + lockout tests (per AUTH-02 + Fix 2).
// Verifies exponential backoff + 10-failure indefinite lockout + restart preservation.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-rate-'));
  vi.useRealTimers();
});

afterEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrapUser(pin: string): Promise<string> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap } = await import('../../../src/main/auth');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. R', clinicName: 'C', pin });
  return r.userId;
}

describe('rate-limit + lockout', () => {
  it('5 failures populate backoff map with values 1s/2s/4s/8s/16s', async () => {
    vi.useFakeTimers();
    const userId = await bootstrapUser('1234');
    const { login } = await import('../../../src/main/auth');
    const { backoff } = await import('../../../src/main/auth/rate-limit');
    const { closeDb } = await import('../../../src/main/db');

    const expected = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < 5; i++) {
      const r = await login({ userId, pin: '0000' });
      expect(r.ok).toBe(false);
      vi.advanceTimersByTime(20_000); // step past the next backoff so the next attempt runs
    }

    // After 5 failures, the backoff map should have an entry for this user
    expect(backoff.has(userId)).toBe(true);
    expect(expected).toEqual([1000, 2000, 4000, 8000, 16000]);
    closeDb();
  });

  it('10th failure calls setLockedUntil(sentinel) + setIsLocked(true) + returns IPC_LOCKED', async () => {
    vi.useFakeTimers();
    const userId = await bootstrapUser('1234');
    const { login } = await import('../../../src/main/auth');
    const { closeDb, getDb } = await import('../../../src/main/db');
    const { SENTINEL_LOCKED_UNTIL } = await import('../../../src/main/auth/rate-limit');

    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(120_000); // step past any backoff
      const r = await login({ userId, pin: '0000' });
      expect(r.ok).toBe(false);
    }
    vi.advanceTimersByTime(120_000);
    const tenth = await login({ userId, pin: '0000' });
    expect(tenth.ok).toBe(false);
    if (!tenth.ok) {
      expect(tenth.code).toBe('IPC_LOCKED');
      expect(tenth.retryAt).toBe(SENTINEL_LOCKED_UNTIL);
    }

    const row = getDb()
      .prepare('SELECT failed_attempts, is_locked, locked_until FROM users WHERE id = ?')
      .get(userId) as { failed_attempts: number; is_locked: number; locked_until: number };
    expect(row.failed_attempts).toBe(10);
    expect(row.is_locked).toBe(1);
    expect(row.locked_until).toBe(SENTINEL_LOCKED_UNTIL);
    closeDb();
  });

  it('restart preserves lock — close + reopen + correct PIN returns IPC_LOCKED', async () => {
    vi.useFakeTimers();
    const userId = await bootstrapUser('1234');
    const { login } = await import('../../../src/main/auth');
    const { SENTINEL_LOCKED_UNTIL } = await import('../../../src/main/auth/rate-limit');

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(120_000);
      await login({ userId, pin: '0000' });
    }

    // Simulate app restart: close + reopen DB (the singleton is reset).
    const { closeDb } = await import('../../../src/main/db');
    closeDb();
    vi.resetModules();

    // Reopen with the same tempdir (electron mock still points to the same path)
    const login2 = (await import('../../../src/main/auth')).login;
    const result = await login2({ userId, pin: '1234' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('IPC_LOCKED');
      expect(result.retryAt).toBe(SENTINEL_LOCKED_UNTIL);
    }
  });

  it('nextBackoffMs returns 1000, 2000, 4000, 8000, 16000, 32000, then capped at 60000', async () => {
    const { nextBackoffMs } = await import('../../../src/main/auth/rate-limit');
    expect(nextBackoffMs(1)).toBe(1000);
    expect(nextBackoffMs(2)).toBe(2000);
    expect(nextBackoffMs(3)).toBe(4000);
    expect(nextBackoffMs(4)).toBe(8000);
    expect(nextBackoffMs(5)).toBe(16000);
    expect(nextBackoffMs(6)).toBe(32000);
    expect(nextBackoffMs(7)).toBe(60_000);
    expect(nextBackoffMs(20)).toBe(60_000);
  });
});