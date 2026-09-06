// reportsRepo unit tests — Wave 0 of Plan 06-01.
// Per RPT-01 (1:1 reports-per-procedure) + RPT-04 (draft→finalized state
// machine + locked fields) + D-05..D-08.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-reports-repo-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrap(): Promise<{
  procedureId: string;
  patientId: string;
  doctorId: string;
}> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const db = getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  const patientId = '00000000-0000-4000-8000-000000000010';
  db.prepare(
    `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(patientId, 'Alice', '1990-01-01', `MRN-T-${patientId.slice(-8)}`, Date.now(), Date.now());
  const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
  const inserted = proceduresRepo.insert({
    patientId,
    doctorId: r.userId,
    videoPath: 'video.mp4',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });
  return { procedureId: inserted.id, patientId, doctorId: r.userId };
}

describe('reportsRepo', () => {
  it('getOrCreate creates a draft row with empty fields when none exists', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const row = reportsRepo.getOrCreate(procedureId, doctorId);
    expect(row.procedureId).toBe(procedureId);
    expect(row.doctorId).toBe(doctorId);
    expect(row.status).toBe('draft');
    expect(row.procedureType).toBe('colon');
    expect(row.instrument).toBeNull();
    expect(row.premedicationOverride).toBeNull();
    expect(row.esophagus).toBe('');
    expect(row.stomach).toBe('');
    expect(row.pylorus).toBe('');
    expect(row.duodenum).toBe('');
    expect(row.colon).toBe('');
    expect(row.ileum).toBe('');
    expect(row.conclusion).toBe('');
    expect(row.recommendation).toBe('');
    expect(row.finalizedAt).toBeNull();
    expect(row.pdfPath).toBeNull();
    expect(row.pdfGeneratedAt).toBeNull();
  });

  it('getOrCreate returns the existing row when called twice (idempotent, 1:1 with procedure)', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const first = reportsRepo.getOrCreate(procedureId, doctorId);
    const second = reportsRepo.getOrCreate(procedureId, doctorId);
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('UNIQUE on procedure_id is enforced — second getOrCreate for a different procedureId works, but a manual second INSERT for the same procedureId throws', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const { getDb } = await import('../../../src/main/db');
    reportsRepo.getOrCreate(procedureId, doctorId);
    let caught: unknown = null;
    try {
      getDb().prepare(
        `INSERT INTO reports (id, procedure_id, doctor_id, findings, diagnosis, recommendations,
         procedure_details, status, created_at, updated_at)
         VALUES ('manual', ?, ?, '', '', '', '', 'draft', 0, 0)`,
      ).run(procedureId, doctorId);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as { code: string }).code).toBe('SQLITE_CONSTRAINT_UNIQUE');
  });

  it('updateDraft writes the eight procedure-type-specific boxes', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const created = reportsRepo.getOrCreate(procedureId, doctorId);
    const updated = reportsRepo.updateDraft(created.id, {
      colon: 'Polyp at 12 oclock',
      conclusion: 'Tubular adenoma',
      recommendation: 'Follow-up in 3 years',
    });
    expect(updated.colon).toBe('Polyp at 12 oclock');
    expect(updated.conclusion).toBe('Tubular adenoma');
    expect(updated.recommendation).toBe('Follow-up in 3 years');
  });

  it('updateDraft does NOT change procedure_id or doctor_id (locked fields)', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const { getDb } = await import('../../../src/main/db');
    const created = reportsRepo.getOrCreate(procedureId, doctorId);
    reportsRepo.updateDraft(created.id, {
      colon: 'X',
      conclusion: 'Y',
    });
    const row = getDb()
      .prepare(`SELECT procedure_id, doctor_id FROM reports WHERE id = ?`)
      .get(created.id) as { procedure_id: string; doctor_id: string };
    expect(row.procedure_id).toBe(procedureId);
    expect(row.doctor_id).toBe(doctorId);
  });

  it('updateFinalized writes the boxes after finalize', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const created = reportsRepo.getOrCreate(procedureId, doctorId);
    reportsRepo.finalize(created.id);
    const updated = reportsRepo.updateFinalized(created.id, {
      colon: 'Corrected colon post-finalize',
    });
    expect(updated.colon).toBe('Corrected colon post-finalize');
    expect(updated.status).toBe('finalized');
    expect(updated.finalizedAt).not.toBeNull();
  });

  it('updateFinalized throws IPC_VALIDATION when called on a draft row (status guard)', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const created = reportsRepo.getOrCreate(procedureId, doctorId);
    let caught: unknown = null;
    try {
      reportsRepo.updateFinalized(created.id, { colon: 'should fail' });
    } catch (err) {
      caught = err;
    }
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(caught).toBeInstanceOf(IpcErrorException);
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe('IPC_VALIDATION');
  });

  it('finalize sets status=finalized and stamps finalized_at', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const created = reportsRepo.getOrCreate(procedureId, doctorId);
    expect(created.finalizedAt).toBeNull();
    const finalized = reportsRepo.finalize(created.id);
    expect(finalized.status).toBe('finalized');
    expect(finalized.finalizedAt).not.toBeNull();
    expect(typeof finalized.finalizedAt).toBe('number');
  });

  // Quick task 20260906-finalize-idempotent — `finalize` is now
  // idempotent on an already-finalized row. The renderer relies on
  // this to recover from a "Back between finalize and regenPdf"
  // half-finalized state: the no-op finalize returns the row, the
  // follow-up regenPdf writes the PDF, the report is fully
  // finalized. finalized_at is NOT bumped on the second call so
  // the original finalize event timestamp is preserved.
  it('finalize is idempotent on an already-finalized row (no-op, no finalizedAt bump)', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const created = reportsRepo.getOrCreate(procedureId, doctorId);
    const first = reportsRepo.finalize(created.id);
    const firstFinalizedAt = first.finalizedAt;
    expect(firstFinalizedAt).not.toBeNull();
    // Tiny delay so a non-idempotent implementation would clearly bump
    // finalized_at to a different value.
    await new Promise((r) => setTimeout(r, 5));
    const second = reportsRepo.finalize(created.id);
    expect(second.status).toBe('finalized');
    expect(second.finalizedAt).toBe(firstFinalizedAt);
  });

  it('setPdfPath stores userData-relative path', async () => {
    const { procedureId, doctorId } = await bootstrap();
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const created = reportsRepo.getOrCreate(procedureId, doctorId);
    const updated = reportsRepo.setPdfPath(created.id, 'data/reports/r-123.pdf');
    expect(updated.pdfPath).toBe('data/reports/r-123.pdf');
    expect(updated.pdfGeneratedAt).not.toBeNull();
  });
});
