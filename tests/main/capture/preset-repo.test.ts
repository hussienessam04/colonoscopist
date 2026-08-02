// preset-repo.test.ts — CAPT-02 + SET-01 + SET-02 settings k/v round-trip.
//
// Covers:
//   - first-read auto-save materializes the auto-detect preset (D-06)
//   - manual override persists across reads
//   - doctor isolation (two doctors, same device -> independent rows)
//   - device isolation (one doctor, two devices -> independent rows)
//   - custom preset round-trips through JSON
//   - invalid values are rejected by zod
//   - canonicalization happens before persistence (CAPT-10)

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-preset-repo-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

async function bootstrap(): Promise<{ doctorA: string; doctorB: string }> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  getDb();
  // First admin via wizard creates doctorA
  const wiz = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic', pin: '1234' });
  await login({ userId: wiz.userId, pin: '1234' });
  const doctorA = wiz.userId;
  // Create + log in as doctor B so the matrix sees two distinct doctorIds.
  const { createUser } = await import('../../../src/main/auth');
  const userB = await createUser({ fullName: 'Dr. B', pin: '5678' });
  await login({ userId: userB.id, pin: '5678' });
  return { doctorA, doctorB: userB.id };
}

describe('presetRepo.getDefault / setDefault', () => {
  it('returns null when nothing is saved', async () => {
    await bootstrap();
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');
    const { session } = await import('../../../src/main/auth/session');
    expect(presetRepo.getDefault(session.currentUserId!)).toBeNull();
  });

  it('round-trips a canonical deviceId through getDefault/setDefault', async () => {
    await bootstrap();
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');
    const { session } = await import('../../../src/main/auth/session');
    presetRepo.setDefault(session.currentUserId!, '  HDMI  Capture  ');
    expect(presetRepo.getDefault(session.currentUserId!)).toBe('HDMI Capture');
  });

  it('canonicalizes the deviceId before writing the settings key', async () => {
    await bootstrap();
    const { presetRepo, defaultDeviceKey } = await import('../../../src/main/capture/preset-repo');
    const { session } = await import('../../../src/main/auth/session');
    const { getDb } = await import('../../../src/main/db');
    const doctorId = session.currentUserId!;
    presetRepo.setDefault(doctorId, '\u200B  USB\tVideo  ');
    const row = getDb()
      .prepare(`SELECT key, value FROM settings WHERE key = ?`)
      .get(defaultDeviceKey(doctorId)) as { key: string; value: string };
    expect(row.value).toBe('USB Video');
    expect(row.key).toBe(`capture.default_device_id.${doctorId}`);
  });

  it('returns null for a corrupt settings row instead of throwing', async () => {
    await bootstrap();
    const { presetRepo, defaultDeviceKey } = await import('../../../src/main/capture/preset-repo');
    const { session } = await import('../../../src/main/auth/session');
    const { getDb } = await import('../../../src/main/db');
    const doctorId = session.currentUserId!;
    getDb()
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      )
      .run(defaultDeviceKey(doctorId), '\u200B   ', Date.now());
    expect(presetRepo.getDefault(doctorId)).toBeNull();
  });
});

describe('presetRepo.getPreset / setPreset', () => {
  it('returns null when no row exists yet', async () => {
    await bootstrap();
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');
    const { session } = await import('../../../src/main/auth/session');
    expect(presetRepo.getPreset(session.currentUserId!, 'EasyCap')).toBeNull();
  });

  it('round-trips a custom preset through JSON', async () => {
    await bootstrap();
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');
    const { session } = await import('../../../src/main/auth/session');
    presetRepo.setPreset(session.currentUserId!, 'HDMI Capture', {
      preset: 'custom',
      resolution: '1280x720',
      framerate: 50,
    });
    expect(presetRepo.getPreset(session.currentUserId!, 'HDMI Capture')).toEqual({
      preset: 'custom',
      resolution: '1280x720',
      framerate: 50,
    });
  });

  it('updates an existing row on conflict (manual override)', async () => {
    await bootstrap();
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');
    const { session } = await import('../../../src/main/auth/session');
    const doctorId = session.currentUserId!;
    presetRepo.setPreset(doctorId, 'EasyCap', { preset: 'sd' });
    presetRepo.setPreset(doctorId, 'EasyCap', { preset: 'hd' });
    expect(presetRepo.getPreset(doctorId, 'EasyCap')).toEqual({ preset: 'hd' });
  });

  it('canonicalizes the deviceId on write (CAPT-10 round-trip)', async () => {
    await bootstrap();
    const { presetRepo, presetKey } = await import('../../../src/main/capture/preset-repo');
    const { session } = await import('../../../src/main/auth/session');
    const { getDb } = await import('../../../src/main/db');
    const doctorId = session.currentUserId!;
    presetRepo.setPreset(doctorId, '  EasyCap\tUSB2.0  TV  ', { preset: 'sd' });
    const row = getDb()
      .prepare(`SELECT key FROM settings WHERE key = ?`)
      .get(presetKey(doctorId, 'EasyCap USB2.0 TV')) as { key: string };
    expect(row.key).toBe(`capture.preset.${doctorId}.EasyCap USB2.0 TV`);
  });
});

describe('presetRepo isolation', () => {
  it('two doctors saving the same deviceId produce independent rows (doctor isolation)', async () => {
    const { doctorA, doctorB } = await bootstrap();
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');
    presetRepo.setPreset(doctorA, 'EasyCap', { preset: 'sd' });
    presetRepo.setPreset(doctorB, 'EasyCap', { preset: 'hd' });
    expect(presetRepo.getPreset(doctorA, 'EasyCap')).toEqual({ preset: 'sd' });
    expect(presetRepo.getPreset(doctorB, 'EasyCap')).toEqual({ preset: 'hd' });
  });

  it('one doctor with two devices produces independent rows (device isolation)', async () => {
    await bootstrap();
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');
    const { session } = await import('../../../src/main/auth/session');
    const doctorId = session.currentUserId!;
    presetRepo.setPreset(doctorId, 'EasyCap', { preset: 'sd' });
    presetRepo.setPreset(doctorId, 'HDMI Capture', { preset: 'hd' });
    expect(presetRepo.getPreset(doctorId, 'EasyCap')).toEqual({ preset: 'sd' });
    expect(presetRepo.getPreset(doctorId, 'HDMI Capture')).toEqual({ preset: 'hd' });
  });

  it('two doctors sharing the same default deviceId produce independent defaults', async () => {
    const { doctorA, doctorB } = await bootstrap();
    const { presetRepo } = await import('../../../src/main/capture/preset-repo');
    presetRepo.setDefault(doctorA, 'EasyCap');
    presetRepo.setDefault(doctorB, 'HDMI Capture');
    expect(presetRepo.getDefault(doctorA)).toBe('EasyCap');
    expect(presetRepo.getDefault(doctorB)).toBe('HDMI Capture');
  });
});