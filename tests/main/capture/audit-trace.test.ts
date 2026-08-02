// audit-trace.test.ts — end-to-end audit verification for every capture.* IPC.
//
// Covers BLOCKER 4 (session-scoped doctorId), BLOCKER 5 (capture.no_device
// empty-state sink), and Q-A (first-save `matched` audit metadata).
//
// Every persistent capture mutation must:
//   - read its doctorId from requireSession() (BLOCKER 4)
//   - ignore any `doctorId` field in the IPC payload
//   - write an audit_log row whose `user_id` equals the session user
//   - persist the canonical deviceName in metadata
// The `capture.no_device` sink must require a session (BLOCKER 5).

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
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-capture-audit-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

type AuditRow = {
  action: string;
  entity_id: string | null;
  metadata: string | null;
  user_id: string | null;
  outcome: string;
};

async function loadDbAndAudit(): Promise<{
  getDb: () => { prepare: (q: string) => { all: () => unknown[] } };
}> {
  const { getDb } = await import('../../../src/main/db');
  return { getDb };
}

async function bootstrapAndLoginAsAdmin(): Promise<string> {
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const wiz = await wizardBootstrap({ fullName: 'Dr. Audit', clinicName: 'C', pin: '1234' });
  await login({ userId: wiz.userId, pin: '1234' });
  return wiz.userId;
}

function captureRows(rows: AuditRow[], action: string): AuditRow[] {
  return rows.filter((r) => r.action === action);
}

describe('capture IPC audit trace', () => {
  it('getPreset + setPreset + setDefaultDevice + noDeviceAudit all write expected audit rows', async () => {
    const doctorId = await bootstrapAndLoginAsAdmin();
    const { getDb } = await loadDbAndAudit();
    const {
      setDefaultDevice,
      setPreset,
      getPreset,
      noDeviceAudit,
    } = await import('../../../src/main/ipc/capture');

    // 1. setDefaultDevice — audit row with stage:save, canonical deviceName, user_id from session
    setDefaultDevice({ deviceId: '  EasyCap\tUSB  Video  ' });
    // 2. setPreset — audit row with manual override
    setPreset({ deviceId: 'EasyCap USB Video', preset: { preset: 'custom', resolution: '720x480', framerate: 30 } });
    // 3. getPreset — reads the matrix row (subsequent read, NO matched metadata)
    const presetRead = getPreset({ deviceId: 'EasyCap USB Video' });
    expect(presetRead).toEqual({
      preset: { preset: 'custom', resolution: '720x480', framerate: 30 },
      matched: null,
    });
    // 4. noDeviceAudit — empty-state marker
    noDeviceAudit({});

    const rows = getDb()
      .prepare(
        `SELECT action, entity_id, metadata, user_id, outcome
         FROM audit_log
         WHERE action LIKE 'capture.%'
         ORDER BY id ASC`,
      )
      .all() as AuditRow[];

    // Expect: device_changed (save), preset_changed (manual), preset_changed (read), no_device
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual([
      'capture.device_changed',
      'capture.preset_changed',
      'capture.preset_changed',
      'capture.no_device',
    ]);

    // Every row's user_id must equal the session doctorId (BLOCKER 4).
    for (const row of rows) {
      expect(row.user_id).toBe(doctorId);
    }

    // device_changed audit carries the canonical deviceName (NOT the raw input).
    const deviceRow = captureRows(rows, 'capture.device_changed')[0]!;
    expect(deviceRow.metadata).not.toBeNull();
    expect(JSON.parse(deviceRow.metadata!).deviceName).toBe('EasyCap USB Video');
    expect(JSON.parse(deviceRow.metadata!).stage).toBe('save');

    // Manual preset audit carries the preset key without a `matched` field
    // (Q-A: only first auto-detect emits `matched`).
    const manualPresetRow = captureRows(rows, 'capture.preset_changed')[0]!;
    expect(JSON.parse(manualPresetRow.metadata!).preset).toBe('custom');
    expect(JSON.parse(manualPresetRow.metadata!)).not.toHaveProperty('matched');

    // Subsequent read also does not include matched.
    const readPresetRow = captureRows(rows, 'capture.preset_changed')[1]!;
    expect(JSON.parse(readPresetRow.metadata!).preset).toBe('custom');
    expect(JSON.parse(readPresetRow.metadata!)).not.toHaveProperty('matched');
  });

  it('first-save auto-detect emits `matched` regex metadata; subsequent reads do not (Q-A)', async () => {
    await bootstrapAndLoginAsAdmin();
    const { getDb } = await loadDbAndAudit();
    const { getPreset } = await import('../../../src/main/ipc/capture');

    // First read of an unknown device -> auto-detect saves + emits `matched`.
    getPreset({ deviceId: 'EasyCap USB Video' });
    // Second read -> reads the persisted row; no `matched` field.
    getPreset({ deviceId: 'EasyCap USB Video' });

    const presetRows = getDb()
      .prepare(
        `SELECT metadata FROM audit_log WHERE action = 'capture.preset_changed' ORDER BY id ASC`,
      )
      .all() as { metadata: string | null }[];

    expect(presetRows.length).toBe(2);
    const first = JSON.parse(presetRows[0]!.metadata!);
    expect(first.matched).toBe('sd-pattern-EasyCap');
    expect(first.deviceName).toBe('EasyCap USB Video');
    expect(first.preset).toBe('sd');

    const second = JSON.parse(presetRows[1]!.metadata!);
    expect(second).not.toHaveProperty('matched');
    expect(second.preset).toBe('sd');
  });

  it('setPreset ignores any doctorId in the IPC payload and derives from requireSession() (BLOCKER 4)', async () => {
    const doctorId = await bootstrapAndLoginAsAdmin();
    const { getDb } = await loadDbAndAudit();
    const { setPreset } = await import('../../../src/main/ipc/capture');

    // Sneak a foreign doctorId in the payload — it must be ignored.
    setPreset({
      // ponytail: zod strips unknown keys because we did not opt into .passthrough().
      // Either way, the row must record the SESSION user_id, never the smuggled one.
      deviceId: 'HDMI Capture',
      preset: { preset: 'hd' },
      doctorId: '00000000-0000-0000-0000-000000000000',
    } as never);

    const row = getDb()
      .prepare(
        `SELECT user_id, metadata FROM audit_log WHERE action = 'capture.preset_changed'`,
      )
      .get() as { user_id: string | null; metadata: string | null };

    expect(row.user_id).toBe(doctorId);
    expect(row.user_id).not.toBe('00000000-0000-0000-0000-000000000000');
    expect(JSON.parse(row.metadata!).deviceName).toBe('HDMI Capture');
  });

  it('setDefaultDevice ignores any doctorId in the IPC payload (BLOCKER 4)', async () => {
    const doctorId = await bootstrapAndLoginAsAdmin();
    const { getDb } = await loadDbAndAudit();
    const { setDefaultDevice } = await import('../../../src/main/ipc/capture');
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');

    setDefaultDevice({
      deviceId: 'EasyCap USB Video',
      doctorId: '00000000-0000-0000-0000-000000000000',
    } as never);

    // The settings row is keyed by the session doctorId, NOT the smuggled one.
    expect(presetRepo.getDefault(doctorId)).toBe('EasyCap USB Video');
    expect(presetRepo.getDefault('00000000-0000-0000-0000-000000000000')).toBeNull();

    const row = getDb()
      .prepare(
        `SELECT user_id FROM audit_log WHERE action = 'capture.device_changed'`,
      )
      .get() as { user_id: string | null };
    expect(row.user_id).toBe(doctorId);
  });

  it('noDeviceAudit refuses to write when there is no session (BLOCKER 5)', async () => {
    const { getDb } = await loadDbAndAudit();
    const { wizardBootstrap } = await import('../../../src/main/auth');
    await wizardBootstrap({ fullName: 'Dr. X', clinicName: 'C', pin: '1234' });
    // Stay logged out — session.currentUserId is null after the wizard.
    const { session } = await import('../../../src/main/auth/session');
    expect(session.currentUserId).toBeNull();

    const { noDeviceAudit } = await import('../../../src/main/ipc/capture');
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(() => noDeviceAudit({})).toThrow(IpcErrorException);

    const before = (getDb().prepare(
      `SELECT COUNT(*) AS c FROM audit_log WHERE action = 'capture.no_device'`,
    ).get() as { c: number }).c;
    expect(before).toBe(0);
  });

  it('noDeviceAudit writes a row tagged source:renderer-empty-state when a session is present (BLOCKER 5)', async () => {
    await bootstrapAndLoginAsAdmin();
    const { getDb } = await loadDbAndAudit();
    const { noDeviceAudit } = await import('../../../src/main/ipc/capture');
    noDeviceAudit({});

    const row = getDb()
      .prepare(
        `SELECT metadata, user_id FROM audit_log WHERE action = 'capture.no_device'`,
      )
      .get() as { metadata: string | null; user_id: string | null };

    expect(row).not.toBeNull();
    expect(JSON.parse(row.metadata!).source).toBe('renderer-empty-state');
    expect(row.user_id).not.toBeNull();
  });

  it('getDefaultDevice writes a capture.device_changed audit row with stage:read', async () => {
    await bootstrapAndLoginAsAdmin();
    const { getDb } = await loadDbAndAudit();
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');
    const { getDefaultDevice } = await import('../../../src/main/ipc/capture');
    const { session } = await import('../../../src/main/auth/session');
    presetRepo.setDefault(session.currentUserId!, 'EasyCap USB Video');

    getDefaultDevice();

    const row = getDb()
      .prepare(
        `SELECT metadata FROM audit_log WHERE action = 'capture.device_changed' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { metadata: string | null };

    const meta = JSON.parse(row.metadata!);
    expect(meta.stage).toBe('read');
    expect(meta.deviceName).toBe('EasyCap USB Video');
  });
});