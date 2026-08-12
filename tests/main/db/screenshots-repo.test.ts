// screenshots-repo unit tests. Wave 0 of Plan 01.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-shots-repo-'));
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
    videoPath: 'data/media/patients/abc/proc1/video.mp4',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });
  return { procedureId: inserted.id, patientId, doctorId: r.userId };
}

function writeFakeFile(relPath: string, bytes = 64): void {
  const abs = path.join(tmpDir, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.alloc(bytes));
}

describe('screenshotsRepo', () => {
  it('add returns the inserted row mapped to camelCase', async () => {
    const { procedureId } = await bootstrap();
    const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
    const rel = 'data/media/patients/p1/proc1/screenshots/123.jpg';
    writeFakeFile(rel);
    const row = screenshotsRepo.add({
      procedureId,
      timestampInVideoMs: 123,
      filePath: rel,
      createdAt: Date.now(),
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.procedureId).toBe(procedureId);
    expect(row.timestampInVideoMs).toBe(123);
    expect(row.filePath).toBe(rel);
    expect(row.annotation).toBeNull();
  });

  it('listByProcedure orders rows by timestamp_in_video ASC', async () => {
    const { procedureId } = await bootstrap();
    const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
    const now = Date.now();
    screenshotsRepo.add({ procedureId, timestampInVideoMs: 3000, filePath: 'a.jpg', createdAt: now });
    screenshotsRepo.add({ procedureId, timestampInVideoMs: 1000, filePath: 'b.jpg', createdAt: now });
    screenshotsRepo.add({ procedureId, timestampInVideoMs: 2000, filePath: 'c.jpg', createdAt: now });
    const rows = screenshotsRepo.listByProcedure(procedureId);
    expect(rows.map((r) => r.timestampInVideoMs)).toEqual([1000, 2000, 3000]);
  });

  it('delete removes the row and unlinks the file from userData', async () => {
    const { procedureId } = await bootstrap();
    const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
    const rel = 'data/media/patients/p1/proc1/screenshots/del.jpg';
    writeFakeFile(rel, 128);
    const row = screenshotsRepo.add({
      procedureId,
      timestampInVideoMs: 999,
      filePath: rel,
      createdAt: Date.now(),
    });
    expect(row.id).toBeGreaterThan(0);
    expect(require('node:fs').existsSync(path.join(tmpDir, rel))).toBe(true);
    screenshotsRepo.delete(row.id, { removeFile: true });
    expect(screenshotsRepo.get(row.id)).toBeUndefined();
    expect(require('node:fs').existsSync(path.join(tmpDir, rel))).toBe(false);
  });

  it('delete({ removeFile: false }) keeps the file on disk', async () => {
    const { procedureId } = await bootstrap();
    const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
    const rel = 'data/media/patients/p1/proc1/screenshots/keep.jpg';
    writeFakeFile(rel, 128);
    const row = screenshotsRepo.add({
      procedureId,
      timestampInVideoMs: 999,
      filePath: rel,
      createdAt: Date.now(),
    });
    screenshotsRepo.delete(row.id, { removeFile: false });
    expect(screenshotsRepo.get(row.id)).toBeUndefined();
    expect(require('node:fs').existsSync(path.join(tmpDir, rel))).toBe(true);
  });

  it('updateAnnotation updates + null resets to NULL', async () => {
    const { procedureId } = await bootstrap();
    const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
    const rel = 'data/media/patients/p1/proc1/screenshots/ann.jpg';
    writeFakeFile(rel);
    const row = screenshotsRepo.add({
      procedureId,
      timestampInVideoMs: 1,
      filePath: rel,
      createdAt: Date.now(),
    });
    const updated = screenshotsRepo.updateAnnotation(row.id, 'Polyp at 12 oclock');
    expect(updated.annotation).toBe('Polyp at 12 oclock');
    const reset = screenshotsRepo.updateAnnotation(row.id, null);
    expect(reset.annotation).toBeNull();
  });

  it('delete(id) for an unknown id throws IPC_NOT_FOUND', async () => {
    await bootstrap();
    const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
    let caught: unknown = null;
    try {
      screenshotsRepo.delete(999_999);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(caught).toBeInstanceOf(IpcErrorException);
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe('IPC_NOT_FOUND');
  });
});
