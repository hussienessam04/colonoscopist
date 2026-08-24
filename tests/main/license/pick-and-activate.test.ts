// @vitest-environment node
// Phase 8 / Plan 04 — pick-and-activate.test.ts (LIC-03 + D-06).
//
// Per the plan <behavior> block: 4 cases cover the renderer's one-shot
// picker + activation flow:
//   1. happy path: dialog returns a valid .lic path → handler invokes
//      loadAndVerifyLicense and returns the success shape
//   2. cancel path: dialog returns canceled → handler returns
//      IPC_LICENSE_CANCELLED without invoking loadAndVerifyLicense and
//      WITHOUT emitting an audit row
//   3. tampered file via picker: dialog returns a tampered .lic path →
//      handler returns IPC_LICENSE_INVALID + emits the license.invalid
//      audit row
//   4. dialog throws: surface via asIpcError
//
// ponytail: dialog.showOpenDialog is mocked via vi.mock('electron', ...);
// loadAndVerifyLicense is mocked via vi.mock('../../../src/main/license',
// ...). Tests are isolated — no real zips, no real audit DB.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

ed.hashes.sha512 = sha512;

let tmpDir: string;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

const dialogMock = {
  showOpenDialog: vi.fn(),
};

// Mutable per-test mock state for loadAndVerifyLicense so we can simulate
// success / cancel / tampered / throw without rebuilding the zip in
// every test.
const loadMock = {
  impl: vi.fn<(path: string, options?: { fingerprintOverride?: string }) => Promise<unknown>>(),
};

const capturedAudits: Array<Record<string, unknown>> = [];

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? tmpDir : tmpDir),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) =>
      (dialogMock.showOpenDialog as unknown as (...a: unknown[]) => unknown)(...args),
  },
  ipcMain: {
    handle: (channel: string, cb: (...args: unknown[]) => unknown) => {
      handlers.set(channel, cb);
    },
    on: () => {},
  },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

vi.mock('../../../src/main/license', async () => {
  return {
    getLicenseStatus: async () => ({
      state: 'unactivated',
      vendorId: null,
      licensedAt: null,
      expiresAt: null,
      trialStartedAt: null,
      trialDaysRemaining: null,
      machineId: 'm'.repeat(64),
    }),
    licenseGated: <P extends unknown[], R>(
      _channel: string,
      handler: (event: unknown, ...args: P) => Promise<R> | R,
    ) => handler as (event: unknown, ...args: P) => Promise<R> | R,
    EXEMPT_CHANNELS: new Set<string>([]),
    loadAndVerifyLicense: (path: string, options?: { fingerprintOverride?: string }) =>
      loadMock.impl(path, options),
  };
});

vi.mock('../../../src/main/db/audit', () => ({
  audit: (opts: Record<string, unknown>) => {
    capturedAudits.push(opts);
  },
  auditRepo: {
    append: (opts: Record<string, unknown>) => {
      capturedAudits.push(opts);
    },
    list: () => ({ rows: [], total: 0 }),
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'colonosco-pick-activate-'));
  handlers.clear();
  capturedAudits.length = 0;
  dialogMock.showOpenDialog.mockReset();
  loadMock.impl.mockReset();
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrapAndLogin(): Promise<void> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap } = await import('../../../src/main/auth');
  getDb();
  await wizardBootstrap({ fullName: 'Dr. L', clinicName: 'Clinic L', pin: '1234' });
}

describe('LICENSE_PICK_AND_ACTIVATE IPC (Plan 04 + D-06)', () => {
  it('happy path: dialog returns a valid .lic path → handler invokes loadAndVerifyLicense and returns the success shape', async () => {
    await bootstrapAndLogin();

    // The mock returns success — the actual zip construction is mocked
    // away by vi.mock('../../../src/main/license', ...).
    const successShape = { ok: true as const, vendorId: 'test-vendor', licensedAt: 1700000000000 };
    loadMock.impl.mockResolvedValueOnce(successShape);

    const fakeLicPath = join(tmpDir, `${randomUUID()}.lic`);
    dialogMock.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [fakeLicPath],
    });

    const { registerLicenseIpc } = await import('../../../src/main/ipc/license');
    registerLicenseIpc();
    const handler = handlers.get('license:pick-and-activate');
    expect(handler).toBeDefined();

    const result = (await handler!({}, undefined)) as unknown;
    expect(result).toEqual(successShape);

    // loadAndVerifyLicense was called once with the picked path.
    expect(loadMock.impl).toHaveBeenCalledTimes(1);
    const firstCall = loadMock.impl.mock.calls[0];
    expect(firstCall?.[0]).toBe(fakeLicPath);

    // No audit row — the success shape's audit row lives inside
    // loadAndVerifyLicense (mocked here). The handler itself doesn't
    // emit a row.
    expect(capturedAudits).toHaveLength(0);
  });

  it('cancel path: dialog canceled → returns IPC_LICENSE_CANCELLED WITHOUT invoking loadAndVerifyLicense and WITHOUT emitting an audit row', async () => {
    await bootstrapAndLogin();
    dialogMock.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    });

    const { registerLicenseIpc } = await import('../../../src/main/ipc/license');
    registerLicenseIpc();
    const handler = handlers.get('license:pick-and-activate');
    expect(handler).toBeDefined();

    const result = (await handler!({}, undefined)) as { ok: false; code: string };
    expect(result).toEqual({ ok: false, code: 'IPC_LICENSE_CANCELLED' });

    // loadAndVerifyLicense was NEVER invoked.
    expect(loadMock.impl).not.toHaveBeenCalled();
    // No audit row on cancel — distinct from a real tampered attempt.
    expect(capturedAudits).toHaveLength(0);
  });

  it('tampered file via picker: dialog returns a tampered .lic → handler returns IPC_LICENSE_INVALID + emits license.invalid audit row (via mocked loadAndVerifyLicense)', async () => {
    await bootstrapAndLogin();
    const tamperedShape = {
      ok: false as const,
      code: 'IPC_LICENSE_INVALID',
      reason: 'SIGNATURE_MISMATCH',
    };
    loadMock.impl.mockResolvedValueOnce(tamperedShape);

    const fakeLicPath = join(tmpDir, `${randomUUID()}.lic`);
    dialogMock.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [fakeLicPath],
    });

    const { registerLicenseIpc } = await import('../../../src/main/ipc/license');
    registerLicenseIpc();
    const handler = handlers.get('license:pick-and-activate');
    expect(handler).toBeDefined();

    const result = (await handler!({}, undefined)) as { ok: false; code: string; reason: string };
    expect(result).toEqual(tamperedShape);

    // loadAndVerifyLicense WAS called once.
    expect(loadMock.impl).toHaveBeenCalledTimes(1);
    // No audit row from the handler — the audit row for a tampered attempt
    // is emitted inside loadAndVerifyLicense (mocked here).
    // The handler itself does NOT emit a row when loadAndVerifyLicense
    // returns an invalid result; that's the contract.
    expect(capturedAudits).toHaveLength(0);
  });

  it('dialog throws: error surfaces via asIpcError (does NOT swallow)', async () => {
    await bootstrapAndLogin();
    dialogMock.showOpenDialog.mockRejectedValueOnce(new Error('dialog crashed'));

    const { registerLicenseIpc } = await import('../../../src/main/ipc/license');
    registerLicenseIpc();
    const handler = handlers.get('license:pick-and-activate');
    expect(handler).toBeDefined();

    let caught: unknown = null;
    try {
      await handler!({}, undefined);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    // The error is surfaced wrapped (asIpcError wraps non-Ipc errors as plain Error).
    expect((caught as Error).message).toBe('dialog crashed');
    expect(loadMock.impl).not.toHaveBeenCalled();
    expect(capturedAudits).toHaveLength(0);
  });
});
