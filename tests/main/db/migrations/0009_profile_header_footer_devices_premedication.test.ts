// Quick task 260812-ns0 — 0009_profile_header_footer_devices_premedication migration contract.
// Adds 3 new doctor_profile columns + a new used_devices 1:N table.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-0009-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('0009_profile_header_footer_devices_premedication migration', () => {
  it('adds 3 new doctor_profile columns + a new used_devices table on first open', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');
    const db = getDb();

    // doctor_profile gains 3 new columns.
    const profileColumns = db
      .prepare(`PRAGMA table_info(doctor_profile)`)
      .all() as { name: string; notnull: number }[];
    const names = profileColumns.map((c) => c.name);
    expect(names).toContain('header_image_path');
    expect(names).toContain('footer_image_path');
    expect(names).toContain('premedication');
    // All three are nullable (no schema-level NOT NULL — the invariant
    // lives in the repo's nextMrn()/premedication-free-text contract).
    for (const col of ['header_image_path', 'footer_image_path', 'premedication']) {
      const c = profileColumns.find((p) => p.name === col);
      expect(c?.notnull).toBe(0);
    }

    // used_devices table exists with the expected columns.
    const usedDevicesColumns = db
      .prepare(`PRAGMA table_info(used_devices)`)
      .all() as { name: string; notnull: number; pk: number }[];
    const udNames = usedDevicesColumns.map((c) => c.name);
    expect(udNames).toContain('id');
    expect(udNames).toContain('profile_id');
    expect(udNames).toContain('name');
    expect(udNames).toContain('notes');
    expect(udNames).toContain('sort_order');
    expect(udNames).toContain('created_at');
    expect(udNames).toContain('updated_at');
    const idCol = usedDevicesColumns.find((c) => c.name === 'id');
    expect(idCol?.pk).toBe(1);
    const nameCol = usedDevicesColumns.find((c) => c.name === 'name');
    expect(nameCol?.notnull).toBe(1);
    const profileIdCol = usedDevicesColumns.find((c) => c.name === 'profile_id');
    expect(profileIdCol?.notnull).toBe(1);
    const sortOrderCol = usedDevicesColumns.find((c) => c.name === 'sort_order');
    expect(sortOrderCol?.notnull).toBe(1);

    // The idx_used_devices_profile index exists.
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'used_devices'`)
      .all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('idx_used_devices_profile');

    closeDb();
  });

  it('is idempotent — second open adds no migration rows', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');

    const db1 = getDb();
    // 0001 + 0002 + 0003 + 0004 + 0007 + 0008 + 0009 + 0010 + 0011 + 0012 = 10 entries
    // (0010 = report procedure-type + 8 box columns + templates table
    // from quick task 20260812-redesign-report; 0011 = settings.trial_started_at
    // from Phase 8 / Plan 01; 0012 = revert the redesign drop columns
    // from Phase 8 / Plan 15 (G-08-8)).
    expect((db1.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(10);
    closeDb();

    const db2 = getDb();
    expect((db2.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(10);

    closeDb();
  });

  it('FK from used_devices.profile_id to doctor_profile fires ON DELETE CASCADE', async () => {
    // Open the DB via getDb (runs all migrations including 0009), then
    // insert a profile + a device, then DELETE the profile and assert
    // the device row is gone. Validates the CASCADE clause.
    const { getDb, closeDb } = await import('../../../../src/main/db');
    const { doctorProfileRepo } = await import('../../../../src/main/db/doctor-profile-repo');
    const { usedDevicesRepo } = await import('../../../../src/main/db/used-devices-repo');
    const db = getDb();

    // Bootstrap a doctor_profile row + a user (used-devices FK targets
    // doctor_profile.id, not users.id).
    const userId = '00000000-0000-4000-8000-0000000000a1';
    db.prepare(
      `INSERT INTO users (id, full_name, is_first_admin, pin_hash, failed_attempts, is_locked, created_at)
       VALUES (?, 'Dr. C', 1, 'h', 0, 0, ?)`,
    ).run(userId, Date.now());
    const profile = doctorProfileRepo.upsert({
      userId,
      fullNameEn: 'Dr. C',
      clinicNameEn: 'Clinic C',
    });
    const device = usedDevicesRepo.add({
      profileId: profile.id,
      name: 'Olympus CV-260',
    });
    expect(usedDevicesRepo.get(device.id)?.id).toBe(device.id);

    // Delete the parent profile — CASCADE removes the child device.
    db.prepare(`DELETE FROM doctor_profile WHERE id = ?`).run(profile.id);
    expect(usedDevicesRepo.get(device.id)).toBeNull();

    closeDb();
  });
});