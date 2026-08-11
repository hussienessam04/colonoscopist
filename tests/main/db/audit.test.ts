// auditRepo.list entityType filter — Phase 7 / quick 20260811-audit-ui-polish.
// Regression test for the missing AND (@entityType IS NULL OR entity_type
// = @entityType) clause in both list + count prepared statements. The
// renderer test mocks the IPC layer so it can't catch SQL-layer drift;
// this test exercises the prepared statement directly against a real DB.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-audit-entitytype-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrapAndSeed(): Promise<void> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const { auditRepo } = await import('../../../src/main/db/audit');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. X', clinicName: 'C', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  // Seed three rows with distinct entity_types. The wizard bootstrap
  // already writes a handful of auth.* rows (user/backup etc.) but we
  // want a known baseline — directly INSERT one row per entity_type
  // so the assertion is exact, not "contains at least one".
  auditRepo.append({ action: 'user.created', entityType: 'user', userId: r.userId });
  auditRepo.append({ action: 'backup.created', entityType: 'backup', userId: r.userId });
  auditRepo.append({
    action: 'patient.created',
    entityType: 'patient',
    userId: r.userId,
  });
}

describe('auditRepo.list entityType filter', () => {
  it('returns only rows whose entity_type matches the filter', async () => {
    await bootstrapAndSeed();
    const { closeDb } = await import('../../../src/main/db');
    const { auditRepo } = await import('../../../src/main/db/audit');
    const r = auditRepo.list({ entityType: 'backup' });
    expect(r.total).toBe(1);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.entity_type).toBe('backup');
    expect(r.rows[0]?.action).toBe('backup.created');
    closeDb();
  });

  it('empty / undefined entityType returns all rows (baseline)', async () => {
    await bootstrapAndSeed();
    const { closeDb } = await import('../../../src/main/db');
    const { auditRepo } = await import('../../../src/main/db/audit');
    const r = auditRepo.list({});
    // baseline = our 3 + the wizard bootstrap's auth.* rows.
    expect(r.total).toBeGreaterThanOrEqual(3);
    expect(r.rows.length).toBeGreaterThanOrEqual(3);
    const seededTypes = r.rows.filter((row) =>
      ['user.created', 'backup.created', 'patient.created'].includes(row.action),
    );
    expect(seededTypes).toHaveLength(3);
    closeDb();
  });

  it('entityType filter narrows both rows and total consistently', async () => {
    await bootstrapAndSeed();
    const { closeDb } = await import('../../../src/main/db');
    const { auditRepo } = await import('../../../src/main/db/audit');
    const userResult = auditRepo.list({ entityType: 'user' });
    const patientResult = auditRepo.list({ entityType: 'patient' });
    // Total must equal the row count for an un-paginated query — this
    // is the contract-guard that catches the count + list SQL drifting
    // apart (the original bug had no entity_type clause at all).
    expect(userResult.total).toBe(userResult.rows.length);
    expect(patientResult.total).toBe(patientResult.rows.length);
    expect(userResult.rows.every((row) => row.entity_type === 'user')).toBe(true);
    expect(patientResult.rows.every((row) => row.entity_type === 'patient')).toBe(true);
    closeDb();
  });
});
