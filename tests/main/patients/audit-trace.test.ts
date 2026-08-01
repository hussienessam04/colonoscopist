// audit-trace.test.ts — end-to-end create->list->view->update->delete->restore lifecycle
// with PII-safe audit metadata (Fix 6 + AUDIT-01).

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-pat-trace-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('audit trace end-to-end', () => {
  it('bootstrap -> create -> list -> view -> update -> delete -> restore writes 8 chronological rows with PII-safe metadata', async () => {
    const { getDb } = await import('../../../src/main/db');
    const { wizardBootstrap, login } = await import('../../../src/main/auth');
    getDb();
    const wiz = await wizardBootstrap({ fullName: 'Dr. T', clinicName: 'Clinic T', pin: '1234' });
    await login({ userId: wiz.userId, pin: '1234' });

    const { createPatient, listPatients, getPatient, updatePatient, softDeletePatient, restorePatient } =
      await import('../../../src/main/ipc/patients');

    // 1. CREATE
    const created = createPatient({
      fullName: 'Alice Trace',
      dob: '1985-05-05',
      gender: 'female',
      mrn: 'TRACE-001',
      phone: '555-7777',
      notes: 'severe headache',
    });

    // 2. LIST (matches Alice)
    const listed = listPatients({ search: 'Alice' });
    expect(listed.rows.find((r) => r.id === created.id)).toBeDefined();

    // 3. VIEW
    const fetched = getPatient(created.id);
    expect(fetched).not.toBeNull();

    // 4. UPDATE (phone only — keeps fields array short)
    updatePatient(created.id, { phone: '555-8888' });

    // 5. SOFT-DELETE
    softDeletePatient(created.id);

    // 6. RESTORE
    restorePatient(created.id);

    // Query audit_log chronologically.
    const rows = getDb()
      .prepare(
        `SELECT action, entity_id, metadata, outcome
         FROM audit_log
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as { action: string; entity_id: string | null; metadata: string | null; outcome: string }[];

    // Extract action sequence (filter only the patient_* + bootstrap rows).
    const patientActions = rows
      .map((r) => r.action)
      .filter((a) => a === 'auth.bootstrap.completed' || a.startsWith('patient_'));

    // Expected: bootstrap, create, list, view, update, delete, restore.
    // soft-delete test in soft-delete.test.ts already exercises the get(null) path;
    // here we use a straight trace with no extra view.
    expect(patientActions).toEqual([
      'auth.bootstrap.completed',
      'patient_create',
      'patient_list',
      'patient_view',
      'patient_update',
      'patient_delete',
      'patient_restore',
    ]);

    // PII guard: assert NO row metadata contains field VALUES (per Fix 6).
    // Forbidden substrings: the actual MRN/phone/notes values used in this test.
    const forbidden = ['TRACE-001', '555-7777', '555-8888', 'severe headache'];
    for (const row of rows) {
      if (!row.metadata) continue;
      for (const needle of forbidden) {
        expect(row.metadata).not.toContain(needle);
      }
    }

    // patient_update metadata must contain fields (column names), not values.
    const updateRow = rows.find((r) => r.action === 'patient_update');
    expect(updateRow).toBeDefined();
    const updateMeta = JSON.parse(updateRow!.metadata!);
    expect(updateMeta.fields).toEqual(['phone']);

    // patient_list metadata echoes the filter, never patient data.
    const listRow = rows.find((r) => r.action === 'patient_list');
    expect(listRow).toBeDefined();
    const listMeta = JSON.parse(listRow!.metadata!);
    expect(listMeta.search).toBe('Alice');

    // patient_create / patient_delete / patient_restore have entity_id == created.id.
    for (const action of ['patient_create', 'patient_delete', 'patient_restore'] as const) {
      const r = rows.find((x) => x.action === action);
      expect(r).toBeDefined();
      expect(r!.entity_id).toBe(created.id);
    }

    // patient_view has entity_id == created.id.
    const viewRow = rows.find((r) => r.action === 'patient_view');
    expect(viewRow).toBeDefined();
    expect(viewRow!.entity_id).toBe(created.id);
  });
});