// @vitest-environment node
// Phase 8 / Plan 02 — license-trial-survives-reboot integration test
// (LIC-01 + D-02 verbatim).
//
// Per the plan <behavior> block: this RUN_SMOKE=1 test boots the live
// DB via wizardBootstrap, asserts the trial row is written + read back,
// calls `closeDb()` + `getDb()` (re-open), then asserts the trial row
// STILL exists and the trial clock reads the same `daysRemaining`.
// Proves the row is in WAL-committed state (not in-memory) and survives
// the singleton re-init.
//
// Verify locally with:
//   RUN_SMOKE=1 node scripts/run-vitest.cjs --run tests/integration/license-trial-survives-reboot.test.ts

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmpDir = mkdtempSync(path.join(tmpdir(), 'phase8-trial-reboot-'));

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string): string => tmpDir,
    isPackaged: false,
    getName: (): string => 'colonoscopist-phase8-trial',
    getVersion: (): string => '0.0.0',
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
  shell: { showItemInFolder: () => {} },
}));

// ponytail: truthy check (not === '1') — vitest worker process inheritance
// of RUN_SMOKE from the wrapper script is reliable but a strict equality
// on '1' failed in dev. Boolean coercion is enough.
const smokeEnabled = Boolean(process.env.RUN_SMOKE);

describe.skipIf(!smokeEnabled)('trial clock survives DB close + reopen (LIC-01 + D-02)', () => {
  beforeAll(async () => {
    // Force-init the live DB at the mocked userData via wizardBootstrap.
    // The wizard transaction writes `settings.trial_started_at` + the
    // `license.trial_started` audit row inside the same db.transaction
    // (per Plan 02 action step).
    const { wizardBootstrap } = await import('../../src/main/auth');
    await wizardBootstrap({
      fullName: 'Dr. Trial',
      clinicName: 'Trial Clinic',
      pin: '1234',
      language: 'en',
    });
  }, 60_000);

  afterEach(() => {
    vi.resetModules();
  });

  it('wizard writes trial_started_at row inside the transaction', async () => {
    const { getDb } = await import('../../src/main/db');
    const db = getDb();

    const trialRow = db
      .prepare(`SELECT value FROM settings WHERE key = 'trial_started_at'`)
      .get() as { value: string } | undefined;
    expect(trialRow).toBeDefined();
    const parsedMs = parseInt(trialRow!.value, 10);
    expect(Number.isFinite(parsedMs)).toBe(true);
    expect(parsedMs).toBeGreaterThan(0);

    // The license.trial_started audit row was also written in the same txn.
    const auditRows = db
      .prepare(
        `SELECT action, metadata FROM audit_log WHERE action = 'license.trial_started'`,
      )
      .all() as { action: string; metadata: string }[];
    expect(auditRows.length).toBe(1);
    const meta = JSON.parse(auditRows[0]!.metadata) as { trialStartedAt: number };
    expect(meta.trialStartedAt).toBe(parsedMs);
  }, 60_000);

  it('getTrialState returns the trial shape BEFORE close', async () => {
    const { getTrialState } = await import('../../src/main/license/trial');
    const state = getTrialState();
    expect(state).not.toBeNull();
    expect(state?.state).toBe('trial');
    // The trial is brand new → 14 days remaining (Math.ceil on full ms).
    expect(state?.daysRemaining).toBe(14);
  }, 60_000);

  it('trial row survives close + reopen; daysRemaining is unchanged', async () => {
    // Read the daysRemaining BEFORE close.
    const { getTrialState: getTrialStateBefore } = await import('../../src/main/license/trial');
    const before = getTrialStateBefore();
    expect(before).not.toBeNull();
    const daysBefore = before!.daysRemaining;
    const expiresAtBefore = before!.expiresAt;

    // Close the singleton + reopen from the same file path.
    const { getDb, closeDb } = await import('../../src/main/db');
    closeDb();
    const dbAfter = getDb();

    // After reopen, the trial row is read from disk (not from in-memory state).
    const trialRow = dbAfter
      .prepare(`SELECT value FROM settings WHERE key = 'trial_started_at'`)
      .get() as { value: string } | undefined;
    expect(trialRow).toBeDefined();

    // daysRemaining is unchanged because the trial was just started
    // (microseconds elapsed between calls are negligible).
    const { getTrialState: getTrialStateAfter } = await import('../../src/main/license/trial');
    const after = getTrialStateAfter();
    expect(after).not.toBeNull();
    expect(after?.state).toBe('trial');
    expect(after?.daysRemaining).toBe(daysBefore);
    expect(after?.expiresAt).toBe(expiresAtBefore);
  }, 60_000);
});

if (!smokeEnabled) {
  describe('license trial survives reboot — disabled (RUN_SMOKE not set)', () => {
    it('set RUN_SMOKE=1 to enable the trial reboot integration smoke', () => {
      expect(smokeEnabled).toBe(false);
    });
  });
}

afterAll(() => {
  // ponytail: best-effort cleanup. Windows holds file handles briefly after
  // the test process exits; rmSync might EBUSY on the WAL files but the
  // dir is in tmpdir so the OS will sweep it.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});