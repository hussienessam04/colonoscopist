// doctor-profile-repo unit tests — Wave 0 of Plan 06-01.
// Per PROF-01 + D-01..D-04.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? tmpDir : tmpDir),
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
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-profile-repo-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrap(): Promise<{ userId: string }> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const db = getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  // Verify backfill ran: one doctor_profile row per user.
  const rows = db.prepare(`SELECT COUNT(*) AS c FROM doctor_profile`).get() as { c: number };
  expect(rows.c).toBe(1);
  return { userId: r.userId };
}

describe('doctorProfileRepo', () => {
  it('migration 0004 backfills one doctor_profile row per user from users.full_name + settings.clinic_name', async () => {
    const { userId } = await bootstrap();
    const { doctorProfileRepo } = await import('../../../src/main/db/doctor-profile-repo');
    const row = doctorProfileRepo.get(userId);
    expect(row).not.toBeNull();
    expect(row?.fullNameEn).toBe('Dr. A');
    expect(row?.clinicNameEn).toBe('Clinic A');
    expect(row?.fullNameAr).toBeNull();
    expect(row?.clinicNameAr).toBeNull();
  });

  it('upsert inserts a new row when none exists, with bilingual fields + nullable AR', async () => {
    const { getDb } = await import('../../../src/main/db');
    await bootstrap();
    // Insert a second user directly (no backfill because we manually add it).
    const db = getDb();
    const secondUserId = '00000000-0000-4000-8000-000000000099';
    db.prepare(
      `INSERT INTO users (id, full_name, is_first_admin, pin_hash, failed_attempts, is_locked, created_at)
       VALUES (?, ?, 0, 'h', 0, 0, ?)`,
    ).run(secondUserId, 'Dr. B', Date.now());
    const { doctorProfileRepo } = await import('../../../src/main/db/doctor-profile-repo');
    const created = doctorProfileRepo.upsert({
      userId: secondUserId,
      fullNameEn: 'Dr. B',
      fullNameAr: 'د. ب',
      clinicNameEn: 'Clinic B',
      clinicNameAr: 'عيادة ب',
      address: '123 Main',
      phone: '+1-555-0100',
    });
    expect(created.fullNameEn).toBe('Dr. B');
    expect(created.fullNameAr).toBe('د. ب');
    expect(created.clinicNameEn).toBe('Clinic B');
    expect(created.clinicNameAr).toBe('عيادة ب');
    expect(created.address).toBe('123 Main');
    expect(created.phone).toBe('+1-555-0100');
  });

  it('upsert updates an existing row, advancing updated_at but keeping created_at', async () => {
    const { userId } = await bootstrap();
    const { doctorProfileRepo } = await import('../../../src/main/db/doctor-profile-repo');
    const initial = doctorProfileRepo.get(userId);
    expect(initial).not.toBeNull();
    const originalCreatedAt = initial!.createdAt;
    const originalUpdatedAt = initial!.updatedAt;
    // Wait long enough to detect the timestamp delta.
    await new Promise((r) => setTimeout(r, 5));
    const updated = doctorProfileRepo.upsert({
      userId,
      fullNameEn: 'Dr. A Renamed',
      clinicNameEn: 'Clinic Renamed',
    });
    expect(updated.fullNameEn).toBe('Dr. A Renamed');
    expect(updated.clinicNameEn).toBe('Clinic Renamed');
    expect(updated.createdAt).toBe(originalCreatedAt);
    expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  it('upsert called twice on the same user keeps exactly one row (idempotent)', async () => {
    const { userId } = await bootstrap();
    const { doctorProfileRepo } = await import('../../../src/main/db/doctor-profile-repo');
    const { getDb } = await import('../../../src/main/db');
    doctorProfileRepo.upsert({ userId, fullNameEn: 'X', clinicNameEn: 'Y' });
    doctorProfileRepo.upsert({ userId, fullNameEn: 'Z', clinicNameEn: 'W' });
    const rows = getDb().prepare(`SELECT COUNT(*) AS c FROM doctor_profile WHERE user_id = ?`).get(userId) as {
      c: number;
    };
    expect(rows.c).toBe(1);
  });

  it('updateSignaturePath writes signature_path and get() returns it', async () => {
    const { userId } = await bootstrap();
    const { doctorProfileRepo } = await import('../../../src/main/db/doctor-profile-repo');
    doctorProfileRepo.updateSignaturePath(userId, 'profiles/user-x/signature.png');
    const row = doctorProfileRepo.get(userId);
    expect(row?.signaturePath).toBe('profiles/user-x/signature.png');
  });

  it('updateLogoPath writes logo_path and get() returns it', async () => {
    const { userId } = await bootstrap();
    const { doctorProfileRepo } = await import('../../../src/main/db/doctor-profile-repo');
    doctorProfileRepo.updateLogoPath(userId, 'profiles/user-x/logo.png');
    const row = doctorProfileRepo.get(userId);
    expect(row?.logoPath).toBe('profiles/user-x/logo.png');
  });

  it('get returns null for an unknown userId', async () => {
    await bootstrap();
    const { doctorProfileRepo } = await import('../../../src/main/db/doctor-profile-repo');
    const row = doctorProfileRepo.get('00000000-0000-4000-8000-deadbeef0000');
    expect(row).toBeNull();
  });
});
