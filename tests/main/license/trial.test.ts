// @vitest-environment node
// Phase 8 / Plan 02 — trial.test.ts (LIC-01 + D-01).
//
// Per the plan <behavior> block: 4 cases cover the trial clock's
// day-boundary semantics. `getTrialState(now)` takes an OPTIONAL `now`
// so the boundary assertions are deterministic. The tests use a fresh
// in-memory-style temp DB (mirrors the existing wizard-bootstrap.test.ts
// setup) — they insert the `settings` row directly via `db.prepare(...)`
// rather than going through the wizard, so the test surface isolates
// the trial-clock reader from the wizard transaction.

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

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-trial-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('trial.ts — readTrialStartedAt / getTrialState (LIC-01)', () => {
  it('returns null when no trial_started_at row exists', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { readTrialStartedAt, getTrialState } = await import('../../../src/main/license/trial');
    getDb();

    expect(readTrialStartedAt()).toBeNull();
    expect(getTrialState()).toBeNull();

    closeDb();
  });

  it('returns the trial shape on day 1 of a fresh trial (14 days remaining)', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { readTrialStartedAt, getTrialState } = await import('../../../src/main/license/trial');
    getDb();

    const startedAt = 1700000000000;
    const db = getDb();
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
    ).run('trial_started_at', String(startedAt), startedAt);

    expect(readTrialStartedAt()).toBe(startedAt);

    const state = getTrialState(startedAt);
    expect(state).not.toBeNull();
    expect(state?.state).toBe('trial');
    expect(state?.daysRemaining).toBe(14);
    expect(state?.expiresAt).toBe(startedAt + TRIAL_DURATION_MS);

    closeDb();
  });

  it('returns null at the expired boundary (startedAt + 14d + 1ms)', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { getTrialState } = await import('../../../src/main/license/trial');
    getDb();

    const startedAt = 1700000000000;
    const db = getDb();
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
    ).run('trial_started_at', String(startedAt), startedAt);

    // One ms past the 14-day boundary → expired.
    const state = getTrialState(startedAt + TRIAL_DURATION_MS + 1);
    expect(state).toBeNull();

    // Exactly at the boundary → also expired (remaining = 0 → null).
    const atBoundary = getTrialState(startedAt + TRIAL_DURATION_MS);
    expect(atBoundary).toBeNull();

    closeDb();
  });

  it('returns daysRemaining=1 at the 1-day-remaining Math.ceil boundary', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { getTrialState } = await import('../../../src/main/license/trial');
    getDb();

    const startedAt = 1700000000000;
    const db = getDb();
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
    ).run('trial_started_at', String(startedAt), startedAt);

    // 13 days in → 1 day remaining (Math.ceil rounds the remaining ms up
    // to 1 day so the user sees "1 day" instead of "0 days" until midnight).
    const state = getTrialState(startedAt + 13 * 24 * 60 * 60 * 1000);
    expect(state).not.toBeNull();
    expect(state?.state).toBe('trial');
    expect(state?.daysRemaining).toBe(1);

    closeDb();
  });
});