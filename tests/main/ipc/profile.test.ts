// Phase 7 / Plan 07-01 — profile.update IPC language field tests (I18N-01).
//
// Extends the existing profile IPC contract tests to cover the new
// `language` field on profile.update (per D-17). The renderer reads
// doctor_profile.language first when resolving the active doctor's UI
// language, falling back to users.language when the column is NULL.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

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
    handle: (channel: string, cb: (...args: unknown[]) => unknown) => {
      handlers.set(channel, cb);
    },
    on: () => {},
  },
  contextBridge: {
    exposeInMainWorld: () => {},
  },
  ipcRenderer: {
    invoke: async () => null,
    on: () => {},
    removeListener: () => {},
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-profile-lang-'));
  handlers.clear();
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrapAndLogin(): Promise<string> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  return r.userId;
}

describe('profile.update language field (I18N-01 / D-17)', () => {
  // ponytail: the IPC validator requires every doctor_profile field
  // (fullNameEn, fullNameAr, clinicNameEn, clinicNameAr, address,
  // phone) to be present — even nullable ones. Tests below build the
  // baseline payload once and tweak the language field per case.

  function buildBase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      fullNameEn: 'Dr. X',
      fullNameAr: null,
      clinicNameEn: 'Clinic',
      clinicNameAr: null,
      address: null,
      phone: null,
      ...overrides,
    };
  }

  it('profile.update({language: "ar"}) persists language="ar" + profile.get() returns it', async () => {
    const userId = await bootstrapAndLogin();
    const { registerProfileIpc } = await import('../../../src/main/ipc/profile');
    registerProfileIpc();

    const update = handlers.get('profile:update');
    const get = handlers.get('profile:get');
    expect(update).toBeDefined();
    expect(get).toBeDefined();

    // Update profile with the new language field.
    const updated = (await update!(
      {},
      buildBase({ language: 'ar' }),
    )) as { language: 'en' | 'ar' | null };

    expect(updated.language).toBe('ar');

    // profile.get() reads back the same row.
    const fetched = (await get!()) as { language: 'en' | 'ar' | null; userId: string };
    expect(fetched.language).toBe('ar');
    expect(fetched.userId).toBe(userId);
  });

  it('profile.update({language: null}) clears the per-doctor override (falls back to users.language)', async () => {
    const userId = await bootstrapAndLogin();
    const { registerProfileIpc } = await import('../../../src/main/ipc/profile');
    registerProfileIpc();

    const update = handlers.get('profile:update');
    const get = handlers.get('profile:get');
    expect(update).toBeDefined();
    expect(get).toBeDefined();

    // First set 'ar'.
    await update!({}, buildBase({ fullNameEn: 'Dr. Y', language: 'ar' }));
    let fetched = (await get!()) as { language: 'en' | 'ar' | null };
    expect(fetched.language).toBe('ar');

    // Then clear it.
    await update!({}, buildBase({ fullNameEn: 'Dr. Y', language: null }));
    fetched = (await get!()) as { language: 'en' | 'ar' | null };
    expect(fetched.language).toBeNull();
    void userId;
  });

  it('profile.update without language: leaves existing language untouched', async () => {
    await bootstrapAndLogin();
    const { registerProfileIpc } = await import('../../../src/main/ipc/profile');
    registerProfileIpc();

    const update = handlers.get('profile:update');
    const get = handlers.get('profile:get');
    expect(update).toBeDefined();
    expect(get).toBeDefined();

    // First set 'ar'.
    await update!({}, buildBase({ fullNameEn: 'Dr. Z', language: 'ar' }));
    let fetched = (await get!()) as { language: 'en' | 'ar' | null };
    expect(fetched.language).toBe('ar');

    // Update other fields WITHOUT the language key — existing value persists.
    await update!({}, buildBase({ fullNameEn: 'Dr. Z Updated' }));
    fetched = (await get!()) as { language: 'en' | 'ar' | null; fullNameEn: string };
    expect(fetched.language).toBe('ar'); // unchanged
    expect(fetched.fullNameEn).toBe('Dr. Z Updated'); // new value
  });

  it('profile.update({language: "en"}) round-trips explicitly', async () => {
    await bootstrapAndLogin();
    const { registerProfileIpc } = await import('../../../src/main/ipc/profile');
    registerProfileIpc();

    const update = handlers.get('profile:update');
    const get = handlers.get('profile:get');
    expect(update).toBeDefined();
    expect(get).toBeDefined();

    await update!({}, buildBase({ fullNameEn: 'Dr. E', language: 'ar' }));
    await update!({}, buildBase({ fullNameEn: 'Dr. E', language: 'en' }));
    const fetched = (await get!()) as { language: 'en' | 'ar' | null };
    expect(fetched.language).toBe('en');
  });

  it('unauthenticated: profile.update({language: "ar"}) throws IPC_AUTH_REQUIRED and writes no row', async () => {
    const { getDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    getDb();
    const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
    // Stay logged out.

    const { registerProfileIpc } = await import('../../../src/main/ipc/profile');
    registerProfileIpc();
    const update = handlers.get('profile:update');
    expect(update).toBeDefined();

    const db = getDb();
    const before = (db.prepare(`SELECT language FROM doctor_profile WHERE user_id = ?`).get(r.userId) as
      | { language: string | null }
      | undefined)?.language;

    let caught: unknown = null;
    try {
      await update!({}, buildBase({ language: 'ar' }));
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_AUTH_REQUIRED');

    const after = (db.prepare(`SELECT language FROM doctor_profile WHERE user_id = ?`).get(r.userId) as
      | { language: string | null }
      | undefined)?.language;
    expect(after).toBe(before); // unchanged
  });
});