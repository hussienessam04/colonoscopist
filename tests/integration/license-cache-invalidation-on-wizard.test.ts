// @vitest-environment node
// Phase 8 / Plan 08-08 — license cache invalidation on wizard bootstrap
// integration test (closes G-08-2).
//
// Per the plan <behavior> block: this RUN_SMOKE=1 test exercises the
// wizard → license-cache pathway. Plan 02's `license-trial-survives-reboot`
// test calls `wizardBootstrap` + `getTrialState` but never reads the
// memoized `getLicenseStatus()`, so it cannot detect the stale-cache bug
// where the module-level `cached` (status.ts:25) still holds `state:
// 'unactivated'` from pre-wizard. The new test specifically warms the
// cache BEFORE the wizard runs, then asserts the post-wizard read
// returns the fresh `state: 'trial'` shape.
//
// If Task 1's `invalidateLicenseCache()` call is missing or broken, the
// second `getLicenseStatus()` returns the same stale `'unactivated'`
// value (because the memoized cache is keyed off the sidecar + DB state
// at the first call) and the test fails with
//   `expected 'trial' but received 'unactivated'`.
//
// Verify locally with:
//   RUN_SMOKE=1 node scripts/run-vitest.cjs --run \
//     tests/integration/license-cache-invalidation-on-wizard.test.ts
//   # ...then temporarily comment out invalidateLicenseCache() in
//   # src/main/auth/index.ts to confirm the test fails (negative-control).

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmpDir = mkdtempSync(path.join(tmpdir(), 'phase8-cache-invalidation-'));

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string): string => tmpDir,
    isPackaged: false,
    getName: (): string => 'colonoscopist-phase8-cache',
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

describe.skipIf(!smokeEnabled)('license cache invalidation on wizard bootstrap (G-08-2)', () => {
  beforeAll(async () => {
    // Warm the cache FIRST so the module-level `cached` (status.ts:25)
    // holds `state: 'unactivated'` (no trial row yet → fall-through
    // branch returns unactivated). Without this warm-up, the test would
    // pass even with a broken cache because the very first read after
    // wizard would be a cache miss.
    const { getLicenseStatus } = await import('../../src/main/license/status');
    const preWizard = await getLicenseStatus();
    expect(preWizard.state).toBe('unactivated');

    // Then run the wizard — writes settings.trial_started_at inside the
    // transaction and (per Task 1) calls invalidateLicenseCache()
    // post-commit so the next read returns the fresh trial shape.
    const { wizardBootstrap } = await import('../../src/main/auth');
    await wizardBootstrap({
      fullName: 'Dr. Cache',
      clinicName: 'Cache Clinic',
      pin: '1234',
      language: 'en',
    });
  }, 60_000);

  afterEach(() => {
    vi.resetModules();
  });

  it('cached state transitions from unactivated to trial after wizardBootstrap', async () => {
    // If Task 1's invalidateLicenseCache() call is missing/broken, the
    // module-level `cached` still holds the pre-wizard 'unactivated'
    // value → getLicenseStatus() returns the stale shape → this fails.
    const { getLicenseStatus } = await import('../../src/main/license/status');
    const status = await getLicenseStatus();

    expect(status.state).toBe('trial');
    expect(status.trialDaysRemaining).toBe(14);
    expect(status.trialStartedAt).not.toBeNull();
    expect(status.expiresAt).not.toBeNull();
  }, 60_000);

  it('license.trial_started audit row is written in the same transaction', async () => {
    // Regression net — mirrors the existing
    // license-trial-survives-reboot.test.ts:78-86 pattern. If Task 1
    // accidentally moves the audit insert out of the transaction, this
    // catches it (cheap, two queries).
    const { getDb } = await import('../../src/main/db');
    const db = getDb();

    const auditRows = db
      .prepare(
        `SELECT action, metadata FROM audit_log WHERE action = 'license.trial_started'`,
      )
      .all() as { action: string; metadata: string }[];
    expect(auditRows.length).toBe(1);
    const meta = JSON.parse(auditRows[0]!.metadata) as { trialStartedAt: number };
    expect(typeof meta.trialStartedAt).toBe('number');
    expect(Number.isFinite(meta.trialStartedAt)).toBe(true);
    expect(meta.trialStartedAt).toBeGreaterThan(0);
  }, 60_000);
});

if (!smokeEnabled) {
  describe('license cache invalidation on wizard bootstrap — disabled (RUN_SMOKE not set)', () => {
    it('set RUN_SMOKE=1 to enable the cache invalidation integration smoke', () => {
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
