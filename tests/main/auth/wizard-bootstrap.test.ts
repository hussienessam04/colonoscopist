// Phase 7 / Plan 07-01 — wizard bootstrap language field tests (I18N-01).
//
// The wizard is the first-launch flow that creates the admin user +
// clinic settings + the admin's doctor_profile row. With I18N-01
// (per D-18), it now accepts an optional `language` field that
// persists to users.language as the workstation-level default.

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

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-wizard-lang-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('wizardBootstrap language field (I18N-01 / D-18)', () => {
  it('wizard({language: "ar"}) persists users.language = "ar" on the new admin row', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    getDb();

    const result = await wizardBootstrap({
      fullName: 'Dr. Arabic',
      clinicName: 'Clinic AR',
      pin: '1234',
      language: 'ar',
    });

    expect(result.accepted).toBe(true);
    expect(result.userId).toMatch(/^[0-9a-f-]{36}$/i);

    const db = getDb();
    const row = db.prepare('SELECT language FROM users WHERE id = ?').get(result.userId) as {
      language: 'en' | 'ar';
    };
    expect(row.language).toBe('ar');

    // settings table also carries the language for renderer-side
    // bootstrap reads before the session is active.
    const settingsRow = db
      .prepare(`SELECT value FROM settings WHERE key = 'language'`)
      .get() as { value: string } | undefined;
    expect(settingsRow?.value).toBe('ar');

    // The audit row also echoes the language choice.
    const auditRow = db
      .prepare(
        `SELECT metadata FROM audit_log WHERE action = 'auth.bootstrap.completed' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { metadata: string };
    const parsed = JSON.parse(auditRow.metadata) as { clinicName: string; language: string };
    expect(parsed.language).toBe('ar');
    expect(parsed.clinicName).toBe('Clinic AR');

    closeDb();
  });

  it('wizard without language: defaults to "en" on the users row', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    getDb();

    const result = await wizardBootstrap({
      fullName: 'Dr. English',
      clinicName: 'Clinic EN',
      pin: '1234',
    });

    const db = getDb();
    const row = db.prepare('SELECT language FROM users WHERE id = ?').get(result.userId) as {
      language: 'en' | 'ar';
    };
    expect(row.language).toBe('en');

    const settingsRow = db
      .prepare(`SELECT value FROM settings WHERE key = 'language'`)
      .get() as { value: string } | undefined;
    expect(settingsRow?.value).toBe('en');

    closeDb();
  });

  it('wizard does NOT seed a per-doctor language override (doctor_profile.language stays NULL)', async () => {
    const { getDb, closeDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    getDb();

    const result = await wizardBootstrap({
      fullName: 'Dr. AR',
      clinicName: 'Clinic AR',
      pin: '1234',
      language: 'ar',
    });

    const db = getDb();
    const profileRow = db
      .prepare('SELECT language FROM doctor_profile WHERE user_id = ?')
      .get(result.userId) as { language: string | null };
    // NULL means "follow users.language" (per-doctor override not picked yet).
    expect(profileRow.language).toBeNull();

    closeDb();
  });
});