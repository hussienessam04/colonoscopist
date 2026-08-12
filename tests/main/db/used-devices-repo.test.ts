// used-devices table repository tests — Quick task 260812-ns0.

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
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: {
    handle: () => {},
    on: () => {},
  },
  contextBridge: {
    exposeInMainWorld: () => {},
  },
  ipcRenderer: {
    invoke: async () => null,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-used-devices-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// helper: bootstrap a user + doctor_profile row + return both ids.
async function bootstrapProfile(): Promise<{ userId: string; profileId: string }> {
  const { getDb } = await import('../../../src/main/db');
  const { doctorProfileRepo } = await import('../../../src/main/db/doctor-profile-repo');
  const db = getDb();
  const userId = '00000000-0000-4000-8000-0000000000a1';
  db.prepare(
    `INSERT INTO users (id, full_name, is_first_admin, pin_hash, failed_attempts, is_locked, created_at)
     VALUES (?, 'Dr. U', 1, 'h', 0, 0, ?)`,
  ).run(userId, Date.now());
  const profile = doctorProfileRepo.upsert({
    userId,
    fullNameEn: 'Dr. U',
    clinicNameEn: 'Clinic',
  });
  return { userId, profileId: profile.id };
}

describe('usedDevicesRepo', () => {
  it('add + get + listByProfile round-trips a device', async () => {
    const { profileId } = await bootstrapProfile();
    const { usedDevicesRepo } = await import('../../../src/main/db/used-devices-repo');
    const { closeDb } = await import('../../../src/main/db');

    const created = usedDevicesRepo.add({
      profileId,
      name: 'Olympus CV-260',
      notes: 'primary scope since 2019',
      sortOrder: 1,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.name).toBe('Olympus CV-260');
    expect(created.notes).toBe('primary scope since 2019');
    expect(created.sortOrder).toBe(1);
    expect(created.profileId).toBe(profileId);

    const fetched = usedDevicesRepo.get(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe('Olympus CV-260');

    const list = usedDevicesRepo.listByProfile(profileId);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);

    closeDb();
  });

  it('listByProfile orders by sort_order ASC then created_at ASC', async () => {
    const { profileId } = await bootstrapProfile();
    const { usedDevicesRepo } = await import('../../../src/main/db/used-devices-repo');
    const { closeDb } = await import('../../../src/main/db');

    // Insert 3 with explicit sort orders (1, 2, 0). listByProfile must
    // return them in 0, 1, 2 order — the sort_order column wins over
    // the insertion order.
    const c = usedDevicesRepo.add({ profileId, name: 'Mid (sort=1)', sortOrder: 1 });
    const a = usedDevicesRepo.add({ profileId, name: 'First (sort=0)', sortOrder: 0 });
    const b = usedDevicesRepo.add({ profileId, name: 'Last (sort=2)', sortOrder: 2 });

    const list = usedDevicesRepo.listByProfile(profileId);
    expect(list.map((d) => d.id)).toEqual([a.id, c.id, b.id]);

    closeDb();
  });

  it('remove returns true on success, false on unknown id', async () => {
    const { profileId } = await bootstrapProfile();
    const { usedDevicesRepo } = await import('../../../src/main/db/used-devices-repo');
    const { closeDb } = await import('../../../src/main/db');

    const created = usedDevicesRepo.add({ profileId, name: 'A' });
    expect(usedDevicesRepo.remove(created.id)).toBe(true);
    expect(usedDevicesRepo.remove(created.id)).toBe(false); // idempotent
    expect(usedDevicesRepo.remove('00000000-0000-4000-8000-000000000999')).toBe(false);

    closeDb();
  });
});