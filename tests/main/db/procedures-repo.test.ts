// proceduresRepo — Plan 03 extension tests for updateVideoPath + restoreFromOriginal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-procrepo-'));
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
    `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(patientId, 'Alice', '1990-01-01', Date.now(), Date.now());
  const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
  const inserted = proceduresRepo.insert({
    patientId,
    doctorId: r.userId,
    videoPath: 'video.mp4',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });
  proceduresRepo.updateFinalized(inserted.id, {
    endedAt: Date.now(),
    durationSeconds: 60,
    status: 'completed',
    videoPath: 'video.mp4',
  });
  return { procedureId: inserted.id, patientId, doctorId: r.userId };
}

function writeFakeFile(patientId: string, procedureId: string, fileName: string): void {
  const abs = path.join(tmpDir, 'data', 'media', 'patients', patientId, procedureId, fileName);
  require('node:fs').mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.alloc(64));
}

describe('proceduresRepo.updateVideoPath + restoreFromOriginal', () => {
  it('first trim populates video_path_original via COALESCE', async () => {
    const { procedureId } = await bootstrap();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const updated = proceduresRepo.updateVideoPath(
      procedureId,
      'video-trimmed.mp4',
      'video.mp4',
    );
    expect(updated.videoPath).toBe('video-trimmed.mp4');
    expect(updated.videoPathOriginal).toBe('video.mp4');
  });

  it('second trim leaves video_path_original UNCHANGED (D-07 COALESCE guard)', async () => {
    const { procedureId } = await bootstrap();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    proceduresRepo.updateVideoPath(procedureId, 'video-trimmed.mp4', 'video.mp4');
    // Second trim re-points video_path to a new trimmed file but the
    // originalRel passed in is the CURRENT video_path, not the original.
    // COALESCE keeps the first-trim original.
    const second = proceduresRepo.updateVideoPath(
      procedureId,
      'video-trimmed-2.mp4',
      'video-trimmed.mp4',
    );
    expect(second.videoPath).toBe('video-trimmed-2.mp4');
    expect(second.videoPathOriginal).toBe('video.mp4'); // first-trim original is LOCKED
  });

  it('restoreFromOriginal re-points video_path to video_path_original', async () => {
    const { procedureId, patientId } = await bootstrap();
    writeFakeFile(patientId, procedureId, 'video.mp4');
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    proceduresRepo.updateVideoPath(procedureId, 'video-trimmed.mp4', 'video.mp4');
    const restored = proceduresRepo.restoreFromOriginal(procedureId);
    expect(restored.videoPath).toBe('video.mp4');
    expect(restored.videoPathOriginal).toBe('video.mp4');
  });

  it('restoreFromOriginal rejects when video_path_original is null (IPC_VALIDATION)', async () => {
    const { procedureId } = await bootstrap();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    let caught: unknown = null;
    try {
      proceduresRepo.restoreFromOriginal(procedureId);
    } catch (err) {
      caught = err;
    }
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(caught).toBeInstanceOf(IpcErrorException);
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe(
      'IPC_VALIDATION',
    );
  });

  it('restoreFromOriginal rejects when the original file is missing on disk (IPC_NOT_FOUND)', async () => {
    const { procedureId } = await bootstrap();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    proceduresRepo.updateVideoPath(procedureId, 'video-trimmed.mp4', 'video.mp4');
    // Don't write the original file — restoreFromOriginal must detect the
    // missing file via fs.existsSync and throw IPC_NOT_FOUND.
    let caught: unknown = null;
    try {
      proceduresRepo.restoreFromOriginal(procedureId);
    } catch (err) {
      caught = err;
    }
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(caught).toBeInstanceOf(IpcErrorException);
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe(
      'IPC_NOT_FOUND',
    );
  });

  it('restoreFromOriginal succeeds when the original file exists on disk', async () => {
    const { procedureId, patientId } = await bootstrap();
    writeFakeFile(patientId, procedureId, 'video.mp4');
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    proceduresRepo.updateVideoPath(procedureId, 'video-trimmed.mp4', 'video.mp4');
    const restored = proceduresRepo.restoreFromOriginal(procedureId);
    expect(restored.videoPath).toBe('video.mp4');
  });
});

// Phase 7 / Plan 07-02 — D-04 verbatim: proceduresRepo.list accepts
// dateFrom / dateTo / doctorId. Date range applies to procedures.started_at
// (canonical procedure date per Phase 4 D-10). Empty/missing filters
// preserve the Phase 4 zero-config behavior.
describe('proceduresRepo.list — Phase 7 date + doctor filters (D-04)', () => {
  async function bootstrapWithTwoDoctors(): Promise<{
    doctor1: string;
    doctor2: string;
    patientId: string;
  }> {
    const { getDb } = await import('../../../src/main/db');
    const { wizardBootstrap, login } = await import('../../../src/main/auth');
    const db = getDb();
    const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
    await login({ userId: r.userId, pin: '1234' });
    const doctor2 = '00000000-0000-4000-8000-000000000099';
    db.prepare(
      `INSERT INTO users (id, full_name, is_first_admin, pin_hash, failed_attempts, is_locked, created_at)
       VALUES (?, ?, 0, 'h', 0, 0, ?)`,
    ).run(doctor2, 'Dr. B', Date.now());
    const patientId = '00000000-0000-4000-8000-000000000010';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
       VALUES (?, ?, '1990-01-01', ?, ?)`,
    ).run(patientId, 'Alice', Date.now(), Date.now());
    return { doctor1: r.userId, doctor2, patientId };
  }

  function insertProc(
    db: ReturnType<typeof import('../../../src/main/db').getDb>,
    id: string,
    patientId: string,
    doctorId: string,
    startedAt: number,
  ): void {
    db.prepare(
      `INSERT INTO procedures
        (id, patient_id, doctor_id, started_at, ended_at, duration_seconds, status,
         video_path, preset_summary, audio_device_name, created_at)
       VALUES (?, ?, ?, ?, ?, 60, 'completed', 'v.mp4', '{}', NULL, ?)`,
    ).run(id, patientId, doctorId, startedAt, startedAt + 60_000, startedAt);
  }

  it('dateFrom/dateTo filters on procedures.started_at', async () => {
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    const { doctor1, patientId } = await bootstrapWithTwoDoctors();
    insertProc(
      db,
      '00000000-0000-4000-8000-0000000000a1',
      patientId,
      doctor1,
      Date.UTC(2026, 7, 5, 10, 0, 0),
    );
    insertProc(
      db,
      '00000000-0000-4000-8000-0000000000b1',
      patientId,
      doctor1,
      Date.UTC(2026, 8, 10, 10, 0, 0),
    );
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const aug = proceduresRepo.list({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
    expect(aug.total).toBe(1);
    expect(aug.rows[0]?.id).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('doctorId filters on procedures.doctor_id', async () => {
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    const { doctor1, doctor2, patientId } = await bootstrapWithTwoDoctors();
    insertProc(
      db,
      '00000000-0000-4000-8000-0000000000a1',
      patientId,
      doctor1,
      Date.UTC(2026, 7, 5, 10, 0, 0),
    );
    insertProc(
      db,
      '00000000-0000-4000-8000-0000000000b1',
      patientId,
      doctor2,
      Date.UTC(2026, 7, 6, 10, 0, 0),
    );
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const d1Only = proceduresRepo.list({ doctorId: doctor1 });
    expect(d1Only.total).toBe(1);
    expect(d1Only.rows[0]?.id).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('AND-combined: dateFrom + dateTo + doctorId = the intersection', async () => {
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    const { doctor1, doctor2, patientId } = await bootstrapWithTwoDoctors();
    // a1 — Aug + doctor1 (matches all three filters)
    insertProc(
      db,
      '00000000-0000-4000-8000-0000000000a1',
      patientId,
      doctor1,
      Date.UTC(2026, 7, 5, 10, 0, 0),
    );
    // b1 — Aug + doctor2 (doctor mismatch)
    insertProc(
      db,
      '00000000-0000-4000-8000-0000000000b1',
      patientId,
      doctor2,
      Date.UTC(2026, 7, 6, 10, 0, 0),
    );
    // c1 — Sep + doctor1 (date mismatch)
    insertProc(
      db,
      '00000000-0000-4000-8000-0000000000c1',
      patientId,
      doctor1,
      Date.UTC(2026, 8, 5, 10, 0, 0),
    );
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const intersected = proceduresRepo.list({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      doctorId: doctor1,
    });
    expect(intersected.total).toBe(1);
    expect(intersected.rows[0]?.id).toBe('00000000-0000-4000-8000-0000000000a1');
  });
});
